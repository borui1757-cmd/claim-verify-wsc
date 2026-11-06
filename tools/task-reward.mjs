// 任务级奖励的最小实现：期望变化集 vs 实际 delta
//
// 思路（见 CHANGELOG 0.9.8）：
//   任务成败 = 「该变的是否变了」+「有没有多改」
//   前者来自 spec（期望集），后者来自 delta（客观记录）
//   这个组合正好对应 Side-Effect Loopholes 的结论：
//   每个 false positive 都来自"未被要求的改动"。
//
// 用法：node tools/task-reward.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDeltaEngine } from '../lib/task-delta.js';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-task-'));
const eng = createDeltaEngine({ roots: [ws] });

// ── 任务开始：记录基线 ──
eng.beginTurn('task-1');

// ── "agent" 干活（这里用代码模拟）──
fs.writeFileSync(path.join(ws, 'report.md'), '# 报告\n');
fs.writeFileSync(path.join(ws, 'data.csv'), 'a,b\n1,2\n');
fs.writeFileSync(path.join(ws, 'scratch.tmp'), 'oops');  // 没被要求的多余产物
fs.writeFileSync(path.join(ws, 'notes.txt'), 'x');       // 另一个多余产物

// ── 任务结束：算 delta ──
const delta = eng.endTurn('task-1');

// ── 期望集（spec）──
const expect = [
  { path: 'report.md', op: 'create' },
  { path: 'data.csv', op: 'create' },
];
const forbid = [/scratch\.tmp$/, /\.tmp$/];

const changed = delta.changes.map((c) => ({ ...c, base: path.basename(c.path) }));
const expectHit = expect.filter((e) => changed.some((c) => c.base === e.path && c.op === e.op));
const missing = expect.filter((e) => !expectHit.includes(e));
const extras = changed.filter((c) => !expect.some((e) => e.path === c.base && e.op === c.op));
const forbidden = changed.filter((c) => forbid.some((re) => re.test(c.path)));

// ── 奖励 ──
let reward = 0;
let verdict = 'INCONCLUSIVE';
if (forbidden.length) { reward = -1; verdict = 'INVALID（碰了禁区）'; }
else if (missing.length) { reward = -1; verdict = 'INVALID（该做没做）'; }
else if (extras.length) { reward = 0; verdict = '部分完成（有多余改动）'; }
else { reward = 1; verdict = 'PASS'; }

const pct = (n, d) => (d ? (n / d * 100).toFixed(0) + '%' : 'n/a');
console.log('任务 delta（客观记录）：');
for (const c of changed) console.log(`  ${c.op.padEnd(6)} ${c.base}`);
console.log('\n期望集：' + expect.map((e) => e.path).join(', '));
console.log('达成 ' + expectHit.length + '/' + expect.length + ' = ' + pct(expectHit.length, expect.length));
if (missing.length) console.log('  未达成：' + missing.map((m) => m.path).join(', '));
if (extras.length) console.log('  多余改动：' + extras.map((x) => x.base).join(', '));
if (forbidden.length) console.log('  碰禁区：' + forbidden.map((x) => x.base).join(', '));

console.log('\n判定：' + verdict);
console.log('reward：' + reward + '   （+1 完成 / 0 部分 / −1 失败）');
console.log('\n链校验：' + JSON.stringify(eng.verifyChain()));

fs.rmSync(ws, { recursive: true, force: true });
process.exit(0);
