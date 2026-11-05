// worldmodel.js —— 外部化世界模型：把「已验证的事实」写成可查询的账本。
//
// 动机（回应"没有更新世界模型"的批评）：
//   我们不训练模型，而是把真值**外部化**——每一条被程序核验过的声明，
//   连同时间戳与判定，追加到账本；下次遇到同一对象，模型可以先查账。
//   账本本身就是长期记忆，且每条都能被回执追溯。
//
// 与回执的区别：回执是「某次判定的证明」，账本是「截至某时的事实索引」。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STALE_MS = {
  port: 5 * 60 * 1000,
  file: 60 * 60 * 1000,
  cmd: 60 * 60 * 1000,
  other: 60 * 60 * 1000,
};

export function defaultLedgerPath() {
  return path.join(os.homedir(), '.dsh', 'dsh-claim-verify', 'worldmodel.jsonl');
}

/** 追加一条事实。返回写入的记录。 */
export function recordFact({ kind, target, verdict, detail = '', receiptDigest = null, at = Date.now(), file = defaultLedgerPath() }) {
  if (!kind || !target)
    return null;
  const rec = { at, kind: String(kind).slice(0, 20), target: String(target).slice(0, 300), verdict, detail: String(detail).slice(0, 200), receiptDigest };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(rec) + '\n');
  }
  catch {
    return null;
  }
  return rec;
}

/** 读取全部事实（用于统计与查询）。 */
export function readLedger(file = defaultLedgerPath()) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  }
  catch {
    return [];
  }
}

/** 查最近一条关于该对象的事实；过期返回 stale=true。 */
export function lookupFact({ kind, target, now = Date.now(), file = defaultLedgerPath() }) {
  const norm = (s) => String(s || '').replace(/\//g, '\\').toLowerCase();
  const want = norm(target);
  const rows = readLedger(file).filter((r) => r.kind === kind && norm(r.target) === want);
  if (!rows.length)
    return null;
  const last = rows[rows.length - 1];
  const ttl = STALE_MS[kind] ?? STALE_MS.other;
  return { ...last, ageMs: now - last.at, stale: now - last.at > ttl };
}

/** 统计：按 kind/verdict 汇总，并给出最早/最晚时间。 */
export function ledgerStats(file = defaultLedgerPath()) {
  const rows = readLedger(file);
  const byKind = {};
  const byVerdict = {};
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
  }
  return {
    total: rows.length,
    byKind,
    byVerdict,
    first: rows.length ? rows[0].at : null,
    last: rows.length ? rows[rows.length - 1].at : null,
  };
}