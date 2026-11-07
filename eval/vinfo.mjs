#!/usr/bin/env node
// 可用信息（V-information）—— 正确算法：按「模型输出 R 的条件分布」算条件熵。
//
//   V(X→Y) = H(Y) - H(Y|R)
//   H(Y|R) = Σ_r P(r) · H( P(Y=1|r) )
//
// 关键点：如果模型输出 R 与真值 Y 无关（例如恒定说"完整"），
// 那么 H(Y|R)=H(Y)，V=0 —— 与披露里**写了多少数字**无关。
//
// 数据（对照：真=完整，假=被截断）：
//   假（截断）时模型说"完整"的比例：ok 100%、+size 95%、+mismatch 0%
//   真（完整）时模型说"完整"的比例：ok 100%、+size 100%、+mismatch 100%
//
// 用法：node eval/vinfo.mjs

function H(p) {
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

const arms = [
  { name: 'ok', pCompleteGivenFalse: 1.00, pCompleteGivenTrue: 1.00 },
  { name: '+ size', pCompleteGivenFalse: 0.95, pCompleteGivenTrue: 1.00 },
  { name: '+ intent/mismatch', pCompleteGivenFalse: 0.00, pCompleteGivenTrue: 1.00 },
];

const H_Y = H(0.5); // 对照 50/50 → 1 bit
console.log(`真值熵 H(Y) = ${H_Y.toFixed(3)} bit（对照 50/50）\n`);
console.log('披露                  P(说完整|假)  P(说完整|真)   H(Y|R)   可用信息 V');

for (const a of arms) {
  const pf = a.pCompleteGivenFalse;
  const pt = a.pCompleteGivenTrue;
  // 先验 50/50
  const pRcomplete = 0.5 * pf + 0.5 * pt;
  const pRincomplete = 1 - pRcomplete;
  // 后验 P(Y=假 | r)
  const pFalseGivenComplete = pRcomplete > 0 ? (0.5 * pf) / pRcomplete : 0;
  const pFalseGivenIncomplete = pRincomplete > 0 ? (0.5 * (1 - pf)) / pRincomplete : 0;
  const hCond = pRcomplete * H(pFalseGivenComplete) + pRincomplete * H(pFalseGivenIncomplete);
  const v = H_Y - hCond;
  console.log(`${a.name.padEnd(20)} ${(pf * 100).toFixed(0).padStart(6)}%      ${(pt * 100).toFixed(0).padStart(6)}%      ${hCond.toFixed(3)}    ${v.toFixed(3)} bit`);
}

console.log('\n判读：');
console.log('· ok 档：恒说完整 → 输出与真值无关 → V = 0；');
console.log('· +size 档：虽然给了数字，但模型仍几乎恒说完整（95% vs 100%）→ V ≈ 0.03；');
console.log('· +mismatch 档：输出随真值翻转（0% vs 100%）→ V = 1.00。');
console.log('\n结论：信息"写没写进披露"不重要，');
console.log('      重要的是它能否改变模型的**输出分布**——这才是可用信息。');
