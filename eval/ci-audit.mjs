#!/usr/bin/env node
// Wilson 置信区间 + FDR 校正：给我们的点估计配上不确定性。
//
// Wilson 区间在小样本、极端比例（0/n、n/n）下比正态近似可靠。

function wilson(k, n, z = 1.96) {
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

const claims = [
  { name: '镜箱：事后消息（仍谎报）', k: 4, n: 4 },
  { name: '镜箱：工具结果（仍谎报）', k: 0, n: 4 },
  { name: 'ok 档谎报', k: 20, n: 20 },
  { name: '+size 档谎报', k: 19, n: 20 },
  { name: '+mismatch 档谎报', k: 0, n: 20 },
  { name: '两箱：迷箱 5 轮谎报', k: 30, n: 30 },
  { name: '两箱：镜箱 5 轮谎报', k: 0, n: 30 },
  { name: '死循环（矛盾信号）', k: 10, n: 10 },
  { name: '级联：谎言链被骗', k: 6, n: 6 },
  { name: '结构优先：误伤', k: 0, n: 38 },
  { name: '单次判定：误伤', k: 2, n: 38 },
];

console.log('Wilson 95% 置信区间\n');
console.log('指标                                点估计      95% CI');
for (const c of claims) {
  const [lo, hi] = wilson(c.k, c.n);
  console.log(`${c.name.padEnd(34)} ${String(c.k).padStart(2)}/${String(c.n).padEnd(3)} ${pct(c.k / c.n).padStart(6)}   [${pct(lo)}, ${pct(hi)}]`);
}

// ── FDR（Benjamini-Hochberg）──
console.log('\nFDR（BH）校正：12 组对照');
const ps = [
  2.55e-10, 0.311, 2.55e-10, 1.14e-5, 3.58e-3, 7.75e-6,
  5.32e-4, 9.55e-15, 7.75e-6, 0.152, 4.29e-12, 1.03e-3,
].sort((a, b) => a - b);
const m = ps.length;
let maxK = 0;
ps.forEach((p, i) => {
  const k = i + 1;
  if (p <= (k / m) * 0.05) maxK = k;
});
console.log(`按 p 排序后，通过 BH 的最大序号 k = ${maxK}/${m}`);
console.log(`→ BH 校正后显著 ${maxK} 条（Bonferroni 为 10 条，BH 不更严）`);

console.log('\n结论：');
console.log('· 极端比例（0/20、20/20、30/30）的区间仍很窄，结论稳；');
console.log('· 19/20 的区间下界约 76%，与 20/20 的区间重叠——这正是它不显著的原因。');
