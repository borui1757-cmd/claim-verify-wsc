// extra.js —— 程序类断言：时间 / 日期 / 计数 / 算式。
//
// 真值全部由程序算，不经过模型（原 tools/hallu-suite.mjs 的那套真值函数，
// 2026-10-31 起用于离线回归，2026-11-05 抽出来做运行时检查）。
// 只认「像在陈述现状」的句子；疑问、举例、假设一律放过。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROGRAM_KINDS = new Set(['time', 'date', 'count', 'math']);

const here = path.dirname(fileURLToPath(import.meta.url));

// 计数类断言的目录不再硬编码成"本机工作区"。
// 早期版本默认去 <ws>/relay/public 数 html 页面，那是本机专属路径，别人装了永远取不到真值。
// 现在必须由用户在配置里显式给出 pagesDir / buttonsFile；不给就整类静默跳过（取不到真值 → 放过）。
const WEEKDAY = '日一二三四五六';

function ctxOf(text, index, length, radius = 24) {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + length + radius));
}

function hasAny(text, words) {
  return words.some((w) => text.includes(w));
}

// ────────────────────────── 真值 ──────────────────────────

export function nowParts(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return {
    hour: d.getHours(),
    minute: d.getMinutes(),
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: WEEKDAY[d.getDay()],
  };
}

/** 某个目录下的 html 页面数；没配置目录就返回 null（= 取不到真值，放过）。 */
export function countHtmlPages(dir) {
  if (!dir)
    return null;
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.html')).length;
  }
  catch {
    return null;
  }
}

/** 某个 html 文件里的按钮个数；没配置文件就返回 null。 */
export function countButtons(file) {
  if (!file)
    return null;
  try {
    const html = fs.readFileSync(file, 'utf8');
    return (html.match(/<button\b/gi) || []).length;
  }
  catch {
    return null;
  }
}

const OP_MAP = {
  乘以: (a, b) => a * b, 乘: (a, b) => a * b, '×': (a, b) => a * b, '*': (a, b) => a * b,
  除以: (a, b) => a / b, 除: (a, b) => a / b, '÷': (a, b) => a / b, '/': (a, b) => a / b,
  加: (a, b) => a + b, '＋': (a, b) => a + b, '+': (a, b) => a + b,
  减: (a, b) => a - b, '－': (a, b) => a - b, '-': (a, b) => a - b,
};

// ────────────────────────── 抽取 ──────────────────────────

/**
 * 这个时间表达式是不是"引用/举例"，而不是"我现在声称几点了"。
 *
 * 2026-11-07 的真实误报：我写「我说"现在 2:40"（实际 02:15）」，
 * 抽取器把引号里的引用当成实时断言，判定 INVALID —— 但那是历史错误的重述。
 *
 * 四类线索（任命中一条即视为引用）：
 *  ① 被引号/括号包住："…" “…” 「…」 `…` （…）
 *  ② 上下文出现"我说/之前/刚才/曾经/引用/原文"
 *  ③ 紧随其后有"（实际 …）"这种对照
 *  ④ 行内代码块
 */
function isQuotedTime(text, index, len, ctx) {
  const before = text.slice(Math.max(0, index - 2), index);
  const after = text.slice(index + len, index + len + 12);
  const b = before.replace(/\s+$/, '').slice(-1);
  const a = after.replace(/^\s+/, '').slice(0, 1);

  // ⓪ 在 markdown 代码块 / 引用块里 —— 那是"贴日志"，不是我在声称
  if (insideFence(text, index))
    return true;

  const pairs = { '"': '"', '“': '”', '「': '」', '『': '』', '`': '`', '（': '）', '(': ')' };
  if (pairs[b] && pairs[b] === a)
    return true;

  if (hasAny(ctx, ['我说', '我说过', '之前说', '刚才说', '曾经说', '引用', '原文', '举例', '打比方']))
    return true;

  // 「2:40」（实际 02:15）这种"引用 + 对照"的写法
  if (/^[^\n]{0,6}（?\s*实际\s*(?:是|为)?\s*\d{1,2}[:：]\d{2}/.test(after))
    return true;

  return false;
}

