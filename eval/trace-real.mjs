// trace-real.mjs —— 拿真实会话跑一遍 trace + evidence，看能抽出多少可对账的动作。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { createTrace } from '../lib/trace.js';
import { buildEvidence } from '../lib/evidence.js';

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

const files = walk(path.join(os.homedir(), '.dsh', 'sessions')).slice(0, 12);
const trace = createTrace();
let turns = 0;
const agg = { writes: 0, writeFail: 0, cmds: 0, cmdFail: 0, noResult: 0, truncatedTurns: 0 };

for (const f of files) {
  let raw;
  try { raw = readSession(f); } catch { continue; }
  const sid = path.basename(path.dirname(f));
  const session = { id: sid };
  const turnSeen = new Set();
  for (const line of raw.split('\n')) {
    if (!line.includes('"tool/')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'tool/call' || o.type === 'tool/result') {
      trace.onEvent(session, o);
      if (o.type === 'tool/call' && o.data?.turn !== undefined)
        turnSeen.add(o.data.turn);
    }
  }
  for (const t of turnSeen) {
    const { pairs, truncated } = trace.pairs(sid, t);
    if (!pairs.length) continue;
    turns += 1;
    if (truncated) agg.truncatedTurns += 1;
    const ev = buildEvidence(pairs, truncated);
    agg.writes += ev.writes.length;
    agg.writeFail += ev.writes.filter((w) => !w.ok).length;
    agg.cmds += ev.commands.length;
    agg.cmdFail += ev.commands.filter((c) => !c.ok).length;
    agg.noResult += ev.writes.filter((w) => !w.resultSeen).length;
  }
  trace.clear(sid);
}

console.log(`扫描 ${files.length} 个会话，${turns} 个有工具调用的轮次`);
console.log(`可对账的动作：写/改文件 ${agg.writes} 条（失败 ${agg.writeFail}，无结果 ${agg.noResult}）`);
console.log(`                执行命令 ${agg.cmds} 条（失败 ${agg.cmdFail}）`);
console.log(`轨迹被截断的轮次：${agg.truncatedTurns}`);
const rate = agg.writes + agg.cmds ? ((agg.writeFail + agg.cmdFail) / (agg.writes + agg.cmds) * 100).toFixed(1) : '0';
console.log(`\n动作失败率：${rate}%  —— 这些是"说做了但其实失败了"的高危候选`);
