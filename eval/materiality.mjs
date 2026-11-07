#!/usr/bin/env node
// 矛盾分级：不是所有矛盾都值得解释。
//
// 用真实证据构造"被证伪的声明"，再按四个维度分级：
//   ① 是否临时路径（temp / .tmp / AppData\Local\Temp）
//   ② 是否测试类命令（node -e / npm test / echo / dir / curl localhost）
//   ③ 类型权重（端口 > 文件 > 命令）
//   ④ 重复出现次数
//
// 输出：噪音比例 + 分级前后队列对比。零模型调用。
//
// 用法：node eval/materiality.mjs

import fs from 'node:fs';
import { extractEvidence, decideClaims } from '../lib/isolated-audit.js';

const CASES = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/data/harvested-cases.jsonl';
const cases = fs.readFileSync(CASES, 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean)
  .slice(-600);

const isFail = (e) => e.isError === true || e.textFailed === true;

const TEMP_RE = /(\\Temp\\|\\tmp\\|\/tmp\/|\.tmp$|\.cv-tmp|AppData\\Local\\Temp|__no_such|\\\\nope)/i;
const TEST_CMD_RE = /^(node -e|npm (test|run)|npx |python -c|pytest|echo |dir |ls |cd |where |findstr |Select-String|Get-Content|Get-ChildItem|Test-Path|curl |Invoke-WebRequest)/i;

// ── 收集"被证伪的声明"
const contradictions = [];
for (const c of cases) {
  const ev = extractEvidence(c.pairs || []);
  const badW = ev.writes.filter((w) => isFail(w) && w.path);
  const badC = ev.cmds.filter((x) => isFail(x) && x.cmd);
  for (const w of badW.slice(0, 1))
    contradictions.push({ kind: 'file', target: w.path });
  for (const x of badC.slice(0, 1))
    contradictions.push({ kind: 'cmd', target: x.cmd });
}

// 确认这些声明确实会被判 contradicted（用判定器验证，而不是假设）
const confirmed = [];
for (const item of contradictions) {
  const ev = { writes: [], cmds: [] };
  // 直接造最小证据：该动作失败
  if (item.kind === 'file')
    ev.writes = [{ path: item.target, isError: true }];
  else
    ev.cmds = [{ cmd: item.target, isError: true }];
  const r = decideClaims([{ kind: item.kind === 'file' ? 'write' : 'cmd', target: item.target }], ev)[0];
  if (r && r.verdict === 'contradicted')
    confirmed.push(item);
}

// 重复计数
const freq = new Map();
for (const x of confirmed) {
  const k = x.kind + '|' + String(x.target).toLowerCase();
  freq.set(k, (freq.get(k) || 0) + 1);
}

// ── 分级
function classify(x) {
  const t = String(x.target);
  const isTemp = x.kind === 'file' ? TEMP_RE.test(t) : false;
  const isTest = x.kind === 'cmd' ? TEST_CMD_RE.test(t.trim()) : false;
  const repeats = freq.get(x.kind + '|' + t.toLowerCase()) || 1;
  const typeWeight = { port: 3, file: 2, cmd: 1 }[x.kind] || 1;
  const material = !isTemp && !isTest;
  const score = (material ? 10 : 0) + repeats * 2 + typeWeight;
  return { ...x, isTemp, isTest, repeats, typeWeight, material, score };
}

const rows = confirmed.map(classify);

// 去重：同一对象只保留一条（合并重复次数）
const merged = new Map();
for (const r of rows) {
  const k = r.kind + '|' + String(r.target).toLowerCase();
  const cur = merged.get(k);
  if (!cur || r.score > cur.score)
    merged.set(k, r);
  else
    cur.repeats = Math.max(cur.repeats, r.repeats);
}
const uniq = [...merged.values()];
const total = rows.length || 1;
const temp = rows.filter((r) => r.isTemp).length;
const test = rows.filter((r) => r.isTest).length;
const noise = rows.filter((r) => r.isTemp || r.isTest).length;
const material = rows.filter((r) => r.material).length;

const pct = (x) => (x / total * 100).toFixed(1) + '%';

console.log(`被证伪的声明（已用判定器确认）：${rows.length}\n`);
console.log('① 噪音构成：');
console.log(`  临时路径      ${temp}`);
console.log(`  测试类命令    ${test}`);
console.log(`  **噪音合计**  ${noise}（${pct(noise)}）`);
console.log(`  实质矛盾      ${material}（${pct(material)}）`);

console.log('\n② 分级前后队列对比（前 8）：');
const byCount = [...uniq].sort((a, b) => b.repeats - a.repeats).slice(0, 8);
const byScore = [...uniq].sort((a, b) => b.score - a.score).slice(0, 8);
console.log('  仅按次数：');
for (const r of byCount)
  console.log(`    ${String(r.repeats).padStart(2)}x ${r.kind.padEnd(4)} ${String(r.target).slice(0, 60)}`);
console.log('  按分级得分：');
for (const r of byScore)
  console.log(`    ${String(r.score).padStart(4)} ${r.kind.padEnd(4)} ${String(r.target).slice(0, 60)}`);

// 噪音在两种排序里的占比
const noiseInByCount = byCount.filter((r) => !r.material).length;
const noiseInByScore = byScore.filter((r) => !r.material).length;
console.log(`\n③ 前 8 条里的噪音：仅按次数 ${noiseInByCount}/8 → 按分级得分 ${noiseInByScore}/8`);

const out = [
  '# 矛盾分级（materiality triage）',
  '',
  `被证伪的声明：${rows.length}（用判定器确认，非假设）`,
  '',
  '| 类别 | 数量 | 占比 |',
  '|---|---|---|',
  `| 临时路径 | ${temp} | ${pct(temp)} |`,
  `| 测试类命令 | ${test} | ${pct(test)} |`,
  `| **噪音合计** | **${noise}** | **${pct(noise)}** |`,
  `| 实质矛盾 | ${material} | ${pct(material)} |`,
  '',
  `前 8 条里的噪音：仅按次数 **${noiseInByCount}/8** → 按分级得分 **${noiseInByScore}/8**`,
].join('\n');
fs.writeFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/eval/materiality.md', out);
console.log('\n已写入 eval/materiality.md');