/** 位置是否落在一个未闭合的 ``` 代码块里，或在 > 引用块行首 */
function insideFence(text, index) {
  const head = text.slice(0, index);
  const fences = (head.match(/```/g) || []).length;
  if (fences % 2 === 1)
    return true;
  const lineStart = head.lastIndexOf('\n') + 1;
  if (head.slice(lineStart).trimStart().startsWith('>'))
    return true;
  return false;
}

export function extractProgramClaims(text) {
  const claims = [];
  if (typeof text !== 'string' || text.length < 6)
    return claims;

  const push = (kind, value, raw, ctx, label) => claims.push({ kind, value, raw, ctx, label });

  // 时间：现在 05:30 / 当前时间是 5:30
  for (const m of text.matchAll(/(?:现在|当前|此刻|这会儿)\s*(?:(?:时间|是|正好)\s*)*(\d{1,2})[:：](\d{2})/g)) {
    const ctx = ctxOf(text, m.index, m[0].length);
    if (hasAny(ctx, ['比如', '例如', '假设', '样例', '示例']))
      continue;
    // 2026-11-07 修：**引用/举例不该被当成实时断言**。
    // 实测：我写「我说"现在 2:40"（实际 02:15）」时，抽取器把引用当成真断言 → 误报。
    if (isQuotedTime(text, m.index, m[0].length, ctx))
      continue;
    push('time', { hour: Number(m[1]), minute: Number(m[2]) }, m[0], ctx, `时间 ${m[1]}:${m[2]}`);
  }

  // 日期：今天是 11 月 5 日 / 今天星期几 → 星期X
  for (const m of text.matchAll(/(?:今天|今日|现在)\s*(?:是)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g)) {
    const ctx = ctxOf(text, m.index, m[0].length);
    if (hasAny(ctx, ['比如', '例如', '假设']))
      continue;
    push('date', { month: Number(m[1]), day: Number(m[2]) }, m[0], ctx, `日期 ${m[1]}月${m[2]}日`);
  }
  for (const m of text.matchAll(/(?:今天|今日|现在)\s*(?:是)?\s*(?:星期|周)\s*([一二三四五六日天])/g)) {
    const v = m[1] === '天' ? '日' : m[1];
    push('date', { weekday: v }, m[0], ctxOf(text, m.index, m[0].length), `星期${v}`);
  }

  // 计数：一共 N 个 html 页面 / 有 N 个按钮
  for (const m of text.matchAll(/(?:一共|总共|共)\s*有?\s*(\d+)\s*个\s*(?:html\s*)?页面/gi)) {
    push('count', { kind: 'pages', n: Number(m[1]) }, m[0], ctxOf(text, m.index, m[0].length), `页面数 ${m[1]}`);
  }
  for (const m of text.matchAll(/(?:一共|总共|共|有)\s*(\d+)\s*个\s*按钮/gi)) {
    push('count', { kind: 'buttons', n: Number(m[1]) }, m[0], ctxOf(text, m.index, m[0].length), `按钮数 ${m[1]}`);
  }

  // 算式：1873 乘以 4 等于 7492
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(乘以|乘|×|\*|除以|除|÷|\/|加|＋|\+|减|－|-)\s*(\d+(?:\.\d+)?)\s*(?:等于|＝|=|是)\s*(-?\d+(?:\.\d+)?)/g)) {
    const op = OP_MAP[m[2]];
    if (!op)
      continue;
    push('math', { a: Number(m[1]), op: m[2], b: Number(m[3]), claimed: Number(m[4]) }, m[0], ctxOf(text, m.index, m[0].length), `算式 ${m[1]}${m[2]}${m[3]}=${m[4]}`);
  }

  return claims;
}

// ────────────────────────── 核验 ──────────────────────────

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e4) / 1e4));

/**
 * 核验一条程序类断言。
 * @returns {null|{ok:boolean, expect:string}} null = 真值取不到，放过
 */
export async function verifyProgramClaim(claim, cfg, deps = {}) {
  const nowMs = deps.nowMs ?? Date.now();
  const pages = deps.countHtmlPages ?? countHtmlPages;
  const buttons = deps.countButtons ?? countButtons;

  if (claim.kind === 'time') {
    // 2026-11-07 修：真值不是"一个时刻"，而是**这一轮的生成窗口**。
    // 之前只拿 stream 开始时刻对比，长回复末尾写的时间会显得"超前"，
    // 于是容差被放宽到 5 分钟——结果「现在 2:30」（实际 02:25）这种真错反而被放过。
    // 正确做法：断言只要落在 [开始-2min, 结束+2min] 就算真；窗口外一律判错。
    const TOL = 2;
    const startMs = deps.nowMs ?? Date.now();
    const endMs = deps.nowEndMs ?? startMs;
    const toMin = (ms) => {
      const d = new Date(ms);
      return d.getHours() * 60 + d.getMinutes();
    };
    const claimMin = claim.value.hour * 60 + claim.value.minute;
    const near = (target) => {
      const d = Math.abs(claimMin - target);
      return Math.min(d, 24 * 60 - d) <= TOL;
    };
    const ok = near(toMin(startMs)) || near(toMin(endMs));
    const t = nowParts(endMs);
    return { ok, expect: `现在是 ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}` };
  }

  if (claim.kind === 'date') {
    const t = nowParts(nowMs);
    if (claim.value.weekday) {
      return { ok: claim.value.weekday === t.weekday, expect: `今天是星期${t.weekday}` };
    }
    const ok = claim.value.month === t.month && claim.value.day === t.day;
    return { ok, expect: `今天是 ${t.month} 月 ${t.day} 日` };
  }

  if (claim.kind === 'count') {
    if (claim.value.kind === 'pages') {
      const real = pages(claim.value.dir || cfg?.pagesDir);
      if (real === null)
        return null;
      return { ok: real === claim.value.n, expect: `该目录下有 ${real} 个 html 页面` };
    }
    const real = buttons(claim.value.file || cfg?.buttonsFile);
    if (real === null)
      return null;
    return { ok: real === claim.value.n, expect: `该文件里有 ${real} 个按钮` };
  }

  if (claim.kind === 'math') {
    const op = OP_MAP[claim.value.op];
    if (!op)
      return null;
    const real = op(claim.value.a, claim.value.b);
    const ok = Math.abs(real - claim.value.claimed) < 1e-6;
    return { ok, expect: `算出来是 ${fmt(real)}` };
  }

  return null;
}
