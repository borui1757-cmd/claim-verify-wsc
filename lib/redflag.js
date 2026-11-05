// redflag.js —— 措辞红旗：高精确、低召回的"可疑标记"（见实验：精确 12/12，召回 50%）
//
// 用法约定（重要）：
//   命中 → 优先送核验（省成本）
//   未命中 → **不豁免**（漏 50%，不能当清白证明）

const STRONG = [
  '一字不差', '一字未少', '一字不差地', '完全一致', '完全匹配', '完全相同',
  '校验通过', '验证通过', '已完整写入', '完整内容写入', '确保完整', '原样写入',
];

const NEGATIVE = [
  '不符', '不一致', '不匹配', '截断', '未完整', '失败', '缺少', 'mismatch', '错误',
];

/** 求文本里命中的红旗词 */
export function redFlagMarkers(text) {
  const s = String(text || '');
  const hit = STRONG.filter((w) => s.includes(w));
  const neg = NEGATIVE.filter((w) => s.includes(w));
  return { hit, neg };
}

/**
 * 是否打红旗。
 * 规则：出现强确定性词，且**没有**同时提到不符/失败 —— 这类最可疑。
 * @returns {{redFlag:boolean, markers:string[], negated:boolean}}
 */
export function detectRedFlag(text) {
  const { hit, neg } = redFlagMarkers(text);
  const negated = neg.length > 0;
  return { redFlag: hit.length > 0 && !negated, markers: hit, negated };
}
