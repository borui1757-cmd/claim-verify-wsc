// 摸清每个工具 arguments 的键（arguments 是 JSON 字符串，要解析两层）
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
    try { out.push(zlib.zstdDecompressSync(buf.subarray(starts[k], end))); } catch { /* skip */ }
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
const perTool = new Map();

for (const f of files.slice(0, 12)) {
  let raw;
  try { raw = readSession(f); } catch { continue; }
  for (const line of raw.split('\n')) {
    if (!line.includes('"tool/call"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'tool/call') continue;
    const { name, arguments: a } = o.data || {};
    let args = {};
    try { args = typeof a === 'string' ? JSON.parse(a) : (a || {}); } catch { args = { '<unparsable>': true }; }
    if (!perTool.has(name)) perTool.set(name, { n: 0, keys: new Map() });
    const t = perTool.get(name);
    t.n += 1;
    const sig = Object.keys(args).sort().join(',');
    t.keys.set(sig, (t.keys.get(sig) || 0) + 1);
  }
}

const rows = [...perTool.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 14);
console.log('工具'.padEnd(28) + '次数   参数键');
for (const [name, t] of rows) {
  const top = [...t.keys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  console.log(`${name.padEnd(28)}${String(t.n).padStart(4)}   ${top.map(([k, n]) => `${k || '<空>'} (${n})`).join('   |   ')}`);
}
