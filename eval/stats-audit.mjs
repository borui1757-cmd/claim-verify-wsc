#!/usr/bin/env node
// 统计审计：对我们自己的实验做多重比较与功效分析。
//
// ① 多重比较：跑了多少组对照？在 α=0.05 下期望多少假阳性？
// ② 功效：给定 n 与效应大小，能检出吗？（两比例 z 检验的近似）
//
// 用法：node eval/stats-audit.mjs

// ── 我们实际跑过的对照（组数按"一次对照"计） ──
const comparisons = [
  { id: 'C1', name: '镜箱：工具结果 vs 事后消息', a: 20, b: 20, hitsA: 20, hitsB: 0 },
  { id: 'C2', name: 'size 档 vs ok 档', a: 20, b: 20, hitsA: 19, hitsB: 20 },
  { id: 'C3', name: 'mismatch 档 vs ok 档', a: 20, b: 20, hitsA: 0, hitsB: 20 },
  { id: 'C4', name: '接种纯 vs 常规', a: 20, b: 20, hitsA: 13, hitsB: 0 },
  { id: 'C5', name: '接种强 vs 纯', a: 20, b: 20, hitsA: 20, hitsB: 13 },
  { id: 'C6', name: '死循环：矛盾信号 vs 一致', a: 10, b: 10, hitsA: 10, hitsB: 0 },
  { id: 'C7', name: '级联：谎言链 vs 真链', a: 6, b: 6, hitsA: 6, hitsB: 0 },
  { id: 'C8', name: '两箱：迷箱 vs 镜箱（5轮）', a: 30, b: 30, hitsA: 30, hitsB: 0 },
  { id: 'C9', name: '删除类：单语义键 vs 成对', a: 10, b: 10, hitsA: 0, hitsB: 10 },
  { id: 'C10', name: '序贯 vs 结构优先（误伤）', a: 38, b: 38, hitsA: 2, hitsB: 0 },
  { id: 'C11', name: 'Adoption：核验工具 vs 原生', a: 24, b: 24, hitsA: 24, hitsB: 0 },
  { id: 'C12', name: 'Ling：顶层 vs 嵌套', a: 10, b: 10, hitsA: 7, hitsB: 0 },
];

// 两比例 z 检验（双侧近似）
function zTest(h1, n1, h2, n2) {
  const p1 = h1 / n1;
  const p2 = h2 / n2;
  const p = (h1 + h2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0)
    return { z: Infinity, p: 0 };
  const z = (p1 - p2) / se;
  // 正态近似 p 值
  const pv = 2 * (1 - normCdf(Math.abs(z)));
  return { z, p: pv };
}

function normCdf(x) {
  // Abramowitz-Stegun 近似
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
}

// ── ① 逐项 p 值与多重比较 ──
console.log('=== ① 各对照的 p 值 ===\n');
console.log('ID   对照                                    效应        p 值     显著?');
let sigCount = 0;
const rows = [];
for (const c of comparisons) {
  const { p } = zTest(c.hitsA, c.a, c.hitsB, c.b);
  const sig = p < 0.05;
  if (sig) sigCount += 1;
  rows.push({ ...c, p, sig });
  const eff = `${c.hitsA}/${c.a} vs ${c.hitsB}/${c.b}`;
  console.log(`${c.id.padEnd(4)} ${c.name.padEnd(40)} ${eff.padEnd(12)} ${p.toExponential(2).padEnd(10)} ${sig ? '是' : '否'}`);
}

const m = comparisons.length;
const expectedFP = m * 0.05;
console.log(`\n对照总数 ${m}；α=0.05 下期望假阳性 ≈ ${expectedFP.toFixed(2)}`);
console.log(`未校正时显著 ${sigCount} 条；Bonferroni 阈值 α/m = ${(0.05 / m).toExponential(2)}`);
const bonf = rows.filter((r) => r.p < 0.05 / m).length;
console.log(`Bonferroni 校正后仍显著：${bonf} 条`);

// ── ② 功效分析 ──
console.log('\n=== ② 功效分析（两比例，80% power，α=0.05）===\n');
function nNeeded(p1, p2) {
  // 粗略公式
  const pbar = (p1 + p2) / 2;
  const za = 1.96;
  const zb = 0.8416;
  const num = (za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2;
  return Math.ceil(num / ((p1 - p2) ** 2));
}
const scenarios = [
  [1.0, 0.0, '100% vs 0%（极端）'],
  [1.0, 0.05, '100% vs 5%（如 19/20 vs 20/20）'],
  [0.65, 0.0, '65% vs 0%（纯接种）'],
];
for (const [p1, p2, label] of scenarios)
  console.log(`${label.padEnd(32)} 每组需要 n ≈ ${nNeeded(p1, p2)}`);

console.log('\n结论：极端效应（30/30 vs 0/30）在 n=6 时已足够；');
console.log('      微小效应（19/20 vs 20/20）即使 n=20 也检不出——它本来就不该被当成结论。');
