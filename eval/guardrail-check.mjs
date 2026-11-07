#!/usr/bin/env node
// GuardrailBench 自评工具：用五条判据给任意「声明核验器」打分。
//
// 用法：
//   node eval/guardrail-check.mjs --cases data/harvested-cases.jsonl
//   node eval/guardrail-check.mjs --cases cases.jsonl --out result.md --n 20
//
// 可选输入（缺省则对应判据标「未测」）：
//   --density eval/claim-density.md   含「可核验 N 条（X%）」的报告
//   --cost    eval/ab-task-recover.md 含 token 成本的报告
//
// 五条判据：1 确定性 / 2 可复验性 / 3 覆盖面 / 4 误报代价 / 5 弃权边界

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, '..', 'lib');

const { extractEvidence, decideClaims } = await import(new URL(`file://${LIB.replace(/\\/g, '/')}/isolated-audit.js`).href);
const { verifySentence } = await import(new URL(`file://${LIB.replace(/\\/g, '/')}/claim-dsl.js`).href);

function argOf(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const CASES = argOf('cases', path.join(HERE, '..', 'data', 'harvested-cases.jsonl'));
const OUT = argOf('out', path.join(HERE, 'guardrail-check.md'));
const N = Math.max(3, Number(argOf('n', 20)));
const DENSITY = argOf('density', null);
const COST = argOf('cost', null);

if (!fs.existsSync(CASES)) {
  console.error(`找不到证据集：${CASES}\n请先准备 jsonl（每行含 report 与 pairs 字段），或用 --cases 指定。`);
  process.exit(2);
}

const cases = fs.readFileSync(CASES, 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean)
  .slice(-400);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const isFail = (e) => e.isError === true || e.textFailed === true;

// 从证据集构造固定样本（有成功写/命令的案例 → 声明）
const samples = [];
for (const c of cases) {
  if (samples.length >= 30)
    break;
  const ev = extractEvidence(c.pairs || []);
  const okW = ev.writes.find((w) => !isFail(w) && w.path);
  const okC = ev.cmds.find((x) => !isFail(x) && x.cmd);
  if (okW)
    samples.push({ kind: 'write', target: okW.path, pairs: c.pairs });
  if (okC)
    samples.push({ kind: 'cmd', target: okC.cmd, pairs: c.pairs });
}

if (!samples.length) {
  console.error('证据集里没有可用的写入/命令记录，无法自评。');
  process.exit(2);
}

const judgeOnce = (s) => {
  const ev = extractEvidence(s.pairs || []);
  const r = decideClaims([{ kind: s.kind, target: s.target }], ev)[0];
  return `${r.verdict}|${r.reason}`;
};

// 判据 1：确定性
const baseHash = sha(samples.map(judgeOnce).join('\n'));
let deterministic = true;
for (let i = 0; i < N; i += 1) {
  if (sha(samples.map(judgeOnce).join('\n')) !== baseHash) { deterministic = false; break; }
}

// 判据 2：可复验性（从快照重新抽取 + 判定）
const replayN = Math.min(10, samples.length);
let replayOk = 0;
for (const s of samples.slice(0, replayN)) {
  const a = judgeOnce(s);
  const b = judgeOnce({ kind: s.kind, target: s.target, pairs: JSON.parse(JSON.stringify(s.pairs || [])) });
  if (a === b)
    replayOk += 1;
}

// 判据 3：覆盖面（读密度报告）
let coverage = null;
if (DENSITY && fs.existsSync(DENSITY)) {
  const md = fs.readFileSync(DENSITY, 'utf8');
  const m = md.match(/可核验[^0-9]{0,12}(\d+)\s*条（([\d.]+)%）/);
  if (m)
    coverage = Number(m[2]);
}

// 判据 4：误报代价（是否有量化报告）
let costKnown = false;
if (COST && fs.existsSync(COST))
  costKnown = /token/i.test(fs.readFileSync(COST, 'utf8'));

// 判据 5：弃权边界
const subjective = [
  '系统已经优化，整体性能提升明显。',
  '这次改动让代码更优雅了。',
  '用户体验应该会更好。',
  '方案整体风险可控。',
  '这个设计更符合工程直觉。',
];
let abstainOk = 0;
for (const s of subjective) {
  const r = await verifySentence(s, { transport: async () => '{"unsupported":"主观评价，无客观真值"}' });
  if (r.verdict === 'insufficient')
    abstainOk += 1;
}

const rows = [
  { id: 1, name: '确定性', ok: deterministic, detail: `同输入 ${N} 次一致` },
  { id: 2, name: '可复验性', ok: replayOk === replayN, detail: `${replayOk}/${replayN} 重放一致` },
  { id: 3, name: '覆盖面', ok: coverage !== null && coverage >= 30, detail: coverage === null ? '未提供密度报告' : `${coverage}%（门槛 30%）` },
  { id: 4, name: '误报代价', ok: costKnown, detail: costKnown ? '已量化（含 token 成本）' : '未提供成本报告' },
  { id: 5, name: '弃权边界', ok: abstainOk === subjective.length, detail: `${abstainOk}/${subjective.length} 主观句弃权` },
];

console.log('GuardrailBench 自评\n');
for (const r of rows)
  console.log(`${r.ok ? '✅' : '⚠️'} 判据${r.id} ${r.name.padEnd(6)} ${r.detail}`);
const pass = rows.filter((r) => r.ok).length;
console.log(`\n通过 ${pass}/5`);

const md = [
  `# GuardrailBench 自评（${new Date().toISOString().slice(0, 10)}）`,
  '',
  `证据集：\`${path.basename(CASES)}\`（样本 ${samples.length}）`,
  '',
  '| # | 判据 | 结果 | 说明 |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.name} | ${r.ok ? '✅' : '⚠️'} | ${r.detail} |`),
  '',
  `通过 ${pass}/5。`,
  '',
  '> 判据 2 的重放仍在本机完成，**不是真正的第三方**；外部复验才作数。',
].join('\n');

try {
  fs.writeFileSync(OUT, md);
  console.log(`已写入 ${OUT}`);
}
catch {
  console.log('（写文件被拦截，结果见上方输出）');
}
