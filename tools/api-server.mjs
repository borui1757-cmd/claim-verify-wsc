// api-server.js —— 把核验能力暴露成 HTTP：让别的语言/框架能调我们
//
// 为什么需要：我们现在是一个宿主插件——最深的位置，也是最封闭的位置。
// 有了 /verify，Python 的 Guardrails validator、别的 agent 框架、CI 脚本才能用上。
//
// 零依赖（只用 node:http），只绑 127.0.0.1。
//
// 用法：
//   node tools/api-server.mjs --port=8600
//   curl -X POST http://127.0.0.1:8600/verify -d '{"claims":[{"kind":"path","value":"C:/x","expect":"exists"}]}'
//
// 鉴权（可选）：设环境变量 CLAIM_VERIFY_API_TOKEN，请求需带 Authorization: Bearer <token>

import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import { verifyHostClaim } from '../lib/host.js';
import { verifyProgramClaim, PROGRAM_KINDS } from '../lib/extra.js';
import { extractClaims } from '../lib/index.js';
import { findContradictions } from '../lib/consistency.js';
import { VERSION } from '../lib/version.js';
import { BUILD_ID } from '../lib/build-id.js';

const PORT = Number((process.argv.find((x) => x.startsWith('--port=')) || '--port=8600').split('=')[1]);
const TOKEN = process.env.CLAIM_VERIFY_API_TOKEN || '';
const MAX_BODY = 256 * 1024;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** TCP 探活（127.0.0.1） */
function probePort(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const fin = (v) => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(timeoutMs);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error', () => fin(false));
    try { s.connect(port, '127.0.0.1'); } catch { fin(false); }
  });
}

/** path / port / filecount —— 这三类原来写在 index.js 里，这里单独实现，保持 API 轻量 */
async function verifyLocal(claim) {
  const kind = String(claim.kind || '').toLowerCase();
  const expect = String(claim.expect || '').toLowerCase();

  if (kind === 'path') {
    const p = typeof claim.value === 'object' ? claim.value.path : claim.value;
    const there = fs.existsSync(String(p));
    const wantExists = !expect.startsWith('not') && claim.polarity !== 'neg';
    return { ok: there === wantExists, verdict: there === wantExists ? 'supported' : 'contradicted', expect: there ? `路径存在：${p}` : `路径不存在：${p}` };
  }

  if (kind === 'port') {
    const port = Number(typeof claim.value === 'object' ? claim.value.port : claim.value);
    if (!Number.isFinite(port))
      return { ok: false, verdict: 'invalid', reason: '端口号非法' };
    const listening = await probePort(port);
    const wantListening = expect === 'listening' || claim.polarity !== 'neg' && expect !== 'not_listening';
    return { ok: listening === wantListening, verdict: listening === wantListening ? 'supported' : 'contradicted', expect: listening ? `端口 ${port} 在监听` : `端口 ${port} 没有监听` };
  }

  if (kind === 'filecount') {
    const v = typeof claim.value === 'string' ? JSON.parse(claim.value) : claim.value;
    try {
      const n = fs.readdirSync(String(v.dir)).length;
      return { ok: n === Number(v.n), verdict: n === Number(v.n) ? 'supported' : 'contradicted', expect: `该目录下有 ${n} 个条目` };
    }
    catch {
      return { ok: false, verdict: 'insufficient', reason: '目录读不到' };
    }
  }

  return null;
}

/** 核验一条断言 */
async function verifyOne(claim, opts) {
  const kind = String(claim && claim.kind || '').toLowerCase();
  if (!kind)
    return { ok: false, verdict: 'invalid', reason: '缺少 kind' };

  try {
    if (PROGRAM_KINDS.has(kind)) {
      const v = await verifyProgramClaim(claim, opts.cfg || {}, { nowMs: opts.nowMs, nowEndMs: opts.nowEndMs });
      if (!v)
        return { ok: false, verdict: 'inconclusive', reason: '真值取不到' };
      return { ok: v.ok, verdict: v.ok ? 'supported' : 'contradicted', expect: v.expect };
    }
    const local = await verifyLocal(claim);
    if (local)
      return local;
    const v = await verifyHostClaim(claim, opts.cfg || {}, {});
    if (!v)
      return { ok: false, verdict: 'insufficient', reason: '真值取不到（文件/进程读不到）' };
    return { ok: Boolean(v.ok), verdict: v.ok ? 'supported' : 'contradicted', expect: v.expect };
  }
  catch (e) {
    return { ok: false, verdict: 'error', reason: String(e && e.message || e).slice(0, 200) };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { ok: true, service: 'claim-verify', version: VERSION, buildId: BUILD_ID });
    return;
  }

  if (req.method !== 'POST' || (url.pathname !== '/verify' && url.pathname !== '/verify_text')) {
    json(res, 404, { error: 'not found', routes: ['GET /health', 'POST /verify', 'POST /verify_text'] });
    return;
  }

  // 鉴权
  if (TOKEN) {
    const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (got !== TOKEN) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw || '{}');
  }
  catch (e) {
    json(res, 400, { error: 'bad json: ' + String(e.message).slice(0, 100) });
    return;
  }

  const claims = Array.isArray(payload.claims) ? payload.claims : (payload.claim ? [payload.claim] : []);
  if (!claims.length && url.pathname === '/verify') {
    json(res, 400, { error: '需要 claims 数组' });
    return;
  }

  const opts = {
    cfg: payload.cfg || {},
    nowMs: Number(payload.nowMs) || Date.now(),
    nowEndMs: Number(payload.nowEndMs) || undefined,
  };

  // /verify_text：从一句话里抽断言再核验（给只能传文本的调用方用，例如 Guardrails validator）
  if (url.pathname === '/verify_text') {
    const text = String(payload.text || '');
    if (!text) {
      json(res, 400, { error: '需要 text' });
      return;
    }
    let extracted = [];
    try { extracted = extractClaims(text); }
    catch { extracted = []; }
    const results = [];
    for (const c of extracted.slice(0, 50))
      results.push({ claim: c, raw: c.raw, ...(await verifyOne(c, opts)) });
    json(res, 200, {
      ok: results.every((r) => r.ok),
      text,
      count: results.length,
      okCount: results.filter((r) => r.ok).length,
      contradictions: findContradictions(extracted).length,
      results,
    });
    return;
  }

  const results = [];
  for (const c of claims.slice(0, 50))
    results.push({ claim: c, ...(await verifyOne(c, opts)) });

  // 附带的两个"不需要真值"的判断
  const contradictions = findContradictions(claims).length;
  const okCount = results.filter((r) => r.ok).length;

  json(res, 200, {
    ok: okCount === results.length,
    version: VERSION,
    count: results.length,
    okCount,
    contradictions,
    results,
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`claim-verify API: http://127.0.0.1:${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  POST /verify   {"claims":[{"kind":"path","value":"C:/x","expect":"exists"}]}`);
  console.log(TOKEN ? '  鉴权：已启用（Bearer token）' : '  鉴权：未启用（仅本机）');
});
