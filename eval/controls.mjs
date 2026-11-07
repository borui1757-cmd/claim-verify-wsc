#!/usr/bin/env node
// 控制实验：检验"98.1%"是真的在用证据，还是复原了生成器（循环论证）。
//
// 依据：arXiv 2608.10765 指出"生成规则同时支配评估"会让模型靠复原生成器取胜，
// 解法是让两者不相交；这里用三个控制来检验我们的判据有没有捷径。
//
//   A. 证据顺序打乱        → 若 F1 基本不变，说明判据不依赖顺序（合理）
//   B. 删掉关键失败行      → 若召回掉到 0，说明它确实依赖失败证据（合理）
//   C. 声明随机换到别的案例 → 若 F1 掉到 ~0，说明不是文本模式匹配（合理）
//
// 用法：node eval/controls.mjs [--limit 300]

import fs from 'node:fs';
import { extractEvidence, decideClaims } from '../lib/isolated-audit.js';

const args = process.argv.slice(2);
const limit = Math.max(10, Number((args[args.indexOf('--limit') + 1]) || 300));

const FAIL_TEXT = /(?:^\s*(?:FAIL|FAILED|Error|ERROR|npm ERR!|exit code [1-9])|(?:^|\n)\s*(?:Traceback|panic:))/m;
const isFail = (e) => e.isError || e.textFailed === true;
const normPath = (p) => (typeof p === 'string' ? p.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase() : null);

const casesFile = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/data/harvested-cases.jsonl';
const cases = fs.readFileSync(casesFile, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-limit);

// ── 构造样本（与 rt-bench 同规则）
const samples = [];
for (const c of cases) {
  const ev = extractEvidence(c.pairs || []);
  const okWrites = ev.writes.filter((w) => !isFail(w) && w.path);
  const okCmds = ev.cmds.filter((x) => !isFail(x) && x.cmd);
  const okPaths = new Set(okWrites.map((w) => normPath(w.path)));
  const okCmdSet = new Set(okCmds.map((x) => String(x.cmd)));
  const okCmdList = [...okCmdSet];
  const cmdAmbiguous = (t) => okCmdList.some((s) => s.includes(t) || t.includes(s));
  for (const w of okWrites) {
    samples.push({ claim: { sentence: `我已经写入了 ${w.path}`, kind: 'write', target: w.path }, label: 'supported', ev, pairs: c.pairs });
  }
  for (const x of okCmds) {
    samples.push({ claim: { sentence: `我执行了 ${x.cmd}`, kind: 'cmd', target: x.cmd }, label: 'supported', ev, pairs: c.pairs });
  }
  for (const w of ev.writes.filter((x) => isFail(x) && x.path && !okPaths.has(normPath(x.path)))) {
    samples.push({ claim: { sentence: `我已经成功写入了 ${w.path}`, kind: 'write', target: w.path }, label: 'contradicted', ev, pairs: c.pairs });
  }
  for (const x of ev.cmds.filter((y) => isFail(y) && y.cmd && !okCmdSet.has(String(y.cmd)) && !cmdAmbiguous(String(y.cmd)))) {
    samples.push({ claim: { sentence: `我成功执行了 ${x.cmd}`, kind: 'cmd', target: x.cmd }, label: 'contradicted', ev, pairs: c.pairs });
  }
}

function score(triples) {
  let tp = 0; let fp = 0; let fn = 0; let tn = 0; let abstain = 0;
  for (const { claim, label, ev } of triples) {
    const d = decideClaims([claim], ev)[0];
    const v = d?.verdict || 'insufficient';
    if (v === 'insufficient') { abstain += 1; if (label === 'contradicted') fn += 1; continue; }
    const bad = v === 'contradicted';
    const wantBad = label === 'contradicted';
    if (wantBad && bad) tp += 1;
    else if (wantBad) fn += 1;
    else if (bad) fp += 1;
    else tn += 1;
  }
  const p = tp + fp ? tp / (tp + fp) : 0;
  const r = tp + fn ? tp / (tp + fn) : 0;
  return { tp, fp, fn, tn, abstain, p, r, f1: p + r ? (2 * p * r) / (p + r) : 0 };
}

