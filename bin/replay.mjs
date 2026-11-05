#!/usr/bin/env node
// 离线重放：用留档的案例重跑结构对账，看判定会不会变（换规则/换阈值后对比用）。
//
// 用法：
//   node bin/replay.mjs            # 重放全部案例，摘要对比
//   node bin/replay.mjs --case 2   # 只看第 2 条
//   node bin/replay.mjs --json     # 机器可读

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pairsOfCase } from '../lib/cases.js';
import { checkPromises, summarizePromises } from '../lib/promise.js';

const args = process.argv.slice(2);
const caseNo = args.includes('--case') ? Number(args[args.indexOf('--case') + 1]) : null;
const file = path.join(os.homedir(), '.dsh', 'dsh-claim-verify', 'cases.jsonl');
if (!fs.existsSync(file)) {
  console.log('还没有 cases.jsonl（结构对账跑过一轮后才会生成）');
  process.exit(0);
}

const all = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

const picked = caseNo ? [all[caseNo - 1]].filter(Boolean) : all;
const out = picked.map((c) => {
  const r = checkPromises(c.report, pairsOfCase(c), { claimTurn: c.turn ?? undefined });
  return { at: c.at, turn: c.turn, counts: summarizePromises(r.results), results: r.results };
});

if (args.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
for (const [i, o] of out.entries()) {
  const s = o.counts;
  console.log(`#${(caseNo || i + 1)}  ${o.at?.slice(11, 19)}  turn=${o.turn}  ${s.supported}支持/${s.contradicted}反驳/${s.uncertain}不确定`);
  for (const r of o.results.filter((x) => x.verdict === 'contradicted'))
    console.log(`     contradicted: ${r.sentence.slice(0, 60)}  ← ${r.evidence}`);
}
console.log(`\n共重放 ${out.length} 条案例`);
