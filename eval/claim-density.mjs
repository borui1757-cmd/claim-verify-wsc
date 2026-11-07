#!/usr/bin/env node
// 声明密度分布：agent 报告里到底有多少「可核验声明」？
//
// 输出（零模型调用）：
//   ① 每份报告的声明数分布（histogram）
//   ② 可核验比例（claim 能落到具体目标：路径/端口/命令/计数/算式）
//   ③ 声明类型构成
//   ④ 与样例（30 份 → 1 条可用）的对照
//
// 用法：node eval/claim-density.mjs [--limit 2000]

import fs from 'node:fs';
import { sentencesOf, isClaimSentence } from '../lib/promise.js';
import { looksCheckable } from '../lib/claim-dsl.js';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const LIMIT = Math.max(10, argOf('limit') || 2000);

const file = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/data/harvested-cases.jsonl';
const cases = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-LIMIT);

const reports = [];
let totalSentences = 0;
let totalClaims = 0;
let totalCheckable = 0;
const kindCount = new Map();

const PATH = /[A-Za-z]:\\[^\s"'）)，。；]+|(?:^|\s)(?:\/[\w.-]+){2,}/;
const PORT = /(?:端口|port)[^\d]{0,6}(\d{2,5})|:(\d{4,5})\b/i;
const CMD = /\b(?:npm|node|git|pnpm|pip|python|pwsh|powershell|cmd|docker|curl)\b/i;
const NUM = /\d+(?:\.\d+)?\s*(?:个|条|次|行|项|%|字节|MB|GB)?/;

for (const c of cases) {
  const text = String(c.report || '');
  if (!text.trim())
    continue;
  const sents = sentencesOf(text);
  totalSentences += sents.length;

  let claims = 0;
  let checkable = 0;
  for (const s of sents) {
    if (!isClaimSentence(s))
      continue;
    claims += 1;
    let kind = null;
    if (PATH.test(s))
      kind = 'path';
    else if (PORT.test(s))
      kind = 'port';
    else if (CMD.test(s))
      kind = 'cmd';
    else if (NUM.test(s))
      kind = 'count';
    if (kind) {
      kindCount.set(kind, (kindCount.get(kind) || 0) + 1);
      if (looksCheckable(s))
        checkable += 1;
    }
  }
  totalClaims += claims;
  totalCheckable += checkable;
  reports.push({ claims, checkable, sents: sents.length, chars: text.length });
}

const n = reports.length || 1;
const dist = (arr, key) => {
  const buckets = [0, 0, 0, 0, 0]; // 0 / 1 / 2 / 3-4 / 5+
  for (const r of arr) {
    const v = r[key];
    buckets[v === 0 ? 0 : v === 1 ? 1 : v === 2 ? 2 : v <= 4 ? 3 : 4] += 1;
  }
  return buckets;
};
const mean = (arr, key) => (arr.reduce((a, r) => a + r[key], 0) / n).toFixed(2);
const median = (arr, key) => {
  const v = arr.map((r) => r[key]).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? 0;
};

const claimDist = dist(reports, 'claims');
const checkDist = dist(reports, 'checkable');
const pct = (x, y) => (y ? (x / y * 100).toFixed(1) + '%' : '—');

console.log(`报告 ${n} 份，句子 ${totalSentences} 条\n`);
console.log('每份报告的声明数分布：');
console.log(`  0 条: ${claimDist[0]} 份 (${pct(claimDist[0], n)})`);
console.log(`  1 条: ${claimDist[1]} 份 (${pct(claimDist[1], n)})`);
console.log(`  2 条: ${claimDist[2]} 份 (${pct(claimDist[2], n)})`);
console.log(`  3-4 条: ${claimDist[3]} 份 (${pct(claimDist[3], n)})`);
console.log(`  5+ 条: ${claimDist[4]} 份 (${pct(claimDist[4], n)})`);
console.log(`  均值 ${mean(reports, 'claims')} / 中位 ${median(reports, 'claims')}`);

console.log('\n每份报告的**可核验**声明数分布：');
console.log(`  0 条: ${checkDist[0]} 份 (${pct(checkDist[0], n)})`);
console.log(`  1 条: ${checkDist[1]} 份 (${pct(checkDist[1], n)})`);
console.log(`  2 条: ${checkDist[2]} 份 (${pct(checkDist[2], n)})`);
console.log(`  3-4 条: ${checkDist[3]} 份 (${pct(checkDist[3], n)})`);
console.log(`  5+ 条: ${checkDist[4]} 份 (${pct(checkDist[4], n)})`);
console.log(`  均值 ${mean(reports, 'checkable')} / 中位 ${median(reports, 'checkable')}`);

console.log(`\n声明总数 ${totalClaims}；可核验 ${totalCheckable}（${pct(totalCheckable, totalClaims)}）`);
console.log('声明类型构成：' + [...kindCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));

const out = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/eval/claim-density.md';
fs.writeFileSync(out, [
  `# 声明密度分布（${new Date().toISOString().slice(0, 10)}）`,
  '',
  `报告 ${n} 份、句子 ${totalSentences} 条；声明 ${totalClaims} 条，其中可核验 ${totalCheckable} 条（${pct(totalCheckable, totalClaims)}）。`,
  '',
  '## 每份报告的声明数',
  '',
  '| 区间 | 份数 | 占比 |',
  '|---|---|---|',
  `| 0 | ${claimDist[0]} | ${pct(claimDist[0], n)} |`,
  `| 1 | ${claimDist[1]} | ${pct(claimDist[1], n)} |`,
  `| 2 | ${claimDist[2]} | ${pct(claimDist[2], n)} |`,
  `| 3–4 | ${claimDist[3]} | ${pct(claimDist[3], n)} |`,
  `| 5+ | ${claimDist[4]} | ${pct(claimDist[4], n)} |`,
  '',
  `均值 ${mean(reports, 'claims')}，中位数 ${median(reports, 'claims')}。`,
  '',
  '## 每份报告的可核验声明数',
  '',
  '| 区间 | 份数 | 占比 |',
  '|---|---|---|',
  `| 0 | ${checkDist[0]} | ${pct(checkDist[0], n)} |`,
  `| 1 | ${checkDist[1]} | ${pct(checkDist[1], n)} |`,
  `| 2 | ${checkDist[2]} | ${pct(checkDist[2], n)} |`,
  `| 3–4 | ${checkDist[3]} | ${pct(checkDist[3], n)} |`,
  `| 5+ | ${checkDist[4]} | ${pct(checkDist[4], n)} |`,
  '',
  `均值 ${mean(reports, 'checkable')}，中位数 ${median(reports, 'checkable')}。`,
  '',
  '## 类型构成',
  '',
  [...kindCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join('\n'),
].join('\n'));
console.log('\n已写入 ' + out);
