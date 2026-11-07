// adjudicate.mjs —— 通用分层回溯：不用人工标注，给每条规则估精度
//
// 原理（规则无关）：
//   L1 当轮证据触发  → 命中
//   L2 换成整个会话的证据再跑一次
//      · 不再触发 → 证据在别的轮次（搬运/陈旧引用），不是编造
//      · 仍然触发 → 整份会话都找不到依据 → 嫌疑样本
//
// 这样每条规则都能算出「嫌疑率」，不需要人一条条标。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { createTrace } from '../lib/trace.js';
import { checkRules, RULES } from '../lib/rules.js';

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
const stat = new Map();   // rule -> {total, carry, suspect}
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

  const { pairs: allPairs } = trace.pairs(sid);   // 整会话证据

  for (const t of turnsSet) {
    const text = rep.get(t);
    if (!text) continue;
    const { pairs } = trace.pairs(sid, t);
    if (!pairs.length) continue;
    turns += 1;

    for (const v of checkRules(text, pairs, { allPairs })) {
      if (!stat.has(v.rule)) stat.set(v.rule, { total: 0, carry: 0, suspect: 0 });
      const s = stat.get(v.rule);
      s.total += 1;

      // L2：换成整个会话的证据
      const wide = checkRules(text, allPairs, { allPairs }).some((x) => x.rule === v.rule);
      if (wide) {
        s.suspect += 1;
        if (!samples.has(v.rule)) samples.set(v.rule, []);
        const arr = samples.get(v.rule);
        if (arr.length < 3) arr.push({ sid, turn: t, evidence: v.evidence });
      }
      else {
        s.carry += 1;
      }
    }
  }
  trace.clear(sid);
}

console.log(`扫 ${files.length} 个会话 / ${turns} 个有工具调用的轮次\n`);
const rows = [...stat.entries()].sort((a, b) => b[1].total - a[1].total);
console.log('规则'.padEnd(28) + '命中   搬运   嫌疑   嫌疑率');
for (const [rule, s] of rows) {
  const rate = s.total ? (s.suspect / s.total * 100).toFixed(1) : '0.0';
  console.log(`${rule.padEnd(28)}${String(s.total).padStart(4)}   ${String(s.carry).padStart(4)}   ${String(s.suspect).padStart(4)}   ${rate.padStart(5)}%`);
}
console.log('\n--- 嫌疑样本（整会话证据仍不支持）---');
for (const [rule, arr] of samples)
  for (const s of arr)
    console.log(`  [${rule}] ${s.sid} t${s.turn}  ${s.evidence.slice(0, 80)}`);
