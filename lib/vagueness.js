// vagueness.js —— 把模糊说法翻译成**区间**，而不是用容差替它开脱。
//
// 为什么（FUTURE-IDEAS #1，2026-11-07 落地）：
//   旧做法 `time_near(hhmm, toleranceMin)` 是**对称容差**：声称「2:40 多」，
//   在 02:36 也能判 supported —— 可 02:36 根本不是「2:40 多」，它是「不到 2:40」。
//   错在用容差替模糊声明辩护。正确做法是把模糊词翻成一个**有方向的区间**，
//   落在区间内 supported / 区间外 contradicted / 区间不可界定 insufficient。
//
// 理论支点：
//   - pragmatic halo（Lasersohn 1999）：近似数词天然携带一个语义区间；
//   - TriQua (arXiv 2608.05228)：复杂断言要带「辅助限定词」（约/多/左右），
//     否则拆解后粒度失真。
//
// 边界：这里只做**确定性映射**，不调模型。映射表写死、可审计；翻不出来就返回 null
// （→ 上层判 insufficient），绝不猜一个区间出来。

const MAX = 65535;

const pad = (n) => String(n).padStart(2, '0');
const toMin = (h, m) => h * 60 + (m || 0);
const fmt = (min) => {
  const x = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
};

/** 时间点：[from, to) 分钟进制；跨零点自动回绕。 */
export function timeWindow(t, { before = 0, after = 1 } = {}) {
  const from = t - before;
  const to = t + after;
  return { fromMin: from, toMin: to, from: fmt(from), to: fmt(to), wrap: from < 0 || to > 1440 };
}

/** now 是否落在 [from, to) 里（支持跨零点）。 */
export function inWindow(nowMin, fromMin, toMin) {
  const n = ((nowMin % 1440) + 1440) % 1440;
  const f = ((fromMin % 1440) + 1440) % 1440;
  const t = ((toMin % 1440) + 1440) % 1440;
  if (f === t)
    return true; // 满圈
  if (f < t)
    return n >= f && n < t;
  return n >= f || n < t; // 跨零点
}

/**
 * 时间说法 → 区间。
 * @returns {{from:string,to:string,fromMin:number,toMin:number,quantifier:string}|null}
 *          翻不出来（如「差不多两点」没分钟）返回 null → 上层判 insufficient
 */
export function timeIntervalOf(text) {
  const s = String(text || '');
  const m = s.match(/(\d{1,2})\s*[:：点]\s*(\d{1,2})/);
  if (!m)
    return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!(h >= 0 && h <= 23 && min >= 0 && min <= 59))
    return null;
  const t = toMin(h, min);
  const around = /约|大概|大约|左右|差不多|前后/.test(s);
  const more = /多|余|出头/.test(s);
  const less = /将近|接近|快|不到|差一点/.test(s);
  const past = /过|之后|以后/.test(s);

  let q = 'exact';
  let win;
  if (less) { q = 'less'; win = timeWindow(t, { before: 10, after: 0 }); }
  else if (more || past) { q = more ? 'more' : 'past'; win = timeWindow(t, { before: 0, after: 10 }); }
  else if (around) { q = 'around'; win = timeWindow(t, { before: 5, after: 5 }); }
  else { q = 'exact'; win = timeWindow(t, { before: 0, after: 1 }); }
  return { ...win, quantifier: q };
}

/**
 * 数量说法 → 整数区间。
 * 整数语境下「约 3 个」不是 2~4，就是 3（FUTURE-IDEAS 明确纠正过这一点）。
 * @returns {{from:number,to:number,quantifier:string}|null}
 */
export function countIntervalOf(n, text) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 0)
    return null;
  const s = String(text || '');
  if (/至少|不少于|不低于/.test(s))
    return { from: v, to: MAX, quantifier: 'at-least' };
  if (/超过|多于|大于/.test(s))
    return { from: v + 1, to: MAX, quantifier: 'more-than' };
  if (/最多|不超过|不高于/.test(s))
    return { from: 0, to: v, quantifier: 'at-most' };
  if (/不到|少于|小于/.test(s))
    return { from: 0, to: Math.max(0, v - 1), quantifier: 'less-than' };
  if (/多|余|出头/.test(s))
    return { from: v + 1, to: MAX, quantifier: 'more' };
  if (/约|大概|大约|左右|差不多|上下/.test(s))
    return { from: v, to: v, quantifier: 'around' }; // 整数语境：仍是这一个数
  return { from: v, to: v, quantifier: 'exact' };
}

/** 单位区间是否只含一个值（用于「约 3 个」这种精确点）。 */
export function isPoint(iv) {
  return Boolean(iv) && iv.from === iv.to;
}
