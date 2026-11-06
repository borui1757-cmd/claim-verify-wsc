// numerals.js —— 中文/英文数字词 → 阿拉伯数字
//
// 为什么需要：对抗测试发现「十二乘以十二等于一百四十三」这种说法完全漏掉，
// 而人说话经常用中文数字。
//
// 中文按位值单位解析（十百千万亿），参考 cn-nm 的思路；
// 英文按 thousands? hundreds? tens_units 文法，参考 partial-date 的 word_numbers。
//
// 关键约束：**宁可漏，不可误**。单字「一」「十」在中文里常是量词/虚词
// （"一下""一起""十有八九"），所以只转换"带位值单位"或"多字"的数字词。

const CN_DIGIT = {
  '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};

const CN_UNIT = {
  '十': 10, '百': 100, '千': 1000, '万': 10000, '亿': 100000000,
};

/** 中文数字 → number；解析不了返回 null */
export function cnToNumber(input) {
  const s = String(input || '').replace(/\s+/g, '');
  if (!s || !/^[零〇一二三四五六七八九十百千万亿两]+$/.test(s))
    return null;

  // 纯数字字符（无位值单位）：一二三 → 123
  if (!/[十百千万亿]/.test(s)) {
    if (s.length === 1)
      return CN_DIGIT[s] ?? null;
    // 多字无单位（"一二三"）按逐位拼，但只在长度>=2 时
    const digits = [...s].map((c) => CN_DIGIT[c]);
    if (digits.some((d) => d === undefined))
      return null;
    return Number(digits.join(''));
  }

  let total = 0;   // 已结算的万亿级
  let section = 0; // 当前万级以下
  let current = 0; // 当前数字

  for (const ch of s) {
    if (ch in CN_DIGIT) {
      current = CN_DIGIT[ch];
      continue;
    }
    const unit = CN_UNIT[ch];
    if (unit === 10000 || unit === 100000000) {
      section = (section + current) * unit;
      total += section;
      section = 0;
      current = 0;
    }
    else {
      // 十百千：前面没数字时按 1 算（"十三" = 13，"百" = 100）
      const base = current === 0 ? 1 : current;
      section += base * unit;
      current = 0;
    }
  }
  return total + section + current;
}

const EN_ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const EN_TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
// 这些词永远不参与数字解析（防止 "the twenty-third day" 里的 the 干扰）
const EN_STOP = new Set(['the', 'of', 'on', 'or', 'in', 'at', 'to', 'a', 'an', 'and', 'as', 'is', 'it', 'be', 'so', 'no', 'my']);

const EN_ORDINALS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
  twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60,
  seventieth: 70, eightieth: 80, ninetieth: 90,
};
const EN_NUMBER_WORD = (w) => (w in EN_ONES) || (w in EN_TENS) || (w in EN_ORDINALS)
  || w === 'hundred' || w === 'thousand' || w === 'million';

/** 英文数字词序列 → number；解析不了返回 null */
export function enToNumber(input) {
  const words = String(input || '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !EN_STOP.has(w));
  if (!words.length)
    return null;

  let total = 0;
  let current = 0;
  let matched = false;

  for (const w of words) {
    if (w in EN_ONES) {
      current += EN_ONES[w];
      matched = true;
    }
    else if (w in EN_ORDINALS) {
      current += EN_ORDINALS[w];
      matched = true;
    }
    else if (w in EN_TENS) {
      current += EN_TENS[w];
      matched = true;
    }
    else if (w === 'hundred') {
      if (current === 0)
        current = 1;
      current *= 100;
      matched = true;
    }
    else if (w === 'thousand') {
      if (current === 0)
        current = 1;
      total += current * 1000;
      current = 0;
      matched = true;
    }
    else if (w === 'million') {
      if (current === 0)
        current = 1;
      total += current * 1_000_000;
      current = 0;
      matched = true;
    }
    else {
      // 出现非数字词就停（"twelve times" 里的 times）
      break;
    }
  }
  if (!matched)
    return null;
  return total + current;
}

/**
 * 把文本里的中文/英文数字词换成阿拉伯数字（只换"看起来确实是数字"的）。
 * 中文：含位值单位（十百千万亿）或长度 ≥2 的连续数字字。
 * 英文：连续的数字词序列（长度 ≥1，且至少一个词的字符长度 ≥3，避免 "a"）。
 */
export function normalizeNumbers(text) {
  let out = String(text ?? '');

  // 中文：连续的中文数字字，且必须含位值单位或多字
  out = out.replace(/[零〇一二三四五六七八九十百千万亿两]+/g, (m) => {
    if (m.length < 2 && !/[十百千万亿]/.test(m))
      return m; // 单字「一」「十」不动
    const n = cnToNumber(m);
    return n === null ? m : String(n);
  });

  // 英文数字词：按"连续数字词"成段替换（不能整段正则吞掉整句）
  const tokens = out.split(/(\s+|[-])/);
  const pieces = [];
  let run = [];
  const flush = () => {
    if (!run.length)
      return;
    const joined = run.join(' ');
    const n = enToNumber(joined);
    if (n !== null)
      pieces.push(String(n));
    else
      pieces.push(joined);
    run = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok)
      continue;
    if (/^\s+$/.test(tok) || tok === '-')
      continue; // 分隔符先吞掉，run 内部用空格重建
    const lower = tok.toLowerCase();
    if (EN_NUMBER_WORD(lower))
      run.push(lower);
    else {
      flush();
      pieces.push(tok);
    }
  }
  flush();

  return pieces.join(' ').replace(/\s+([,.;:!?，。；：！？])/g, '$1');
}
