// citation.js —— 引文核验：只验「出处是否真的这么说过」，不验「说得对不对」。
//
// 为什么需要（2026-11-07 知识区开口）：
// 现有 14 个只读原语全是**本机状态**（端口/路径/进程），一碰"知识类断言"就只能弃权。
// 于是知识区只剩两条坏路：要么不判（等于没覆盖），要么拿模型判模型（拿幻觉核幻觉）。
// 第三条路来自 provenance 这条研究线（Provenance-Carrying Retrieval；
// Catching Hallucinated Citations, arXiv 2608.15574）：**让断言携带出处，核验出处**。
//
// 本模块只做确定性的四件事：
//   SOURCE_MISSING      出处不存在（典型幻觉：引用了根本不存在的文件）
//   QUOTE_NOT_FOUND     出处存在，但里面没有这句引文（最该抓的一类）
//   HASH_MISMATCH       出处内容被改过（调用方给了 sha256 才有这一判）
//   SOURCE_UNREACHABLE  读不到 → insufficient（弃权，不当成"它不存在"）
//   CITATION_OK         引文确实逐字（空白归一后）出现在出处里
//
// ★ 边界（别让后人误读）★
//   CITATION_OK 只证明「引用忠实于来源」，**不证明来源本身正确**。
//   所以它可以把"知识类断言"从"完全不可判"推进到"出处可判"，但不能替代事实判断。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIN_QUOTE = 4;

/** 空白归一：跨行、多空格、全角空格都折叠成一个空格再比。 */
export function normalizeWs(s) {
  return String(s ?? '').replace(/[\s\u3000]+/g, ' ').trim();
}

/**
 * 核验一条引文。
 * @param {{path:string, quote:string, sha256?:string, root?:string}} c
 * @returns {{verdict:'supported'|'contradicted'|'insufficient', code:string, detail:string, resolved?:string}}
 */
export function verifyCitation(c) {
  const p = c && typeof c.path === 'string' ? c.path.trim() : '';
  const quote = c && typeof c.quote === 'string' ? c.quote : '';
  if (!p)
    return { verdict: 'insufficient', code: 'NO_PATH', detail: '没有给出处路径，无法核验' };
  if (normalizeWs(quote).length < MIN_QUOTE)
    return { verdict: 'insufficient', code: 'QUOTE_TOO_SHORT', detail: `引文太短（<${MIN_QUOTE} 字），无法判断是否忠实` };

  const resolved = path.resolve(c.root || process.cwd(), p);
  let stat;
  try {
    stat = fs.statSync(resolved);
  }
  catch (e) {
    const code = e && (e.code === 'EACCES' || e.code === 'EPERM') ? 'SOURCE_UNREACHABLE' : 'SOURCE_MISSING';
    return {
      verdict: code === 'SOURCE_MISSING' ? 'contradicted' : 'insufficient',
      code,
      detail: code === 'SOURCE_MISSING' ? `出处不存在：${resolved}` : `出处读不到：${resolved}`,
      resolved,
    };
  }
  if (stat.isDirectory())
    return { verdict: 'insufficient', code: 'SOURCE_UNREACHABLE', detail: `出处是目录，不是文件：${resolved}`, resolved };

  let buf;
  try {
    buf = fs.readFileSync(resolved);
  }
  catch {
    return { verdict: 'insufficient', code: 'SOURCE_UNREACHABLE', detail: `出处读不到：${resolved}`, resolved };
  }

  const expectHash = typeof c.sha256 === 'string' ? c.sha256.trim().toLowerCase() : '';
  if (expectHash) {
    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    if (actual !== expectHash)
      return { verdict: 'contradicted', code: 'HASH_MISMATCH', detail: `出处内容已变：期望 ${expectHash.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…`, resolved };
  }

  const text = normalizeWs(buf.toString('utf8'));
  const needle = normalizeWs(quote);
  if (text.includes(needle))
    return { verdict: 'supported', code: 'CITATION_OK', detail: `引文在出处的第 ${Math.max(1, text.slice(0, text.indexOf(needle)).split(' ').length)} 个词附近命中`, resolved };

  return { verdict: 'contradicted', code: 'QUOTE_NOT_FOUND', detail: `出处存在，但里面找不到这句引文：${resolved}`, resolved };
}

/** 人话渲染 */
export function renderCitation(r) {
  if (!r)
    return '';
  const label = {
    CITATION_OK: '引文可复核',
    SOURCE_MISSING: '出处不存在',
    QUOTE_NOT_FOUND: '引文与出处不符',
    HASH_MISMATCH: '出处内容已变',
    SOURCE_UNREACHABLE: '出处读不到（弃权）',
  }[r.code] || r.code;
  return `【引文核验】${label} —— ${r.detail}。注意：只证明引用忠实于来源，不证明来源正确。`;
}
