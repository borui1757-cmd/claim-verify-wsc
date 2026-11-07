#!/usr/bin/env node
// 差分测试：两套独立实现跑同一批样本，比较一致率并列出分歧。
//
//   A（主实现）：extractEvidence + decideClaims   —— 先抽 typed 证据，再按规则判定
//   B（独立实现）：decideAlt                      —— 直接扫原始 pairs，两段式命中
//
// 两者不共享任何辅助函数。一致率高 → 判定不是实现偶然；分歧 → 逐条看谁对。
//
// 用法：node eval/differential.mjs [--limit 400]

import fs from 'node:fs';
import { extractEvidence, decideClaims } from '../lib/isolated-audit.js';
import { decideAlt } from '../lib/decide-alt.js';

const args = process.argv.slice(2);
const limit = Math.max(10, Number((args[args.indexOf('--limit') + 1]) || 400));

const FAIL_TEXT = /(?:^\s*(?:FAIL|FAILED|Error|ERROR|npm ERR!|exit code [1-9])|(?:^|\n)\s*(?:Traceback|panic:))/m;
const isFail = (e) => e.isError || e.textFailed === true;
const normPath = (p) => (typeof p === 'string' ? p.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase() : null);

const casesFile = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/data/harvested-cases.jsonl';
if (!fs.existsSync(casesFile)) {
  console.error('没有 harvested-cases.jsonl：先跑 node bin/harvest.mjs');
  process.exit(2);
}
const cases = fs.readFileSync(casesFile, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-limit);

const rows = [];
for (const c of cases) {
  const ev = extractEvidence(c.pairs || []);
  const okWrites = ev.writes.filter((w) => !isFail(w) && w.path);
  const okCmds = ev.cmds.filter((x) => !isFail(x) && x.cmd);
  const okPaths = new Set(okWrites.map((w) => normPath(w.path)));
  const okCmdSet = new Set(okCmds.map((x) => String(x.cmd)));
  const okCmdList = [...okCmdSet];
  const cmdAmbiguous = (t) => okCmdList.some((s) => s.includes(t) || t.includes(s));

  const claims = [];
  for (const w of okWrites) claims.push({ sentence: `写入了 ${w.path}`, kind: 'write', target: w.path, label: 'supported' });
  for (const x of okCmds) claims.push({ sentence: `执行了 ${x.cmd}`, kind: 'cmd', target: x.cmd, label: 'supported' });
  for (const w of ev.writes.filter((x) => isFail(x) && x.path && !okPaths.has(normPath(x.path)))) claims.push({ sentence: `成功写入了 ${w.path}`, kind: 'write', target: w.path, label: 'contradicted' });
  for (const x of ev.cmds.filter((y) => isFail(y) && y.cmd && !okCmdSet.has(String(y.cmd)) && !cmdAmbiguous(String(y.cmd)))) claims.push({ sentence: `成功执行了 ${x.cmd}`, kind: 'cmd', target: x.cmd, label: 'contradicted' });

  for (const cl of claims) {
    const a = decideClaims([{ sentence: cl.sentence, kind: cl.kind, target: cl.target }], ev)[0]?.verdict || 'insufficient';
    const b = decideAlt({ sentence: cl.sentence, kind: cl.kind, target: cl.target }, c.pairs || []);
    rows.push({ ...cl, A: a, B: b, agree: a === b });
  }
}

const total = rows.length;
const agree = rows.filter((r) => r.agree).length;
const rate = total ? agree / total : 0;
const disagreements = rows.filter((r) => !r.agree);

console.log(`样本 ${total} 条；两套实现一致 ${agree} 条（${(rate * 100).toFixed(2)}%）；分歧 ${disagreements.length} 条`);

const byPair = {};
for (const d of disagreements) {
  const k = `${d.A} vs ${d.B}`;
  byPair[k] = (byPair[k] || 0) + 1;
}
for (const [k, n] of Object.entries(byPair).sort((x, y) => y[1] - x[1]))
  console.log(`  分歧型 ${k}: ${n}`);

// 各自在专家标签（构造标签）上的表现
function score(key) {
  let tp = 0; let fp = 0; let fn = 0;
  for (const r of rows) {
    const wantBad = r.label === 'contradicted';
    const gotBad = r[key] === 'contradicted';
    if (gotBad && wantBad) tp += 1;
    else if (gotBad) fp += 1;
    else if (wantBad) fn += 1;
  }
  const p = tp + fp ? tp / (tp + fp) : 0;
  const rec = tp + fn ? tp / (tp + fn) : 0;
  return { tp, fp, fn, p, rec };
}
const SA = score('A');
const SB = score('B');
const fmt = (x) => (x * 100).toFixed(1) + '%';
console.log(`\n主实现 A：精度 ${fmt(SA.p)} 召回 ${fmt(SA.rec)}`);
console.log(`独立实现 B：精度 ${fmt(SB.p)} 召回 ${fmt(SB.rec)}`);

const out = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/eval/differential.md';
fs.writeFileSync(out, [
  `# 差分测试（${new Date().toISOString().slice(0, 10)}）`,
  '',
  `样本 ${total}；一致 ${agree}（${(rate * 100).toFixed(2)}%）；分歧 ${disagreements.length}`,
  '',
  '| 实现 | 精度 | 召回 |',
  '|---|---|---|',
  `| 主实现 A（extractEvidence + decideClaims） | ${fmt(SA.p)} | ${fmt(SA.rec)} |`,
  `| 独立实现 B（decideAlt，直接扫 pairs） | ${fmt(SB.p)} | ${fmt(SB.rec)} |`,
  '',
  '## 分歧样例',
  ...disagreements.slice(0, 15).map((d) => `- [${d.label}] ${d.sentence.slice(0, 80)} → A=${d.A} / B=${d.B}`),
].join('\n'));
console.log('\n已写入 ' + out);
