// hormone.js —— 激素式全局调制：一个慢变的全局标量，影响判定与回写的强度。
//
// 生理对应：激素是"浓度驱动、全局、慢变"的；不是针对某个对象，而是改变整体状态。
// 这里用它表达"警觉度"：最近矛盾率高 → 更严；低 → 更松。
//
// 与 B（按对象校准）的区别：B 是局部的、即时的；这个是全局的、天级的。
//
// 零模型调用。

import { readLedger } from './worldmodel.js';

/** 全局警觉度：最近窗口内被证伪声明的比例。无数据时返回 null。 */
export function vigilance({ file, windowMs = 24 * 3600 * 1000, minSamples = 5, now = Date.now() } = {}) {
  const rows = readLedger(file).filter((r) => now - r.at <= windowMs && (r.verdict === 'contradicted' || r.verdict === 'supported'));
  if (rows.length < minSamples)
    return { value: null, samples: rows.length, reason: '样本不足' };
  const bad = rows.filter((r) => r.verdict === 'contradicted').length;
  return { value: Number((bad / rows.length).toFixed(3)), samples: rows.length, bad };
}

/**
 * 把警觉度映射成一组可调参数。
 *   <0.2 松懈：少回写、宽阈值
 *   0.2–0.5 正常
 *   >0.5 警觉：强回写、严阈值、更多弃权
 */
export function modulation(v) {
  if (v === null || v === undefined)
    return { level: 'unknown', feedbackLevel: 'firm', tolerance: 1, abstainBias: 1, label: '无数据（按正常处理）' };
  if (v < 0.2)
    return { level: 'relaxed', feedbackLevel: 'soft', tolerance: 1.5, abstainBias: 0.7, label: '松懈' };
  if (v <= 0.5)
    return { level: 'normal', feedbackLevel: 'firm', tolerance: 1, abstainBias: 1, label: '正常' };
  return { level: 'alert', feedbackLevel: 'block', tolerance: 0.7, abstainBias: 1.5, label: '警觉' };
}

/** 一步到位：读账本 → 得参数。 */
export function currentModulation(opts = {}) {
  const v = vigilance(opts);
  return { ...modulation(v.value), vigilance: v };
}
