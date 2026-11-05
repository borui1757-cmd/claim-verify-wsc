// witness.js —— 翻译见证：把"计划是否真的在核对原句"变成可审的映射，而不是让模型自评。
//
// 做法（纯确定性，不调模型）：
//   计划里每个检查的参数值（路径/端口/文本/数字）都必须在原句里能找到出处。
//   找不到 → 这条检查是"凭空造出来的"，整个计划不可信 → 降级为 insufficient。
//
// 它不是形式化等价证明，但能挡住最常见的一类错误：把 A 断言翻译成关于 B 的检查。

/** 归一化：小写、反斜杠转斜杠、去反引号/引号/空白。 */
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/[`"'\s]/g, '');
}

/** 从一条检查里取出"必须能在原句中找到"的字面量。 */
export function anchorsOf(check) {
  const args = check?.args || {};
  const out = [];
  // 算式：原句里写的是"1873 乘以 4"，计划里是 "1873*4"。所以按数字逐个核对，而不是比整条表达式。
  if (check?.prim === 'math_eq') {
    const nums = String(args.expr || '').match(/\d+(?:\.\d+)?/g) || [];
    for (const n of nums)
      out.push({ key: 'exprNum', value: n });
    if (typeof args.value === 'number' && Number.isFinite(args.value))
      out.push({ key: 'value', value: String(args.value) });
    return out;
  }
  for (const key of ['path', 'text', 'expr', 'dir', 'ext', 'host']) {
    if (typeof args[key] === 'string' && args[key].trim()) {
      // 原句里通常写 "html"，计划里写 ".html"：按去掉点后的形式核对
      const value = key === 'ext' ? args[key].replace(/^\./, '') : args[key];
      out.push({ key, value });
    }
  }
  for (const key of ['port', 'pid', 'count', 'value']) {
    if (typeof args[key] === 'number' && Number.isFinite(args[key]))
      out.push({ key, value: String(args[key]) });
  }
  if (typeof args.hhmm === 'string')
    out.push({ key: 'hhmm', value: args.hhmm });
  return out;
}

/**
 * 生成见证。
 * @returns {{ok:boolean, checks:Array, matched:number, total:number, reason?:string}}
 */
export function makeWitness(sentence, plan) {
  const text = norm(sentence);
  const checks = Array.isArray(plan?.all) ? plan.all : [];
  if (!text || !checks.length)
    return { ok: false, checks: [], matched: 0, total: 0, reason: '没有句子或没有检查' };

  const rows = [];
  let matched = 0;
  let total = 0;
  for (const c of checks) {
    const anchors = anchorsOf(c).map((a) => {
      total += 1;
      const hit = text.includes(norm(a.value));
      if (hit)
        matched += 1;
      return { ...a, found: hit };
    });
    rows.push({ prim: c.prim, anchors });
  }
  const ok = total > 0 && matched === total;
  return {
    ok,
    checks: rows,
    matched,
    total,
    ...(ok ? {} : { reason: `计划里有 ${total - matched}/${total} 个参数在原句里找不到出处` }),
  };
}