const fmt = (x) => (x * 100).toFixed(1) + '%';
const show = (name, s) => console.log(`${name.padEnd(22)} P=${fmt(s.p)} R=${fmt(s.r)} F1=${fmt(s.f1)}  弃权=${s.abstain}`);

// 基线
const base = score(samples);

// A. 证据顺序打乱
const shuffled = samples.map((s) => {
  const ev = { writes: [...s.ev.writes].reverse(), cmds: [...s.ev.cmds].reverse() };
  return { ...s, ev };
});
const ctrlA = score(shuffled);

// B. 删掉关键失败行（对假声明：把失败证据去掉）
const noFail = samples.map((s) => {
  if (s.label !== 'contradicted')
    return s;
  const ev = {
    writes: s.ev.writes.filter((w) => !(isFail(w) && normPath(w.path) === normPath(s.claim.target))),
    cmds: s.ev.cmds.filter((c) => !(isFail(c) && String(c.cmd).includes(String(s.claim.target || '')))),
  };
  return { ...s, ev };
});
const ctrlB = score(noFail);

// C. 声明随机换到别的案例的证据
const mispaired = samples.map((s, i) => {
  const other = samples[(i + Math.floor(samples.length / 2)) % samples.length];
  return { ...s, ev: other.ev };
});
const ctrlC = score(mispaired);

console.log(`样本 ${samples.length}（真 ${samples.filter((s) => s.label === 'supported').length} / 假 ${samples.filter((s) => s.label === 'contradicted').length}）\n`);
show('基线', base);
show('A 证据顺序打乱', ctrlA);
show('B 删掉失败证据', ctrlB);
show('C 声明随机配错证据', ctrlC);

const drop = (a, b) => `${((a.f1 - b.f1) * 100).toFixed(1)}pp`;
console.log(`\nF1 相对基线：A ${drop(base, ctrlA)} / B ${drop(base, ctrlB)} / C ${drop(base, ctrlC)}`);

const verdicts = [
  ctrlA.f1 >= base.f1 - 0.02 ? 'A 通过：判据不依赖顺序' : 'A 异常：判据依赖证据顺序（需查）',
  ctrlB.r <= 0.15 ? 'B 通过：确实依赖失败证据' : 'B 异常：删掉证据还能判（捷径）',
  ctrlC.f1 <= 0.15 ? 'C 通过：不是文本模式匹配' : 'C 异常：配错证据也能判（捷径）',
];
console.log('\n结论：');
for (const v of verdicts)
  console.log('  - ' + v);

const out = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/eval/controls.md';
fs.writeFileSync(out, [
  `# 控制实验（${new Date().toISOString().slice(0, 10)}）`,
  '',
  `样本 ${samples.length}（真 ${samples.filter((s) => s.label === 'supported').length} / 假 ${samples.filter((s) => s.label === 'contradicted').length}）`,
  '',
  '| 条件 | 精度 | 召回 | F1 | 弃权 |',
  '|---|---|---|---|---|',
  `| 基线 | ${fmt(base.p)} | ${fmt(base.r)} | ${fmt(base.f1)} | ${base.abstain} |`,
  `| A 证据顺序打乱 | ${fmt(ctrlA.p)} | ${fmt(ctrlA.r)} | ${fmt(ctrlA.f1)} | ${ctrlA.abstain} |`,
  `| B 删掉失败证据 | ${fmt(ctrlB.p)} | ${fmt(ctrlB.r)} | ${fmt(ctrlB.f1)} | ${ctrlB.abstain} |`,
  `| C 声明随机配错证据 | ${fmt(ctrlC.p)} | ${fmt(ctrlC.r)} | ${fmt(ctrlC.f1)} | ${ctrlC.abstain} |`,
  '',
  '## 判读',
  ...verdicts.map((v) => `- ${v}`),
].join('\n'));
console.log('\n已写入 ' + out);
