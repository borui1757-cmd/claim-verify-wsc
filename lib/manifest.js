// manifest.js —— 任务清单前置 + 覆盖率核算
//
// 依据：ClaimReceipt (arXiv 2609.01992)
//   "核查断言需要两样东西：充分证据 + **一个承诺宇宙**（committed universe），让遗漏变得可见。"
//
// 换成我们的问题：
//   现在覆盖率 = 能抽到的断言 / 句子总数  ≈ 8%（受说话方式限制）
//   正解覆盖率 = 有回执的清单项 / 承诺的清单项  ≈ 可接近 100%
//
// 工作流：
//   开工前  → createManifest(items)  把"要做哪几件事"冻结成清单（带哈希）
//   每步后  → 产生回执（已有）
//   收工时  → computeCoverage(manifest, receipts) → covered/total、缺哪几项
//   缺项    → INCONCLUSIVE_COVERAGE（不是"失败"，是"证据不全"）

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** 规范化成可哈希的字符串（键序固定） */
function canonical(v) {
  if (Array.isArray(v))
    return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object')
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

/**
 * 建清单（冻结）。
 * @param {{sessionId?:string, title?:string, items:Array<{desc:string, claim?:object}>}} p
 */
export function createManifest({ sessionId, title, items, at } = {}) {
  const list = (Array.isArray(items) ? items : []).map((it, i) => ({
    id: it.id || `m${i + 1}`,
    desc: String(it.desc || '').slice(0, 200),
    claim: it.claim || null,
  }));
  const body = {
    v: 1,
    kind: 'manifest',
    at: at || new Date().toISOString(),
    sessionId: sessionId ?? null,
    title: String(title || '').slice(0, 100),
    items: list,
  };
  // 摘要只覆盖**内容**（不含时间戳）：
  // 这样"同样的承诺"永远得到同一个哈希，和时间无关——冻结的是承诺本身。
  const content = { v: body.v, kind: body.kind, sessionId: body.sessionId, title: body.title, items: body.items };
  return { ...body, digest: sha256(canonical(content)) };
}

/** 清单里每一项，找有没有对应的"支持"回执 */
function matchItem(item, receiptClaims) {
  for (const c of receiptClaims || []) {
    if (c.verdict !== 'supported')
      continue;
    const t = c.claim || {};
    if (item.claim) {
      // 按 kind + 目标匹配
      if (String(t.kind || '') !== String(item.claim.kind || ''))
        continue;
      const a = JSON.stringify(t.value ?? t.target);
      const b = JSON.stringify(item.claim.value ?? item.claim.target);
      if (a === b)
        return c;
      // 宽松：路径类忽略大小写与斜杠方向
      if (item.claim.kind === 'path' && String(t.value || '').toLowerCase().replace(/\//g, '\\')
        === String(item.claim.value || '').toLowerCase().replace(/\//g, '\\'))
        return c;
      continue;
    }
    // 没写 claim：按描述关键词粗匹配（最后手段，会标低置信）
    if (item.desc && JSON.stringify(t).includes(item.desc.slice(0, 12)))
      return c;
  }
  return null;
}

/**
 * 覆盖率核算。
 * @param {object} manifest
 * @param {Array<{claims:Array}>} receipts 回执（每条含 claims）
 * @returns {{total:number, covered:number, coverage:number, missing:Array, verdict:string}}
 */
export function computeCoverage(manifest, receipts) {
  const items = (manifest && manifest.items) || [];
  const claims = [];
  for (const r of Array.isArray(receipts) ? receipts : [])
    for (const c of (r && r.claims) || [])
      claims.push(c);

  const missing = [];
  let covered = 0;
  for (const it of items) {
    if (matchItem(it, claims))
      covered += 1;
    else
      missing.push({ id: it.id, desc: it.desc });
  }

  const total = items.length;
  const coverage = total ? covered / total : 0;
  const verdict = total === 0 ? 'NO_MANIFEST'
    : covered === total ? 'COVERAGE_PASS'
      : 'INCONCLUSIVE_COVERAGE';

  return { total, covered, coverage, missing, verdict };
}

/** 追加写到 jsonl（一单一行的清单，或每次一份） */
export function saveManifest(file, manifest) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(manifest) + '\n', 'utf8');
  return file;
}

/** 读最近一份清单（按 sessionId 过滤） */
export function loadLatestManifest(file, sessionId) {
  if (!fs.existsSync(file))
    return null;
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const m = JSON.parse(lines[i]);
      if (!sessionId || m.sessionId === sessionId)
        return m;
    }
    catch { /* 跳过坏行 */ }
  }
  return null;
}

/** 人话报告 */
export function renderCoverage(cov) {
  if (!cov || cov.total === 0)
    return '';
  if (cov.verdict === 'COVERAGE_PASS')
    return `【覆盖率】清单 ${cov.total} 项全部有回执（${cov.covered}/${cov.total}）。`;
  const names = cov.missing.slice(0, 3).map((m) => m.desc || m.id).join('；');
  return `【覆盖率不足】清单 ${cov.total} 项里只有 ${cov.covered} 项有回执，缺：${names}${cov.missing.length > 3 ? ' 等' : ''}。`;
}
