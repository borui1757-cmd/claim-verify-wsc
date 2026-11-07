// adhere.mjs —— 离线回放：拿历史 80 个会话跑规则，看违规命中与误报
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { createTrace } from '../lib/trace.js';
import { checkRules } from '../lib/rules.js';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const read = (f) => {
  const buf = fs.readFileSync(f); const st = []; let i = buf.indexOf(MAGIC);
  while (i !== -1) { st.push(i); i = buf.indexOf(MAGIC, i + 4); }
  const out = []; for (let k = 0; k < st.length; k++) { const e = k + 1 < st.length ? st[k + 1] : buf.length; try { out.push(zlib.zstdDecompressSync(buf.subarray(st[k], e))); } catch {} }
  return Buffer.concat(out).toString('utf8');
};
const walk = (d, a = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, a); else if (e.name.endsWith('.jsonl.zstd')) a.push(p); } return a; };

const files = walk(path.join(os.homedir(), '.dsh', 'sessions'));
const trace = createTrace();
const byRule = new Map();
const samples = new Map();
let turns = 0;

for (const f of files) {
  let raw; try { raw = read(f); } catch { continue; }
  const sid = path.basename(path.dirname(f)).slice(-8);
  const session = { id: sid };
  const rep = new Map();
  const turnsSet = new Set();

  for (const line of raw.split('\n')) {
    if (!line.includes('"tool/') && !line.includes('"assistant/message"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'tool/call' || o.type === 'tool/result') {
      trace.onEvent(session, o);
      if (o.type === 'tool/call' && o.data?.turn !== undefined) turnsSet.add(o.data.turn);
      continue;
    }
    const c = o.data?.message?.content;
    if (Array.isArray(c)) {
      const t = c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n').trim();
      if (t) rep.set(o.data.turn, (rep.get(o.data.turn) || '') + '\n' + t);
    }
  }

  for (const t of turnsSet) {
    const text = rep.get(t);
    if (!text) continue;
    const { pairs } = trace.pairs(sid, t);
    if (!pairs.length) continue;
    turns += 1;
    for (const v of checkRules(text, pairs)) {
      byRule.set(v.rule, (byRule.get(v.rule) || 0) + 1);
      if (!samples.has(v.rule)) samples.set(v.rule, []);
      const arr = samples.get(v.rule);
      if (arr.length < 3) arr.push({ sid, turn: t, evidence: v.evidence, conf: v.confidence });
    }
  }
  trace.clear(sid);
}

console.log(`扫 ${files.length} 个会话，${turns} 个有工具调用的轮次\n`);
const rows = [...byRule.entries()].sort((a, b) => b[1] - a[1]);
if (!rows.length) console.log('没有任何规则命中');
for (const [rule, n] of rows) {
  const ruleDef = (await import('../lib/rules.js')).RULES.find((r) => r.id === rule);
  console.log(`${String(n).padStart(4)}x  ${rule}  —— ${ruleDef?.why?.slice(0, 46) || ''}`);
  for (const s of samples.get(rule) || [])
    console.log(`        [${s.sid} t${s.turn}] ${s.evidence.slice(0, 90)} (conf ${s.conf})`);
}
console.log(`\n合计命中 ${rows.reduce((a, b) => a + b[1], 0)} 次，涉及 ${rows.length} 条规则`);
