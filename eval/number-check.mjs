// number-check.mjs —— 不用人工标注，直接给 number_without_tool 分层定因
// 层次：当轮工具输出 → 整个会话工具输出（搬运）→ 用户原话（合法）→ 哪儿都没有（疑似编造）
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

const NUM_RE = /((?:PID|pid)\s*\d{3,}|\d+(?:\.\d+)?\s*(?:MB|GB|KB))\b/;
const squash = (s) => String(s || '').replace(/\s+/g, '');

const files = walk(path.join(os.homedir(), '.dsh', 'sessions'));
const trace = createTrace();
let hits = 0, resolved = 0, carry = 0, fromUser = 0, nowhere = 0;
const samples = [];

for (const f of files) {
  let raw; try { raw = read(f); } catch { continue; }
  const sid = path.basename(path.dirname(f)).slice(-8);
  const session = { id: sid };
  const rep = new Map();
  const full = new Map();
  const turnsSet = new Set();
  let sessionFull = '';
  let userFull = '';

  for (const line of raw.split('\n')) {
    if (!line.includes('"tool/') && !line.includes('"assistant/message"') && !line.includes('"user/message"'))
      continue;
    let o; try { o = JSON.parse(line); } catch { continue; }

    if (o.type === 'user/message') {
      const uc = o.data?.message?.content;
      const ut = typeof uc === 'string' ? uc : (Array.isArray(uc) ? uc.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : '');
      if (ut) userFull += '\n' + ut;
      continue;
    }

    if (o.type === 'tool/call' || o.type === 'tool/result') {
      trace.onEvent(session, o);
      if (o.type === 'tool/result') {
        const t = o.data?.turn;
        const c = o.data?.message?.content;
        const txt = Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : '';
        if (t !== undefined && txt) {
          full.set(t, (full.get(t) || '') + '\n' + txt);
          sessionFull += '\n' + txt;
        }
      }
      if (o.type === 'tool/call' && o.data?.turn !== undefined) turnsSet.add(o.data.turn);
      continue;
    }

    const c = o.data?.message?.content;
    if (Array.isArray(c)) {
      const t = c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n').trim();
      if (t) rep.set(o.data.turn, (rep.get(o.data.turn) || '') + '\n' + t);
    }
  }

  const sFullSquashed = squash(sessionFull);
  const uFullSquashed = squash(userFull);

  for (const t of turnsSet) {
    const text = rep.get(t);
    if (!text) continue;
    const { pairs } = trace.pairs(sid, t);
    if (!pairs.length) continue;
    const vs = checkRules(text, pairs).filter((v) => v.rule === 'number_without_tool');
    if (!vs.length) continue;
    const m = NUM_RE.exec(text);
    if (!m) continue;
    hits += 1;
    const key = squash(m[1]);
    if (squash(full.get(t)).includes(key)) { resolved += 1; continue; }
    if (sFullSquashed.includes(key)) { carry += 1; continue; }
    if (uFullSquashed.includes(key)) { fromUser += 1; continue; }
    nowhere += 1;
    if (samples.length < 10) samples.push({ sid, turn: t, num: m[1] });
  }
  trace.clear(sid);
}

const pct = (n) => (hits ? (n / hits * 100).toFixed(1) : '0.0');
console.log(`number_without_tool 命中 ${hits} 次`);
console.log(`  当轮工具输出里其实有（假阳性）   ${resolved}  ${pct(resolved)}%`);
console.log(`  当轮没有、前面轮次有（搬运）     ${carry}  ${pct(carry)}%`);
console.log(`  来自用户原话（合法）             ${fromUser}  ${pct(fromUser)}%`);
console.log(`  哪儿都没有（疑似编造）           ${nowhere}  ${pct(nowhere)}%`);
if (samples.length) {
  console.log('\n哪儿都没有的样本：');
  for (const s of samples) console.log(`  [${s.sid} t${s.turn}] 「${s.num}」`);
}
