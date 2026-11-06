// receipt.js —— 「结构化声明 + 证据回执」的第一版实现。
//
// 思路（见 docs/design-receipt.md）：
//   与其从自然语言里猜"它到底做了什么"，不如要求 agent 输出结构化声明：
//   ```claims
//   [{"kind":"write","target":"C:\\path\\a.txt"},{"kind":"cmd","target":"npm test"}]
//   ```
//   然后拿工具轨迹逐条配对，产出回执（receipt）：
//     { claim, verdict: supported|contradicted|insufficient, evidence:{tool,callId,isError,resultDigest} }
//   回执带链式摘要 + 本地 HMAC 签名，能验证"这份回执没被改过"。
//
// 说明：签名用的是本机对称密钥（HMAC-SHA256），不是 PKI —— 它能证明"篡改可被发现"，
// 不能证明"是谁签的"。要对外可验，需要换成非对称签名（留给以后）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const WRITE_TOOLS = new Set(['write', 'edit', 'mcp__cgp__cgp_write_file', 'mcp__cgp__cgp_edit']);
const CMD_TOOLS = new Set(['pwsh', 'mcp__cgp__cgp_exec', 'bash', 'shell']);

/** 稳定序列化：键排序，供摘要/签名用。 */
export function canonicalJson(value) {
  const walk = (v) => {
    if (Array.isArray(v))
      return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort())
        out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function normPath(p) {
  if (typeof p !== 'string')
    return null;
  return p.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase();
}

/** 从模型输出里取出 ```claims 代码块（JSON 数组）。没有就返回 null。 */
export function extractClaimsBlock(text) {
  if (typeof text !== 'string')
    return null;
  const m = text.match(/```(?:claims|json)?\s*\n([\s\S]*?)```/);
  if (!m)
    return null;
  try {
    const v = JSON.parse(m[1].trim());
    const arr = Array.isArray(v) ? v : Array.isArray(v.claims) ? v.claims : null;
    return arr && arr.length ? arr : null;
  }
  catch {
    return null;
  }
}

function pairArgs(p) {
  const args = p.args || {};
  return {
    path: args.file_path || args.path || null,
    cmd: args.command || args.cmd || null,
  };
}

function evidenceOf(p) {
  return {
    tool: p.name,
    callId: p.callId ?? null,
    turn: p.turn ?? null,
    isError: p.isError === true,
    resultSeen: p.resultSeen === true,
    resultDigest: sha256Hex(String(p.text || '')).slice(0, 16),
  };
}

/**
 * 逐条判定声明。
 * @param {Array} claims  [{kind:'write'|'cmd', target:'...'}]
 * @param {Array} pairs   trace.pairs() 的产物
 */
export function judgeDeclaredClaims(claims, pairs) {
  const writes = (pairs || []).filter((p) => WRITE_TOOLS.has(p.name));
  const cmds = (pairs || []).filter((p) => CMD_TOOLS.has(p.name));
  const out = [];

  for (const raw of claims || []) {
    const kind = String(raw?.kind || '').toLowerCase();
    const target = raw?.target;
    if (kind !== 'write' && kind !== 'cmd') {
      out.push({ claim: raw, verdict: 'insufficient', evidence: null, reason: '不支持的种类（第一期只判 write/cmd）' });
      continue;
    }
    const pool = kind === 'write' ? writes : cmds;
    const want = kind === 'write' ? normPath(target) : (typeof target === 'string' ? target.trim() : null);
    const hit = pool.find((p) => {
      const a = pairArgs(p);
      if (kind === 'write')
        return want && normPath(a.path) === want;
      return want && typeof a.cmd === 'string' && a.cmd.includes(want);
    });

    if (!hit) {
      out.push({ claim: raw, verdict: 'insufficient', evidence: null, independent: 0, reason: '轨迹里没有对应调用（无证据，不判否定）' });
      continue;
    }
    const evidence = evidenceOf(hit);
    // 2026-11-07 落地（来自另一个会话的分析）：
    // 现在的 supported 只表示"某次调用返回成功"，那是**单一来源**。
    // 按补强证据规则，单源证据不足以结案 → independent < 2 时降级为 insufficient。
    // independent = 支持同一断言的**不同来源**数量（tool+callId 去重）。
    const sameTarget = pool.filter((p) => {
      if (!p || p.resultSeen !== true)
        return false;
      const a = pairArgs(p);
      if (kind === 'write')
        return want && normPath(a.path) === want;
      return want && typeof a.cmd === 'string' && a.cmd.includes(want);
    });
    const sources = new Set(sameTarget.map((p) => `${p.name || ''}|${p.callId || ''}`));
    const independent = sources.size;

    if (evidence.isError)
      out.push({ claim: raw, verdict: 'contradicted', evidence, independent, reason: '该调用报错' });
    else if (!evidence.resultSeen)
      out.push({ claim: raw, verdict: 'insufficient', evidence, independent, reason: '没有结果（可能被截断/超时）' });
    else if (independent < 2)
      out.push({ claim: raw, verdict: 'insufficient', evidence, independent, reason: `单源证据（independent=${independent}）：只有一次调用支持，不足以结案` });
    else
      out.push({ claim: raw, verdict: 'supported', evidence, independent, reason: `调用成功（${independent} 个独立来源）` });
  }
  return out;
}

/** 读/建本地 HMAC 密钥。 */
export function ensureKey(keyPath) {
  try {
    const k = fs.readFileSync(keyPath, 'utf8').trim();
    if (k)
      return k;
  }
  catch { /* 不存在就生成 */ }
  const key = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, key + '\n', { mode: 0o600 });
  return key;
}

