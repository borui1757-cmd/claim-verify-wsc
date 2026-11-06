// commitments.js —— 「让模型自己声明」的结构化承诺块。
//
// 背景：语料复测发现自然语言里可核验断言只有 1.4 条/100 句，靠正则捞收益有限。
// 依据 ARC (NeurIPS 2026)：让 agent 每步显式做出「预测」，再由观测证伪/证实；
// 依据 CLAIMRECEIPT (NeurIPS 2026)：断言要绑定证据，判定分三态 PASS / INVALID / INCONCLUSIVE，
// 而不是成功/失败两态。
//
// 承诺块格式（模型自愿输出，放在 ```claims 围栏里）：
// ```claims
// [{"kind":"path","value":"C:\\a\\b.txt","expect":"exists","evidence":"tool:write"},
//  {"kind":"port","value":3080,"expect":"listening"}]
// ```
//
// 设计约束：解析失败绝不抛错；核验器通过依赖注入传入，避免与 index.js 循环引用。

const FENCE = /```(?:claims|json)?\s*([\s\S]*?)```/g;

import { stamp } from './freshness.js';

/** 从文本里解析承诺块。返回 {items, error}。 */
export function parseCommitments(text) {
  if (typeof text !== 'string' || !text)
    return { items: [], error: 'empty' };

  let raw = null;
  for (const m of text.matchAll(FENCE)) {
    const body = m[1].trim();
    if (body.startsWith('[') || body.startsWith('{'))
      raw = body;
  }
  if (!raw)
    return { items: [], error: 'no-block' };

  let arr;
  try { arr = JSON.parse(raw); }
  catch { return { items: [], error: 'bad-json' }; }
  if (!Array.isArray(arr))
    arr = [arr];

  const items = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object')
      continue;
    const kind = typeof it.kind === 'string' ? it.kind.trim() : '';
    if (!kind)
      continue;
    const expect = String(it.expect || 'exists').trim();
    items.push({
      kind,
      value: it.value,
      expect,
      // 极性由 expect 推出：exists/true = 肯定，not_exists/false = 否定
      polarity: /^(not_exists|absent|false|stopped|closed)$/i.test(expect) ? 'neg' : 'pos',
      evidence: typeof it.evidence === 'string' ? it.evidence.slice(0, 120) : null,
    });
  }
  return { items, error: items.length ? null : 'no-items' };
}

const HOST = new Set(['pid', 'lines', 'size', 'hash', 'pkgversion', 'mem', 'disk', 'service', 'registry', 'task']);

/**
 * 核验承诺，返回三态结果（对齐 CLAIMRECEIPT 的 PASS / INVALID / INCONCLUSIVE）。
 * @param {Array} items
 * @param {{verifyClaims: Function, verifyHostClaim: Function, cfg: object, deps?: object}} io
 */
export async function verifyCommitments(items, io) {
  const results = [];
  for (const it of items) {
    const claim = { kind: it.kind, value: it.value, polarity: it.polarity, ctx: '', raw: '' };
    let verdict = 'INCONCLUSIVE';
    let detail = '';
    try {
      if (HOST.has(it.kind)) {
        const r = await io.verifyHostClaim(claim, io.cfg, io.deps || {});
        if (r) { verdict = r.ok ? 'PASS' : 'INVALID'; detail = r.expect; }
      }
      else {
        const r = await io.verifyClaims([claim], 'commitment', io.cfg, io.deps || {});
        if (r && r.checked > 0) {
          const bad = (r.bad || []).find((b) => b.claim.kind === it.kind);
          verdict = bad ? 'INVALID' : 'PASS';
          detail = bad ? bad.expect : '与系统真值一致';
        }
      }
    }
    catch (e) {
      verdict = 'INCONCLUSIVE';
      detail = '核验异常：' + (e && e.message ? e.message : String(e));
    }
    results.push({ ...it, verdict, detail, ...stamp(it.kind, verdict, { detail }) });
  }
  const count = (v) => results.filter((r) => r.verdict === v).length;
  return {
    results,
    pass: count('PASS'),
    invalid: count('INVALID'),
    inconclusive: count('INCONCLUSIVE'),
    total: results.length,
  };
}

/** 把三态结果渲染成给人看的一行摘要（只在有 INVALID 时值得展示）。 */
export function summarize(summary) {
  if (!summary || !summary.total)
    return '';
  const { pass, invalid, inconclusive, total } = summary;
  if (!invalid)
    return '';
  return `声明核对：${total} 条中 ${pass} 通过、${invalid} 不符、${inconclusive} 无法判定`;
}
