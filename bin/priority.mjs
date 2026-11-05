#!/usr/bin/env node
// 矛盾驱动的优先级队列
//
//   node bin/priority.mjs            打印待解释矛盾（按优先级）
//   node bin/priority.mjs --limit 5

import { priorityQueue, prioritySummary } from '../lib/priority.js';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const limit = Math.max(1, Number(argOf('limit') || 20));

console.log(prioritySummary());
const q = priorityQueue({ limit });
if (!q.length)
  process.exit(0);

console.log('');
console.log('得分  被证伪  类型    对象');
for (const x of q)
  console.log(`${String(x.score).padStart(5)}  ${String(x.count).padStart(5)}  ${x.kind.padEnd(6)} ${x.target}`);
