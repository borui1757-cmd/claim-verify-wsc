// knight.js —— 把「骑士与无赖」的推理从"两两矛盾"推进到"约束求解"
//
// 现在只做了最浅的一层：两条断言冲突 → 至少一条是假的。
// 骑士题真正有意思的是：
//   ① **最小矛盾集（MUS）** —— 不说"互相矛盾"，说"就这几条打架"
//   ② **传递推理** —— 由已知为真的部分，推出其他的真假
//
// 这两层都不需要外部真值，纯粹是逻辑，所以能覆盖我们查不到的那部分。

import { findContradictions } from './consistency.js';

/** 把断言集合里"同对象同属性"的键算出来，用于判断两条是否可比较 */
function pairKey(claim) {
  const k = claim.kind;
  const v = claim.value;
  if (k === 'path') return `path|${String(v).toLowerCase()}`;
  if (k === 'port' || k === 'pid') return `${k}|${v}`;
  if (k === 'lines' || k === 'size' || k === 'hash') return `${k}|${String(v && v.path || '').toLowerCase()}`;
  return null;
}

/**
 * 最小矛盾集：从一堆断言里找出**最小的互相矛盾的子集**。
 * 用 delta-debugging 思路：先整体判断，再逐步删，删到不能再删。
 * @param {Array} claims
 * @returns {Array<Array>} 每个元素是一组"最小矛盾集"
 */
export function findMinimalConflicts(claims) {
  const list = Array.isArray(claims) ? claims.filter(Boolean) : [];
  if (!findContradictions(list).length)
    return [];

  // 只在"同键"的组内找，避免组合爆炸（不同对象的断言本来就不冲突）
  const groups = new Map();
  for (const c of list) {
    const k = pairKey(c);
    if (!k)
      continue;
    const g = groups.get(k) || [];
    g.push(c);
    groups.set(k, g);
  }

  const out = [];
  for (const g of groups.values()) {
    if (g.length < 2)
      continue;
    // 逐个尝试：能不能用更小的子集仍然矛盾？
    let current = g;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < current.length; i++) {
        const smaller = current.filter((_, j) => j !== i);
        if (smaller.length >= 2 && findContradictions(smaller).length) {
          current = smaller;
          changed = true;
          break;
        }
      }
    }
    if (findContradictions(current).length)
      out.push(current);
  }
  return out;
}

/**
 * 传递推理：已知哪些断言**已被证实为真**，推出其余断言的判定。
 * @param {Array} claims 全部断言
 * @param {Array} knownTrue 已经核验为真的断言（同一个对象）
 * @returns {Array<{claim:object, verdict:'false', reason:string}>}
 */
export function deriveFromKnown(claims, knownTrue) {
  const out = [];
  const list = Array.isArray(claims) ? claims.filter(Boolean) : [];
  const truths = Array.isArray(knownTrue) ? knownTrue.filter(Boolean) : [];

  // ① 同键传播：已知 A 为真，则同键不同值的 B 必假（没有已知为真的就不做这条）
  if (truths.length) {
    for (const c of list) {
      const k = pairKey(c);
      if (!k)
        continue;
      for (const t of truths) {
        if (pairKey(t) !== k)
          continue;
        if (JSON.stringify(t.value) === JSON.stringify(c.value))
          continue;
        out.push({
          claim: c,
          verdict: 'false',
          reason: `同对象已被证实为 ${JSON.stringify(t.value)}，本条不可能同时为真`,
        });
        break;
      }
    }
  }

  // ② 量级约束：行数 > 字节数 → 必假（每行至少 1 字节）
  const sizes = new Map();
  for (const c of [...list, ...truths]) {
    if (c.kind === 'size' && c.value && c.value.path) {
      const b = c.value.bytes ?? c.value.n;
      if (Number.isFinite(b))
        sizes.set(String(c.value.path).toLowerCase(), b);
    }
  }
  for (const c of [...list, ...truths]) {
    if (c.kind !== 'lines' || !c.value || !c.value.path)
      continue;
    const bytes = sizes.get(String(c.value.path).toLowerCase());
    const n = c.value.n;
    if (Number.isFinite(bytes) && Number.isFinite(n) && n > bytes && !out.some((o) => o.claim === c))
      out.push({ claim: c, verdict: 'false', reason: `声称 ${n} 行但只有 ${bytes} 字节（每行至少 1 字节）` });
  }

  return out;
}
