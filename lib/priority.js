// priority.js —— 矛盾驱动的优先级：账本里"未解释的不一致"决定下一步查什么。
//
// 这是"好奇心"的一个极小实现：不是想探索新东西，而是**想解释已有的不一致**。
// 依据：差异驱动的行为（Schmidhuber 的压缩进步、主动推断的自由能最小化）
// 都被简化为一句可执行规则：**未解决的矛盾优先**。
//
// 零模型调用。

import { readLedger } from './worldmodel.js';
import { objectKey } from './calibration.js';

const KIND_WEIGHT = { port: 3, file: 2, cmd: 1, other: 1 };

/**
 * 未解决矛盾：同一对象最后一次判定是 contradicted
 * （此后若出现过 supported，视为已解释）。
 */
export function unresolvedContradictions({ file, since = 0 } = {}) {
  const rows = readLedger(file).filter((r) => r.at >= since);
  const byObj = new Map();
  for (const r of rows) {
    const key = r.kind + '|' + objectKey(r.kind, r.target);
    const cur = byObj.get(key) || { kind: r.kind, target: r.target, count: 0, lastAt: 0, lastVerdict: null };
    cur.lastAt = Math.max(cur.lastAt, r.at);
    cur.lastVerdict = r.at >= cur.lastAt ? r.verdict : cur.lastVerdict;
    if (r.verdict === 'contradicted')
      cur.count += 1;
    if (r.verdict === 'supported' && r.at >= cur.lastAt)
      cur.lastVerdict = 'supported';
    byObj.set(key, cur);
  }
  return [...byObj.values()].filter((x) => x.lastVerdict === 'contradicted');
}

/**
 * 优先级队列：得分 = 反驳次数×2 + 类型权重 + 新鲜度加成（越近越高）。
 * @returns {Array<{kind,target,count,ageMs,score}>}
 */
export function priorityQueue({ file, now = Date.now(), limit = 20, since = 0 } = {}) {
  const items = unresolvedContradictions({ file, since }).map((x) => {
    const ageMs = Math.max(0, now - x.lastAt);
    const freshness = Math.max(0, 1 - ageMs / (7 * 24 * 3600 * 1000)); // 一周内线性衰减
    const score = x.count * 2 + (KIND_WEIGHT[x.kind] || 1) + freshness * 3;
    return { kind: x.kind, target: x.target, count: x.count, ageMs, score: Number(score.toFixed(2)) };
  });
  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 一句话总结当前待解释的矛盾。 */
export function prioritySummary({ file, now = Date.now() } = {}) {
  const q = priorityQueue({ file, now });
  if (!q.length)
    return '账本里没有未解决的矛盾。';
  const top = q[0];
  return `待解释矛盾 ${q.length} 个；最优先：${top.kind} ${top.target}（被证伪 ${top.count} 次，${Math.round(top.ageMs / 60000)} 分钟前）`;
}
