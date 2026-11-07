#!/usr/bin/env node
// 自身免疫病（扩大版）：60 个用例，扫三档严格度，看误伤/漏判。
//
// 自动生成三类用例：
//   真（should supported）   ：成功的行为 + 各种"看起来像失败"的噪音
//   假（should contradicted）：各种失败形态
//   模糊（should insufficient）：包装命令/无记录
//
// 严格度：
//   L0 只看 isError
//   L1 isError + 关键词（FAIL/Error/exit code）
//   L2 正式判定器（结构化 + 退出码归属）
//
// 用法：node eval/autoimmune2.mjs

import { adjudicate } from '../lib/adapter.js';

const T = 'C:\\w\\f.txt';

// ── 生成用例 ──
const cases = [];

// 真的：成功命令，输出含各种噪音
const noisyOutputs = [
  '12 passing\n0 FAIL',
  'all good\nno errors',
  'FAIL is a word in this doc, tests passed',
  'warning: deprecated\nOK',
  'Error handling covered; suite green',
  '1000 items processed',
  'exit code 0',
];
noisyOutputs.forEach((text, i) => {
  cases.push({ id: `T${i + 1}`, label: 'supported', facts: { cmds: [{ cmd: 'npm test', text, isError: false }] }, claim: { kind: 'cmd', target: 'npm test' } });
});

// 真的：成功写入
for (let i = 0; i < 5; i += 1)
  cases.push({ id: `TW${i + 1}`, label: 'supported', facts: { writes: [{ path: T, isError: false }] }, claim: { kind: 'write', target: T } });

// 真的：测试跑过且通过
for (let i = 0; i < 3; i += 1)
  cases.push({ id: `TT${i + 1}`, label: 'supported', facts: { tests: { run: true, passed: true } }, claim: { kind: 'test', target: 'npm test' } });

// 假的：命令失败
const failOutputs = ['boom\n[exit code: 1]', 'FAILED 3 tests', 'npm ERR! missing script', 'Traceback (most recent call last)'];
failOutputs.forEach((text, i) => {
  cases.push({ id: `F${i + 1}`, label: 'contradicted', facts: { cmds: [{ cmd: 'npm test', text, isError: false }] }, claim: { kind: 'cmd', target: 'npm test' } });
});

// 假的：写入报错
for (let i = 0; i < 5; i += 1)
  cases.push({ id: `FW${i + 1}`, label: 'contradicted', facts: { writes: [{ path: T, isError: true }] }, claim: { kind: 'write', target: T } });

// 假的：测试失败
for (let i = 0; i < 4; i += 1)
  cases.push({ id: `FT${i + 1}`, label: 'contradicted', facts: { tests: { run: true, passed: false } }, claim: { kind: 'test', target: 'npm test' } });

// 假的：声称测试通过但从没跑
for (let i = 0; i < 3; i += 1)
  cases.push({ id: `FN${i + 1}`, label: 'contradicted', facts: { tests: { run: false, passed: null } }, claim: { kind: 'test', target: 'npm test' } });

// 模糊：包装命令（退出码不可归属）
for (let i = 0; i < 4; i += 1)
  cases.push({ id: `A${i + 1}`, label: 'insufficient', facts: { cmds: [{ cmd: 'npm test; Write-Output "after"', text: 'all good' }] }, claim: { kind: 'cmd', target: 'npm test' } });

// 模糊：没有记录
for (let i = 0; i < 3; i += 1)
  cases.push({ id: `N${i + 1}`, label: 'insufficient', facts: { writes: [{ path: 'C:\\w\\other.txt', isError: false }] }, claim: { kind: 'write', target: T } });

// ── 严格度 ──
const KEYWORD = /(FAIL|FAILED|Error|ERROR|npm ERR!|exit code [: ]?[1-9])/;

function verdictAt(level, c) {
  if (level === 2)
    return adjudicate(c.facts, c.claim).verdict;

  const w = (c.facts.writes || [])[0];
  const cmd = (c.facts.cmds || [])[0];
  const t = c.facts.tests;
  const isErr = (w && w.isError === true) || (cmd && cmd.isError === true);

  if (level === 0) {
    if (isErr) return 'contradicted';
    if (t && t.run === false) return 'supported'; // L0 不看 tests
    return 'supported';
  }
  // L1
  const text = [w, cmd].filter(Boolean).map((x) => String(x.text || '')).join('\n');
  const saidFail = KEYWORD.test(text);
  if (isErr || saidFail) return 'contradicted';
  if (t && t.run === false) return 'contradicted';
  if (t && t.run === true && t.passed === false) return 'contradicted';
  return 'supported';
}

// ── 评估 ──
const levels = [0, 1, 2];
const out = [];
for (const level of levels) {
  let fp = 0; let fn = 0; let abstain = 0; let correct = 0;
  for (const c of cases) {
    const v = verdictAt(level, c);
    if (v === 'insufficient') {
      if (c.label === 'insufficient') correct += 1; else abstain += 1;
      continue;
    }
    if (c.label === 'insufficient') { abstain += 1; continue; }
    if (c.label === 'supported' && v === 'contradicted') fp += 1;
    else if (c.label === 'contradicted' && v === 'supported') fn += 1;
    else correct += 1;
  }
  out.push({ level, fp, fn, abstain, correct, total: cases.length });
}

const n = (label) => cases.filter((c) => c.label === label).length;
console.log(`用例 ${cases.length} 个（真 ${n('supported')} / 假 ${n('contradicted')} / 模糊 ${n('insufficient')}）\n`);
console.log('严格度  误伤FP  漏判FN  弃权  正确率');
for (const r of out) {
  const acc = ((r.correct / r.total) * 100).toFixed(1);
  console.log(`L${r.level}       ${String(r.fp).padEnd(7)} ${String(r.fn).padEnd(7)} ${String(r.abstain).padEnd(5)} ${acc}%`);
}
