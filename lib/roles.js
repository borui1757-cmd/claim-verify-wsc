// roles.js —— 角色建模：谁的话更可信
//
// 骑士题的第三层：不只是"两条断言矛盾"，而是**知道谁在说谎**。
// 我们的世界里对应：
//
//   工具直接观测   = 骑士（看到什么说什么，但也会看错/失败）
//   用户陈述       = 参考（通常对，但可能记错）
//   模型陈述       = 待验证（这就是我们要验的对象）
//   文档/外部资料   = 参考（可能过时）
//
// 规则不是"谁权重高听谁的"，而是：**冲突时降级而不是选边**。
//   - 工具 vs 模型冲突 → 采信工具，模型标记 contradicted
//   - 两个工具冲突     → 都不采信，标 inconclusive（可能是观测时点不同）
//   - 模型 vs 模型冲突  → 至少一条假，标 uncertain（不知道是哪条）

export const ROLE = {
  TOOL: 'tool',     // 直接观测
  USER: 'user',     // 用户陈述
  MODEL: 'model',   // 模型陈述（被验对象）
  DOC: 'doc',       // 文档/资料
};

const WEIGHT = {
  [ROLE.TOOL]: 3,
  [ROLE.USER]: 2,
  [ROLE.DOC]: 1,
  [ROLE.MODEL]: 0, // 不参与"采信"，只被验证
};

/** 两条互相冲突的断言，应该怎么处理 */
export function resolveConflict(a, b) {
  const ra = a && a.role || ROLE.MODEL;
  const rb = b && b.role || ROLE.MODEL;
  const wa = WEIGHT[ra] ?? 0;
  const wb = WEIGHT[rb] ?? 0;

  if (wa === wb) {
    // 同权重：不选边
    if (ra === ROLE.TOOL)
      return { verdict: 'inconclusive', reason: '两个工具观测冲突，可能是时点不同' };
    return { verdict: 'uncertain', reason: '同权来源互相矛盾，无法判定谁对' };
  }
  const winner = wa > wb ? a : b;
  const loser = wa > wb ? b : a;
  return {
    verdict: 'reject-loser',
    winner,
    loser,
    reason: `${winner.role} 的观测优先于 ${loser.role}，采信前者`,
  };
}

/** 给一批断言按角色给出建议采信度（不改变判定，只标注） */
export function annotateByRole(claims) {
  const out = [];
  for (const c of claims || []) {
    const role = c.role || ROLE.MODEL;
    const w = WEIGHT[role] ?? 0;
    out.push({
      claim: c,
      role,
      trust: w >= 3 ? 'authoritative' : w >= 1 ? 'reference' : 'to-verify',
    });
  }
  return out;
}
