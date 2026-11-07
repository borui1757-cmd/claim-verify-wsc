#!/usr/bin/env node
// 序贯/多源判定：至少两个独立信号一致才下结论，否则弃权。
// 目标：把"关键词误伤"换成"多源确认"，用弃权代替误判。
//
// 信号：
//   S1 isError（结构化）
//   S2 退出码（[exit code: N]）
//   S3 文本失败标记（FAIL/Error/Traceback）
//
// 规则：
//   至少 2 个信号一致 → 下结论
//   只有 1 个信号，或信号冲突 → insufficient（弃权）
//
// 用法：node eval/sequential.mjs

import { adjudicate } from '../lib/adapter.js';

const T = 'C:\\w\\f.txt';
const cases = [];
const noisy = ['12 passing\n0 FAIL', 'all good\nno errors', 'FAIL is a word in this doc, tests passed', 'warning: deprecated\nOK', 'Error handling covered; suite green', '1000 items processed', 'exit code 0'];
noisy.forEach((text, i) => cases.push({ id: `T${i + 1}`, label: 'supported', facts: { cmds: [{ cmd: 'npm test', text, isError: false }] }, claim: { kind: 'cmd', target: 'npm test' } }));
for (let i = 0; i < 5; i += 1) cases.push({ id: `TW${i + 1}`, label: 'supported', facts: { writes: [{ path: T, isError: false }] }, claim: { kind: 'write', target: T } });
for (let i = 0; i < 3; i += 1) cases.push({ id: `TT${i + 1}`, label: 'supported', facts: { tests: { run: true, passed: true } }, claim: { kind: 'test', target: 'npm test' } });
const fails = ['boom\n[exit code: 1]', 'FAILED 3 tests', 'npm ERR! missing script', 'Traceback (most recent call last)'];
fails.forEach((text, i) => cases.push({ id: `F${i + 1}`, label: 'contradicted', facts: { cmds: [{ cmd: 'npm test', text, isError: false }] }, claim: { kind: 'cmd', target: 'npm test' } }));
for (let i = 0; i < 5; i += 1) cases.push({ id: `FW${i + 1}`, label: 'contradicted', facts: { writes: [{ path: T, isError: true }] }, claim: { kind: 'write', target: T } });
for (let i = 0; i < 4; i += 1) cases.push({ id: `FT${i + 1}`, label: 'contradicted', facts: { tests: { run: true, passed: false } }, claim: { kind: 'test', target: 'npm test' } });
for (let i = 0; i < 3; i += 1) cases.push({ id: `FN${i + 1}`, label: 'contradicted', facts: { tests: { run: false, passed: null } }, claim: { kind: 'test', target: 'npm test' } });
for (let i = 0; i < 4; i += 1) cases.push({ id: `A${i + 1}`, label: 'insufficient', facts: { cmds: [{ cmd: 'npm test; Write-Output "after"', text: 'all good' }] }, claim: { kind: 'cmd', target: 'npm test' } });
for (let i = 0; i < 3; i += 1) cases.push({ id: `N${i + 1}`, label: 'insufficient', facts: { writes: [{ path: 'C:\\w\\other.txt', isError: false }] }, claim: { kind: 'write', target: T } });

/** 收集三个信号：'fail' | 'ok' | null（无信号） */
function signals(c) {
  const w = (c.facts.writes || [])[0];
  const cmd = (c.facts.cmds || [])[0];
  const t = c.facts.tests;
  const out = [];

  // S1 结构化 isError
  if (w) out.push(w.isError === true ? 'fail' : 'ok');
  if (cmd) out.push(cmd.isError === true ? 'fail' : 'ok');

  // S2 退出码
  const text = String((cmd && cmd.text) || (w && w.text) || '');
  const m = /\[exit code: (\d+)\]/.exec(text);
  if (m) out.push(Number(m[1]) >= 1 ? 'fail' : 'ok');

  // S3 文本标记
  if (/(FAIL|FAILED|Error|npm ERR!|Traceback)/.test(text)) out.push('fail');
  else if (text.trim()) out.push('ok');

  // 测试汇总信号
  if (t && t.run === false) out.push('fail');
  if (t && t.run === true && t.passed === false) out.push('fail');
  if (t && t.run === true && t.passed === true) out.push('ok');

  return out;
}

function sequentialVerdict(c) {
  const s = signals(c);
  const fails = s.filter((x) => x === 'fail').length;
  const oks = s.filter((x) => x === 'ok').length;
  // 至少两个同向信号
  if (fails >= 2 && oks === 0) return 'contradicted';
  if (oks >= 2 && fails === 0) return 'supported';
  if (fails >= 3) return 'contradicted';
  if (oks >= 3) return 'supported';
  return 'insufficient';
}

/**
 * 结构优先：有结构化信号（isError / tests）就信它；没有才看文本，且文本需第二源佐证。
 */
function structureFirstVerdict(c) {
  const w = (c.facts.writes || [])[0];
  const cmd = (c.facts.cmds || [])[0];
  const t = c.facts.tests;

  // 1) 结构化信号优先
  if (w)
    return w.isError === true ? 'contradicted' : 'supported';
  if (t) {
    if (t.run === false) return 'contradicted';
    if (t.passed === true) return 'supported';
    if (t.passed === false) return 'contradicted';
    return 'insufficient';
  }
  if (cmd) {
    if (cmd.isError === true) return 'contradicted';
    const text = String(cmd.text || '');
    const m = /\[exit code: (\d+)\]/.exec(text);
    // 2) 有可归属退出码 → 信退出码
    if (m && !/;|\n/.test(String(cmd.cmd || ''))) return Number(m[1]) >= 1 ? 'contradicted' : 'supported';
    // 3) 只有文本 → 需要关键词与退出码缺省两条件一致，否则弃权
    return 'insufficient';
  }
  return 'insufficient';
}

function evaluate(fn, name) {
  let fp = 0; let fn_ = 0; let abstain = 0; let correct = 0;
  for (const c of cases) {
    const v = fn(c);
    if (v === 'insufficient') {
      if (c.label === 'insufficient') correct += 1; else abstain += 1;
      continue;
    }
    if (c.label === 'insufficient') { abstain += 1; continue; }
    if (c.label === 'supported' && v === 'contradicted') fp += 1;
    else if (c.label === 'contradicted' && v === 'supported') fn_ += 1;
    else correct += 1;
  }
  const acc = ((correct / cases.length) * 100).toFixed(1);
  console.log(`${name.padEnd(18)} 误伤 ${fp}  漏判 ${fn_}  弃权 ${abstain}  正确率 ${acc}%`);
}

console.log(`用例 ${cases.length} 个\n`);
evaluate((c) => adjudicate(c.facts, c.claim).verdict, 'L2（单次判定）');
evaluate(sequentialVerdict, '序贯（多源确认）');
evaluate(structureFirstVerdict, '结构优先（推荐）');
