#!/usr/bin/env node
// 贝叶斯因子（BIC 近似）分级：给每组对照标注"证据强度"。
//
// 判读（Jeffreys / Kass-Raftery）：
//   BF10 < 1     支持 H0（无差异）
//   1–3          无实质证据
//   3–10         中等
//   10–100       强
//   >100         极强
//
// 用法：node eval/bayes-factor.mjs

const comps = [
  { id: 'C1', name: '镜箱：工具结果 vs 事后消息', k1: 0, n1: 20, k2: 20, n2: 20 },
  { id: 'C2', name: 'size 档 vs ok 档', k1: 19, n1: 20, k2: 20, n2: 20 },
  { id: 'C3', name: 'mismatch 档 vs ok 档', k1: 0, n1: 20, k2: 20, n2: 20 },
  { id: 'C4', name: '接种纯 vs 常规', k1: 13, n1: 20, k2: 0, n2: 20 },
  { id: 'C6', name: '死循环：矛盾 vs 一致', k1: 10, n1: 10, k2: 0, n2: 10 },
  { id: 'C7', name: '级联：谎言链 vs 真链', k1: 6, n1: 6, k2: 0, n2: 6 },
  { id: 'C8', name: '两箱：迷箱 vs 镜箱', k1: 30, n1: 30, k2: 0, n2: 30 },
  { id: 'C9', name: '删除：单语义键 vs 成对', k1: 0, n1: 10, k2: 10, n2: 10 },
  { id: 'C10', name: '结构优先 vs 单次（误伤）', k1: 0, n1: 38, k2: 2, n2: 38 },
  { id: 'C11', name: 'Adoption：核验 vs 原生', k1: 24, n1: 24, k2: 0, n2: 24 },
];

/** 二项分布对数似然 */
function logLik(k, n, p) {
  const eps = 1e-9;
  const pp = Math.min(1 - eps, Math.max(eps, p));
  return k * Math.log(pp) + (n - k) * Math.log(1 - pp);
}

/** BIC 近似的 BF10：模型1=两个独立比例，模型0=合并一个比例 */
function bf10(k1, n1, k2, n2) {
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const pooled = (k1 + k2) / (n1 + n2);
  const ll1 = logLik(k1, n1, p1) + logLik(k2, n2, p2);
  const ll0 = logLik(k1, n1, pooled) + logLik(k2, n2, pooled);
  const k1params = 2;
  const k0params = 1;
  const nTotal = n1 + n2;
  const bic1 = k1params * Math.log(nTotal) - 2 * ll1;
  const bic0 = k0params * Math.log(nTotal) - 2 * ll0;
  return Math.exp((bic0 - bic1) / 2);
}

function grade(bf) {
  if (bf < 1) return '支持无差异';
  if (bf < 3) return '无实质证据';
  if (bf < 10) return '中等';
  if (bf < 100) return '强';
  return '极强';
}

console.log('贝叶斯因子（BIC 近似）\n');
console.log('ID   对照                             BF10          强度');
for (const c of comps) {
  const bf = bf10(c.k1, c.n1, c.k2, c.n2);
  const disp = bf > 1e6 ? bf.toExponential(1) : bf.toFixed(2);
  console.log(`${c.id.padEnd(4)} ${c.name.padEnd(32)} ${disp.padEnd(13)} ${grade(bf)}`);
}

console.log('\n判读：');
console.log('· BF > 100 的对照（C1/C3/C6/C7/C8/C9/C11）证据极强；');
console.log('· C2（size vs ok）BF < 1 —— 数据其实**支持两者无差异**，与我们撤回它的决定一致；');
console.log('· C10（结构优先误伤）BF 应接近 1 —— 无实质证据，已在正文收窄为描述性。');
