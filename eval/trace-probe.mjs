// trace-probe.mjs —— 摸清 DSH 真实工具轨迹的结构（为 v0.3 的 evidence schema 打地基）。
// 只读会话文件，不改任何东西。
//
// 用法：node eval/trace-probe.mjs [会话数上限]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function readSession(file) {
  const buf = fs.readFileSync(file);
  const starts = [];
  let i = buf.indexOf(MAGIC);
  while (i !== -1) { starts.push(i); i = buf.indexOf(MAGIC, i + 4); }
  const out = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try { out.push(zlib.zstdDecompressSync(buf.subarray(starts[k], end))); }
    catch { /* 尾帧截断 */ }
  }
  return Buffer.concat(out).toString('utf8');
}

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.jsonl.zstd')) acc.push(p);
  }
  return acc;
}

const files = walk(path.join(os.homedir(), '.dsh', 'sessions'));
const limit = Number(process.argv[2] || files.length);

const calls = [];
const results = [];
let scannedSessions = 0;

for (const f of files.slice(0, limit)) {
  let raw;
  try { raw = readSession(f); }
  catch { continue; }
  scannedSessions += 1;
  for (const line of raw.split('\n')) {
    if (!line.includes('"tool/call"') && !line.includes('"tool/result"'))
      continue;
    let o;
    try { o = JSON.parse(line); }
    catch { continue; }
    if (o.type === 'tool/call') calls.push(o);
    else if (o.type === 'tool/result') results.push(o);
  }
}

console.log(`扫描 ${scannedSessions} 个会话文件`);
console.log(`tool/call   ${calls.length} 条`);
console.log(`tool/result ${results.length} 条\n`);

function keysOf(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.keys(obj) : [];
}

// ── tool/call 的形状 ──────────────────────────────────────────────
const callShape = new Map();
for (const c of calls) {
  const d = c.data || {};
  const tool = d.tool ?? d.name ?? d.toolName ?? d.toolId ?? '<无名字段>';
  const sig = `${keysOf(d).join(',')}  | argsKeys=${keysOf(d.args ?? d.input ?? d.arguments).join(',')}`;
  if (!callShape.has(tool))
    callShape.set(tool, { n: 0, sigs: new Map(), sample: d });
  const s = callShape.get(tool);
  s.n += 1;
  s.sigs.set(sig, (s.sigs.get(sig) || 0) + 1);
}

console.log('=== tool/call 按工具分组（前 15）===');
[...callShape.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15).forEach(([tool, s]) => {
  console.log(`${String(s.n).padStart(4)}x  ${tool}`);
  for (const [sig, n] of [...s.sigs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2))
    console.log(`        ${n}x  ${sig}`);
});

// ── tool/result 的形状 ────────────────────────────────────────────
const resKeys = new Map();
let errFlag = 0;
let withContent = 0;
for (const r of results) {
  const d = r.data || {};
  for (const k of keysOf(d))
    resKeys.set(k, (resKeys.get(k) || 0) + 1);
  if (d.isError === true || d.error || d.ok === false || d.success === false)
    errFlag += 1;
  if (d.content !== undefined)
    withContent += 1;
}

console.log('\n=== tool/result 顶层字段出现次数 ===');
[...resKeys.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => {
  console.log(`  ${String(n).padStart(5)}x  ${k}`);
});
console.log(`\n判定为失败的 ${errFlag} 条 / 共 ${results.length} 条`);
console.log(`带 content 字段的 ${withContent} 条`);

// ── 一条真实样本（脱敏打印）──────────────────────────────────────
function short(v, n = 220) {
  const s = JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + '…' : s;
}
console.log('\n=== 样本：tool/call ===');
for (const [tool, s] of [...callShape.entries()].slice(0, 3))
  console.log(`\n[${tool}]\n${short(s.sample, 500)}`);

console.log('\n=== 样本：tool/result（前 3 条不同形状）===');
const seen = new Set();
for (const r of results) {
  const sig = keysOf(r.data).join(',');
  if (seen.has(sig))
    continue;
  seen.add(sig);
  console.log(`\n[${sig}]\n${short(r.data, 500)}`);
  if (seen.size >= 3)
    break;
}
