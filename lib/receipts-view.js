// receipts-view.js —— 回执的读取/过滤/格式化（CLI 与测试共用，保持纯函数）。
import fs from 'node:fs';

/** 读 receipts.jsonl；坏行跳过，不让一条脏数据毁掉列表。 */
export function loadReceipts(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      if (!line.trim())
        continue;
      try { out.push(JSON.parse(line)); } catch { /* 坏行跳过 */ }
    }
    return out;
  }
  catch {
    return [];
  }
}

/**
 * 过滤回执。
 * @param {Array} rows
 * @param {{session?:string, since?:number|string, limit?:number, onlyContradicted?:boolean}} opts
 */
export function filterReceipts(rows, opts = {}) {
  let list = Array.isArray(rows) ? rows.slice() : [];
  if (opts.session)
    list = list.filter((r) => String(r.sessionId || '').includes(String(opts.session)));
  if (opts.since) {
    const from = typeof opts.since === 'number' ? opts.since : Date.parse(String(opts.since));
    if (Number.isFinite(from))
      list = list.filter((r) => Date.parse(r.at || '') >= from);
  }
  if (opts.onlyContradicted)
    list = list.filter((r) => (r.summary?.contradicted || 0) > 0);
  if (Number.isInteger(opts.limit) && opts.limit > 0)
    list = list.slice(-opts.limit);
  return list;
}

/** 一行摘要文本。 */
export function formatReceipt(r, { verify } = {}) {
  const s = r.summary || {};
  const at = String(r.at || '').replace('T', ' ').slice(0, 19);
  const sid = String(r.sessionId || '-').replace(/^session-/, '').slice(0, 8);
  const sig = String(r.sig || '').slice(0, 8);
  const verdict = verify === undefined ? '' : verify ? ' 验签✓' : ' 验签✗';
  return `${at}  ${sid}  ${s.supported || 0}支持/${s.contradicted || 0}反驳/${s.insufficient || 0}无证据  digest=${String(r.digest || '').slice(0, 10)} sig=${sig}${verdict}`;
}

/** 汇总多份回执：总声明数、各类判定、有多少份含反驳。 */
export function summarizeReceipts(rows) {
  const t = { receipts: rows.length, claims: 0, supported: 0, contradicted: 0, insufficient: 0, withContradiction: 0 };
  for (const r of rows) {
    const s = r.summary || {};
    t.claims += s.total || 0;
    t.supported += s.supported || 0;
    t.contradicted += s.contradicted || 0;
    t.insufficient += s.insufficient || 0;
    if ((s.contradicted || 0) > 0)
      t.withContradiction += 1;
  }
  return t;
}
