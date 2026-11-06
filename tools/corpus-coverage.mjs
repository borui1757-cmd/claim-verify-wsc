// 语料复测：用**当前**代码重测「真实对话里有多少声明可被客观核验」。
//
// 旧数字 18.5% 是用 14 类原语 + 旧抽取器测的；今天扩到 11 类有标定的类型，需要重测。
//
// 口径（必须写清楚，否则数字会被误读）：
//   分母 = 句子数（按 。！？换行 切分）—— 句子是"声明"的近似单位
//   分子 = 抽取出来、且**真的能从系统取到真值**的断言条数
//   因此得到「每 100 句里有几条可核验断言」
//
// 用法：node tools/corpus-coverage.mjs [采样条数]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { extractClaims, verifyClaims } from '../lib/index.js';
import { extractHostClaims, verifyHostClaim } from '../lib/host.js';

const LIMIT = Number(process.argv[2] || 80);
const ROOT = 'C:/Users/19156/.dsh/sessions';
const CFG = { portTimeoutMs: 400, moneyTolerance: 0.15 };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.zstd')) out.push(p);
  }
  return out;
}
function decompress(file) {
  const buf = fs.readFileSync(file); const parts = []; let start = 0;
  for (let i = 1; i < buf.length - 3; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) { parts.push(buf.subarray(start, i)); start = i; }
  }
  parts.push(buf.subarray(start));
  const out = [];
  for (const p of parts) { if (p.length < 8) continue; try { out.push(zlib.zstdDecompressSync(p)); } catch {} }
  return Buffer.concat(out).toString('utf8');
}

// 收集助手消息文本
const texts = [];
for (const f of walk(ROOT)) {
  let raw = '';
  try { raw = decompress(f); } catch { continue; }
  for (const line of raw.split('\n')) {
    if (!line.includes('"assistant/message"')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    // 事件结构：{type, seq, time, data:{message:{content:[...]}}}
    const t = e?.data?.message?.content ?? e?.message?.content ?? e?.content;
    let s = '';
    if (typeof t === 'string') s = t;
    else if (Array.isArray(t)) s = t.filter((x) => x && x.type === 'text').map((x) => x.text).join('\n');
    if (s && s.length > 80 && !s.startsWith('【核验】')) texts.push(s);
  }
}
// 均匀采样，避免全是今天的
const step = Math.max(1, Math.floor(texts.length / LIMIT));
const sample = texts.filter((_, i) => i % step === 0).slice(0, LIMIT);

let sentences = 0, claimsTotal = 0, verifiable = 0;
const byKind = {};
const unresolvable = {};

for (const text of sample) {
  const sents = text.split(/[。！？\n]+/).filter((s) => s.trim().length > 4);
  sentences += sents.length;

  let claims = [];
  try { claims = [...extractClaims(text), ...extractHostClaims(text)]; } catch { claims = []; }

  // 去重（同 kind+value 只算一次）
  const seen = new Set();
  for (const c of claims) {
    const k = c.kind + '|' + JSON.stringify(c.value);
    if (seen.has(k)) continue;
    seen.add(k);
    claimsTotal += 1;
    let ok = false;
    try {
      if (['pid', 'lines', 'size', 'hash', 'pkgversion', 'mem', 'disk', 'service', 'registry', 'task'].includes(c.kind))
        ok = (await verifyHostClaim(c, CFG)) !== null;
      else {
        const r = await verifyClaims([c], 'corpus', CFG);
        ok = (r.checked || 0) > 0;
      }
    } catch { ok = false; }
    if (ok) { verifiable += 1; byKind[c.kind] = (byKind[c.kind] || 0) + 1; }
    else unresolvable[c.kind] = (unresolvable[c.kind] || 0) + 1;
  }
}

const pct = (n, d) => (d ? (n / d * 100).toFixed(1) + '%' : 'n/a');
console.log('语料复测（当前代码）\n');
console.log('采样消息 ' + sample.length + ' 条（库内 ' + texts.length + ' 条）');
console.log('句子数 ' + sentences);
console.log('抽取到断言 ' + claimsTotal + ' 条');
console.log('能取到客观真值 ' + verifiable + ' 条\n');
console.log('**可核验密度 = ' + pct(verifiable, sentences) + '**（每 100 句里可核验的断言数）');
console.log('断言中可核验比例 = ' + pct(verifiable, claimsTotal));
console.log('\n按类型（可核验）：' + (Object.keys(byKind).length ? JSON.stringify(byKind) : '无'));
console.log('取不到真值（按类型）：' + (Object.keys(unresolvable).length ? JSON.stringify(unresolvable) : '无'));
process.exit(0);
