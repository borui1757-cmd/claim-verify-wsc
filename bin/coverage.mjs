#!/usr/bin/env node
// 声明覆盖率汇总：agent 实际动作里有多少被它声明了（防"只声明能通过核验的部分"）。
//
// 用法：
//   node bin/coverage.mjs            # 最近 20 份回执
//   node bin/coverage.mjs --limit 50
//   node bin/coverage.mjs --fail     # 只看有未声明动作的

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : undefined;
};
const limit = Math.max(1, Number(argOf('limit') || 20));
const onlyFail = args.includes('--fail');

const file = path.join(os.homedir(), '.dsh', 'dsh-claim-verify', 'receipts.jsonl');
let rows = [];
try {
  rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
catch {
  console.log('还没有 receipts.jsonl');
  process.exit(0);
}

const withCov = rows.filter((r) => r.coverage && Number.isInteger(r.coverage.actual));
const picked = withCov.slice(-limit).filter((r) => (onlyFail ? r.coverage.undeclaredCount > 0 : true));

if (!picked.length) {
  console.log(withCov.length ? '没有匹配的回执。' : '还没有带覆盖率的回执（覆盖率字段是 2026-11-05 之后才有的）。');
  process.exit(0);
}

let sumCov = 0;
let sumActual = 0;
let sumMatched = 0;
for (const r of picked) {
  const c = r.coverage;
  sumCov += c.coverage ?? 0;
  sumActual += c.actual;
  sumMatched += c.matched;
  const flag = c.undeclaredCount > 0 ? '⚠' : '✓';
  console.log(`${flag} ${String(r.at).slice(0, 19)}  实际 ${c.actual} / 声明 ${c.declared} / 对上 ${c.matched}  覆盖 ${Math.round((c.coverage ?? 0) * 100)}%  未声明 ${c.undeclaredCount}`);
}

console.log(`\n共 ${picked.length} 份回执：实际动作 ${sumActual} 个，被声明 ${sumMatched} 个，整体覆盖 ${Math.round((sumMatched / Math.max(1, sumActual)) * 100)}%（逐份均值 ${Math.round((sumCov / picked.length) * 100)}%）`);
if (picked.some((r) => r.coverage.undeclaredCount > 0))
  console.log('有未声明动作的回执：这些动作确实发生了，但 agent 没提 —— 核验层看不到它们。');