/**
 * 组装回执。
 * @param {{sessionId?:string, claims:Array, pairs:Array, at?:string, prevDigest?:string, keyPath:string}} p
 */
export function buildReceipt({ sessionId, claims, pairs, at, prevDigest, keyPath, clocks }) {
  const results = judgeDeclaredClaims(claims, pairs);

  // 2026-11-07（来自另一个会话的诊断）：原子性不是设计哲学，是**四个键和三个时间戳**。
  //   txid   —— 把 (认, 改, 证据) 绑成一条事务
  //   ack    —— 认了（修订场景才有意义）
  //   tAction/tClaim/tVerify —— 动作发生 / 声称发出 / 核验执行，三个不可协商的时刻
  // 之前我们只有一个 at，三个时刻被压成一个，"认了没改"和"改了没认"在结构上无法区分。
  const tVerify = at || new Date().toISOString();
  const tClaim = clocks?.tClaim ? new Date(clocks.tClaim).toISOString() : null;
  const tAction = clocks?.tAction ? new Date(clocks.tAction).toISOString() : null;

  const stamped = results.map((r, i) => {
    const ev = r.evidence || {};
    const txid = `${String(sessionId || 'sess').slice(-8)}-${r.claim && r.claim.kind || 'x'}-${i + 1}-${String(ev.callId || 'nocall').slice(-6)}`;
    return {
      ...r,
      txid,
      ack: Boolean(r.ack),          // 默认没有"认过"这件事，不伪造
      tClaim,
      tAction,
      tVerify,
    };
  });

  const body = {
    v: 1,
    iss: 'claim-verify-wsc',
    at: tVerify,
    sessionId: sessionId ?? null,
    prevDigest: prevDigest ?? null,
    clocks: { tAction, tClaim, tVerify },
    summary: {
      total: stamped.length,
      supported: stamped.filter((r) => r.verdict === 'supported').length,
      contradicted: stamped.filter((r) => r.verdict === 'contradicted').length,
      insufficient: stamped.filter((r) => r.verdict === 'insufficient').length,
    },
    claims: stamped,
  };
  const digest = sha256Hex(canonicalJson(body));
  const key = keyPath ? ensureKey(keyPath) : null;
  const sig = key ? crypto.createHmac('sha256', key).update(digest).digest('hex') : null;
  return { ...body, digest, sig };
}

/** 校验回执：摘要一致 + 签名一致。 */
export function verifyReceipt(receipt, { keyPath } = {}) {
  if (!receipt || typeof receipt !== 'object')
    return { ok: false, reason: '回执不是对象' };
  const { digest, sig, ...body } = receipt;
  const want = sha256Hex(canonicalJson(body));
  if (want !== digest)
    return { ok: false, reason: '摘要不符（内容被改过）' };
  if (keyPath) {
    let key = '';
    try { key = fs.readFileSync(keyPath, 'utf8').trim(); }
    catch { return { ok: false, reason: '找不到签名密钥，无法验签' }; }
    const expect = crypto.createHmac('sha256', key).update(digest).digest('hex');
    if (expect !== sig)
      return { ok: false, reason: '签名不符（不是同一把密钥，或签名被改过）' };
  }
  return { ok: true };
}
