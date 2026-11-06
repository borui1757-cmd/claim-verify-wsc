// solve.js —— 多约束求解：最少否定几条才能一致
//
// 骑士题的第五层："我们中恰好两个骑士"这类题需要真正求解。
// 对我们的用途只有一个：**当一批断言互相矛盾时，最少要否定哪几条？**
// 那就是"最可能的谎言集合"。
//
// 实现取巧：断言数很少（≤15），直接穷举所有"否定哪些"的组合，
// 从 1 条开始试，找到第一个能让剩余集合一致的组合。
// 这等价于 minimum hitting set，小规模下够用，且完全可解释。

import { findContradictions } from './consistency.js';

/**
 * 求最小否定集：否定这 k 条之后，剩下的断言不再互相矛盾。
 * @param {Array} claims
 * @param {{maxK?:number}} opts
 * @returns {{size:number, toDrop:Array, reason:string}}
 */
export function minimumDropSet(claims, opts = {}) {
  const list = Array.isArray(claims) ? claims.filter(Boolean) : [];
  if (!list.length || !findContradictions(list).length)
    return { size: 0, toDrop: [], reason: '本来就一致，无需否定任何断言' };

  const maxK = Math.min(opts.maxK ?? 5, list.length);

  for (let k = 1; k <= maxK; k++) {
    for (const combo of combinations(list, k)) {
      const drop = new Set(combo);
      const rest = list.filter((c) => !drop.has(c));
      if (!findContradictions(rest).length)
        return { size: k, toDrop: combo, reason: `否定这 ${k} 条后，剩余 ${rest.length} 条不再矛盾` };
    }
  }
  return { size: -1, toDrop: [], reason: `否定 ${maxK} 条仍无法消除矛盾（断言数 ${list.length}）` };
}

/** 组合枚举（生成器，避免一次性展开） */
function* combinations(arr, k) {
  const n = arr.length;
  if (k === 0) { yield []; return; }
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i)
      i--;
    if (i < 0)
      return;
    idx[i]++;
    for (let j = i + 1; j < k; j++)
      idx[j] = idx[j - 1] + 1;
  }
}
