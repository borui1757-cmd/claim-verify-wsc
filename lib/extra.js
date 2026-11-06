// extra.js —— 程序类断言：时间 / 日期 / 计数 / 算式。
//
// 真值全部由程序算，不经过模型（原 tools/hallu-suite.mjs 的那套真值函数，
// 2026-10-31 起用于离线回归，2026-11-05 抽出来做运行时检查）。
// 只认「像在陈述现状」的句子；疑问、举例、假设一律放过。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeNumbers, cnToNumber } from './numerals.js';

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

/** 通用引用判定：代码块 / 反引号 / 引用块 / 上下文有引用词 / 后接"实际"对照 */
function isQuotedRef(text, index, len, ctx) {
  if (insideFence(text, index))
    return true;
  const before = text.slice(Math.max(0, index - 2), index);
  const after = text.slice(index + len, index + len + 12);
  const b = before.replace(/\s+$/, '').slice(-1);
  const a = after.replace(/^\s+/, '').slice(0, 1);
  const pairs = { '"': '"', '“': '”', '「': '」', '『': '』', '`': '`' };
  if (pairs[b] && pairs[b] === a)
    return true;
  if (hasAny(ctx, ['我说', '我说过', '之前说', '刚才说', '曾经说', '引用', '原文', '举例', '打比方', '比如', '例如', '抓到', '错例', '误报']))
    return true;
  if (/^[^\n]{0,6}（?\s*实际\s*(?:是|为)?\s*-?\d/.test(after))
    return true;
  return false;
}

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
  // 2026-11-07 补：`11-06` / `11/06` 这种写法（真实语料里很常见：`（今天是 11-06）`）
  for (const m of text.matchAll(/(?:今天|今日|现在)\s*(?:是)?\s*(\d{1,2})\s*[-/]\s*(\d{1,2})(?!\d)/g)) {
    const ctx = ctxOf(text, m.index, m[0].length);
    if (hasAny(ctx, ['比如', '例如', '假设']))
      continue;
    push('date', { month: Number(m[1]), day: Number(m[2]) }, m[0], ctx, `日期 ${m[1]}-${m[2]}`);
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
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(乘以|乘|×|\*|除以|除|÷|\/|加|＋|\+|减|－|-)\s*(\d+(?:\.\d+)?)\s*(?:等于|＝|=|是|为|得到|得|应该等于|应为|约等于|大约|大概|差不多)(?:是)?\s*(-?\d+(?:\.\d+)?)/g)) {
    const op = OP_MAP[m[2]];
    if (!op)
      continue;
    const ctx = ctxOf(text, m.index, m[0].length);
    // 2026-11-07：**算式也要识别引用**。
    // 实测误报：我说「今天它抓到 `6/6=100`、`12×12=143`」——引用两个错例当证据，
    // 抽取器把我当成了在断言这两个等式。
    if (isQuotedRef(text, m.index, m[0].length, ctx))
      continue;
    push('math', { a: Number(m[1]), op: m[2], b: Number(m[3]), claimed: Number(m[4]) }, m[0], ctx, `算式 ${m[1]}${m[2]}${m[3]}=${m[4]}`);
  }

  // ── 中文时间：「凌晨三点四十分」→ 03:40（2026-11-07 加）─────────
  {
    const CN_TIME_RE = /(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上)?\s*([零〇一二三四五六七八九十两]{1,3})\s*[点时時]\s*(半|[零〇一二三四五六七八九十]{1,3})\s*分?/g;
    for (const m of text.matchAll(CN_TIME_RE)) {
      const ctx = ctxOf(text, m.index, m[0].length);
      if (isQuotedRef(text, m.index, m[0].length, ctx))
        continue;
      let hour = cnToNumber(m[2]);
      const minuteRaw = m[3];
      let minute = minuteRaw === '半' ? 30 : cnToNumber(minuteRaw);
      if (hour === null || minute === null)
        continue;
      const period = m[1] || '';
      if (/下午|傍晚|晚上/.test(period) && hour < 12)
        hour += 12;
      if (/凌晨|清晨/.test(period) && hour === 12)
        hour = 0;
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59)
        continue;
      push('time', { hour, minute }, m[0], ctx, `时间 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, { via: 'cn-time' });
    }
  }

  // ── 归一化后再抓一遍（2026-11-07）────────────────────────────
  // 对抗测试发现：「十二乘以十二等于一百四十三」「twelve times twelve equals 143」
  // 这类说法完全漏掉。先把中文/英文数字词换成数字，再用同一个模式抓一次。
  try {
    const norm = normalizeNumbers(text);
    if (norm !== text) {
      const seen = new Set(claims.map((c) => c.kind + '|' + JSON.stringify(c.value)));
      for (const m of norm.matchAll(/(\d+(?:\.\d+)?)\s*(乘以|乘|×|\*|除以|除|÷|\/|加|＋|\+|减|－|-)\s*(\d+(?:\.\d+)?)\s*(?:等于|＝|=|是|为|得到|得|应该等于|应为|约等于|大约|大概|差不多)\s*(-?\d+(?:\.\d+)?)/g)) {
        const op = OP_MAP[m[2]];
        if (!op)
          continue;
        const key = 'math|' + JSON.stringify({ a: Number(m[1]), op: m[2], b: Number(m[3]), claimed: Number(m[4]) });
        if (seen.has(key))
          continue;
        seen.add(key);
        const ctx = ctxOf(norm, m.index, m[0].length);
        if (isQuotedRef(norm, m.index, m[0].length, ctx))
          continue;
        push('math', { a: Number(m[1]), op: m[2], b: Number(m[3]), claimed: Number(m[4]) }, m[0], ctx, `算式 ${m[1]}${m[2]}${m[3]}=${m[4]}`, { via: 'normalized' });
      }
      // 英文算式：twelve times twelve equals 143 → 12 × 12 = 143
      for (const m of norm.matchAll(/(\d+(?:\.\d+)?)\s*(times|multiplied by|plus|minus|divided by)\s*(\d+(?:\.\d+)?)\s*(?:equals?|is|gives?)\s*(-?\d+(?:\.\d+)?)/gi)) {
        const EN_OP = { 'times': '×', 'multiplied by': '×', 'plus': '+', 'minus': '-', 'divided by': '÷' };
        const op = EN_OP[String(m[2]).toLowerCase()];
        if (!op)
          continue;
        const key = 'math|' + JSON.stringify({ a: Number(m[1]), op, b: Number(m[3]), claimed: Number(m[4]) });
        if (seen.has(key))
          continue;
        seen.add(key);
        const ctx = ctxOf(norm, m.index, m[0].length);
        push('math', { a: Number(m[1]), op, b: Number(m[3]), claimed: Number(m[4]) }, m[0], ctx, `算式 ${m[1]}${op}${m[3]}=${m[4]}`, { via: 'normalized-en' });
      }
    }
  }
  catch { /* 归一化失败不影响主流程 */ }

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
    // 2026-11-07 定稿：**容差为 0，必须完全一致**。
    // 理由来自用户三连问：
    //   ① 为什么不设成百分百？→ 对，容差本身就是给"差不多"留口子
    //   ② 不是能注入真值吗？→ 是，所以没有近似的理由
    //   ③ 你为什么非要自己说数？→ 这才是根因：真值在上下文里，该照抄
    // 规则只负责兜底：写下的数字必须等于那一刻，多一分钟都算错。
    const BACK = 0;
    const AHEAD = 0;
    const startMs = deps.nowMs ?? Date.now();
    const endMs = deps.nowEndMs ?? startMs;
    const toMin = (ms) => {
      const d = new Date(ms);
      return d.getHours() * 60 + d.getMinutes();
    };
    const claimMin = claim.value.hour * 60 + claim.value.minute;
    // 以结束时刻为基准算有符号差（处理跨零点）
    const signed = (target) => {
      let d = claimMin - target;
      if (d > 720) d -= 1440;
      if (d < -720) d += 1440;
      return d;
    };
    const ok = signed(toMin(startMs)) >= -BACK && signed(toMin(endMs)) <= AHEAD;
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
