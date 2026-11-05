// consolidate.js —— 副交情的慢循环：整理账本，而不是继续应激。
//
// 快循环（交感）：每步核验、发现矛盾就回写重试。
// 慢循环（副交感）：定期做的事——去重、清噪音、过期归档、重估统计。
//
// 零模型调用。

import fs from 'node:fs';
import path from 'node:path';

const TTL_MS = {
  port: 5 * 60 * 1000,
  file: 60 * 60 * 1000,
  cmd: 60 * 60 * 1000,
  other: 60 * 60 * 1000,
};

const TEMP_RE = /(\\Temp\\|\\tmp\\|\/tmp\/|\.tmp$|\.cv-tmp|AppData\\Local\\Temp)/i;
const TEST_CMD_RE = /^(node -e|npm (test|run)|npx |python -c|pytest|echo |dir |ls |where |findstr |Test-Path|Get-Content|Get-ChildItem|curl |Invoke-WebRequest)/i;

/** 判断一条记录是否噪音（临时路径 / 测试命令）。 */
export function isNoise(rec) {
  const t = String(rec.target || '');
  if (rec.kind === 'file')
    return TEMP_RE.test(t);
  if (rec.kind === 'cmd')
    return TEST_CMD_RE.test(t.trim());
  return false;
}

/**
 * 整理账本。
 * @returns {{kept:number, archived:number, merged:number, noise:number, expired:number}}
 */
export function consolidate(rows, { now = Date.now(), keepNoise = false } = {}) {
  const byKey = new Map();
  let noise = 0;
  let expired = 0;
  for (const r of rows) {
    if (!keepNoise && isNoise(r)) {
      noise += 1;
      continue;
    }
    const ttl = TTL_MS[r.kind] ?? TTL_MS.other;
    if (now - r.at > ttl) {
      expired += 1;
      continue;
    }
    const key = `${r.kind}|${String(r.target).replace(/\//g, '\\').toLowerCase()}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { ...r, count: 1 });
      continue;
    }
    cur.count = (cur.count || 1) + 1;
    if (r.at >= cur.at) {
      const c = cur.count;
      Object.assign(cur, r, { count: c });
    }
  }
  const kept = [...byKey.values()];
  return { kept, stats: { kept: kept.length, archived: rows.length - kept.length - noise - expired, merged: rows.length - kept.length - noise - expired, noise, expired } };
}

/** 把整理结果写回（原子替换）并归档原文件。 */
export function consolidateFile(file, { now = Date.now(), archiveDir = path.dirname(file) } = {}) {
  if (!fs.existsSync(file))
    return { ok: false, reason: '账本不存在' };
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  if (!rows.length)
    return { ok: false, reason: '账本为空' };

  const { kept, stats } = consolidate(rows, { now });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const archive = path.join(archiveDir, `worldmodel.archive-${stamp}.jsonl`);
  try {
    fs.writeFileSync(archive, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''));
    fs.renameSync(tmp, file);
  }
  catch (e) {
    return { ok: false, reason: String(e && e.message).slice(0, 120) };
  }
  return { ok: true, ...stats, archive };
}
