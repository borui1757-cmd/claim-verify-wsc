// 真机跑：拿真实会话的 5 轮，做句子级三分类核验
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { createTrace } from '../lib/trace.js';
import { auditReport, summarize } from '../lib/sentence-audit.js';
import { makeHttpTransport } from '../lib/claim-reader.js';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const read = (f) => {
  const buf = fs.readFileSync(f); const st = []; let i = buf.indexOf(MAGIC);
  while (i !== -1) { st.push(i); i = buf.indexOf(MAGIC, i + 4); }
  const out = []; for (let k = 0; k < st.length; k++) { const e = k + 1 < st.length ? st[k + 1] : buf.length; try { out.push(zlib.zstdDecompressSync(buf.subarray(st[k], e))); } catch {} }
  return Buffer.concat(out).toString('utf8');
};
const walk = (d, a = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, a); else if (e.name.endsWith('.jsonl.zstd')) a.push(p); } return a; };

const transport = makeHttpTransport({ model: process.env.M || 'free-first', timeoutMs: 60000 });
const files = walk(path.join(os.homedir(), '.dsh', 'sessions'));
const trace = createTrace();
const samples = [];
for (const f of files.slice(0, 10)) {
  let raw; try { raw = read(f); } catch { continue; }
  const sid = path.basename(path.dirname(f)); const session = { id: sid };
  const rep = new Map(); const turns = new Set();
  for (const line of raw.split('\n')) {
    if (!line.includes('"tool/') && !line.includes('"assistant/message"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'tool/call' || o.type === 'tool/result') { trace.onEvent(session, o); if (o.type === 'tool/call' && o.data?.turn !== undefined) turns.add(o.data.turn); continue; }
    const c = o.data?.message?.content;
    if (Array.isArray(c)) { const t = c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n').trim(); if (t && t.length > 150) rep.set(o.data.turn, t); }
  }
  for (const t of turns) { if (!rep.has(t)) continue; const { pairs } = trace.pairs(sid, t); if (pairs.length) samples.push({ sid, turn: t, report: rep.get(t), pairs }); }
  trace.clear(sid);
  if (samples.length >= 5) break;
}

const all = [];
for (const s of samples.slice(0, 5)) {
  try {
    const r = await auditReport(s.report, { pairs: s.pairs, transport });
    all.push(...r.verdicts);
    console.log(`\n[${s.sid.slice(-8)} t${s.turn}] 句子 ${r.sentences.length} 条，证据 ${r.groundingChars} 字，prompt ${r.promptChars} 字`);
    for (const v of r.verdicts) console.log(`  ${v.verdict.padEnd(13)} ${v.sentence.slice(0, 46)}${v.reason ? '  ← ' + v.reason : ''}`);
  } catch (e) { console.log(`\n[${s.sid.slice(-8)} t${s.turn}] 失败: ${e.message}`); }
}
console.log('\n汇总:', JSON.stringify(summarize(all)));
