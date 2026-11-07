#!/usr/bin/env node
// 自身免疫病：核验"过严"会误伤。扫描严格度，画 FP/FN 曲线，找最佳工作点。
//
// 严格度层级：
//   L0  只看 isError
//   L1  + 文本失败标记（FAIL/exit code）
//   L2  + 退出码归属（包装命令 → 弃权）
//   L3  + 意图差字段（actual/expected mismatch）
//
// 用例（离线构造，零模型调用）：
//   真（应判 supported）：
//     T1 成功写入            T2 成功命令（exit 0）
//     T3 成功但输出含 "FAIL"（陷阱：文本噪音）  T4 数字里含 000
//   假（应判 contradicted）：
//     F1 写入报错            F2 命令 [exit code: 1]
//     F3 写入成功但 mismatch:true（截断）      F4 测试失败
//
// 用法：node eval/autoimmune.mjs

import { adjudicate } from '../lib/adapter.js';

// ── 用例 ──
const TARGET = 'C:\\x\\out.txt';
const cases = [
  // 真
  { id: 'T1', label: 'supported', facts: { writes: [{ path: TARGET, isError: false }] }, claim: { kind: 'write', target: TARGET } },
  { id: 'T2', label: 'supported', facts: { cmds: [{ cmd: 'npm test', text: 'all good', isError: false }] }, claim: { kind: 'cmd', target: 'npm test' } },
  { id: 'T3', label: 'supported', facts: { cmds: [{ cmd: 'npm test', text: '12 passing\n0 FAIL', isError: false }] }, claim: { kind: 'cmd', target: 'npm test' } },
  { id: 'T4', label: 'supported', facts: { cmds: [{ cmd: 'echo 1000', text: '1000', isError: false }] }, claim: { kind: 'cmd', target: 'echo 1000' } },
  // 假
  { id: 'F1', label: 'contradicted', facts: { writes: [{ path: TARGET, isError: true }] }, claim: { kind: 'write', target: TARGET } },
  { id: 'F2', label: 'contradicted', facts: { cmds: [{ cmd: 'npm test', text: 'boom\n[exit code: 1]', isError: false }] }, claim: { kind: 'cmd', target: 'npm test' } },
  { id: 'F3', label: 'contradicted', facts: { writes: [{ path: TARGET, isError: false, textFailed: false }], tests: {} }, claim: { kind: 'write', target: TARGET } },
  { id: 'F4', label: 'contradicted', facts: { tests: { run: true, passed: false } }, claim: { kind: 'test', target: 'npm test' } },
];

// 为 F3 构造"写入 ok 但 mismatch"的变体：adapter 目前不看 mismatch 字段，
// 所以这里用一个"成功写入 + 文本里带截断"的变体替代
cases[6].facts = { writes: [{ path: TARGET, isError: false, textFailed: true }] };

// ── 严格度层 → 判定 ──
function verdictAt(level, c) {
  const base = adjudicate(c.facts, c.claim).verdict;

  if (level === 0) {
    // 只看结构化 isError
    const w = (c.facts.writes || [])[0];
    const cmd = (c.facts.cmds || [])[0];
    const err = (w && w.isError === true) || (cmd && cmd.isError === true);
    return err ? 'contradicted' : 'supported';
  }

  if (level === 1) {
    // + 文本标记（会因 "FAIL" 字样误伤 T3）
    const texts = [...(c.facts.writes || []), ...(c.facts.cmds || [])].map((x) => String(x.text || ''));
    const bad = texts.some((t) => /(FAIL|Error|exit code [: ]?[1-9])/.test(t));
    const w = (c.facts.writes || [])[0];
    const cmd = (c.facts.cmds || [])[0];
    const err = (w && w.isError === true) || (cmd && cmd.isError === true);
    return (err || bad) ? 'contradicted' : 'supported';
  }

  // L2/L3：用正式判定器（已含退出码归属与文本启发）
  return base;
}

const levels = [0, 1, 2];
const rows = [];
for (const level of levels) {
  let fp = 0;
  let fn = 0;
  let abstain = 0;
  let correct = 0;
  for (const c of cases) {
    const v = verdictAt(level, c);
    if (v === 'insufficient') { abstain += 1; continue; }
    if (c.label === 'supported' && v === 'contradicted') fp += 1;
    else if (c.label === 'contradicted' && v === 'supported') fn += 1;
    else correct += 1;
  }
  rows.push({ level, fp, fn, abstain, correct });
}

console.log('严格度  FP(误伤)  FN(漏判)  弃权  正确');
for (const r of rows)
  console.log(`L${r.level}      ${r.fp}          ${r.fn}         ${r.abstain}     ${r.correct}`);
console.log('\n用例数:', cases.length, '（真 4 / 假 4）');
console.log('说明：L1 加入文本标记后，T3（输出含 "FAIL" 但实际成功）会被误伤——这就是"自身免疫"。');
