// revision-advice.js —— 把「四态」变成下一轮的**干预**，而不只是账本里的一行。
//
// 为什么需要：原子修订层如果只记录不改变行为，等于装了个行车记录仪却没刹车。
// HANDOFF-2026-11-07 的目标是区分：
//   认了没改（ackOnly，顺从型认罪）—— 嘴上认错，动作没留下痕迹
//   改了没认（actOnly，静默变更）—— 动了手，但没承认之前那条断言错了
// 这两种在下一轮都该被点名，而且必须**带证据、可复核**，不能只说"你不对"。
//
// 数据来源：revisions.jsonl（原子，正常）与 revisions-shadow.jsonl（未成事务的候选）。
// 只看最近 limit 条，同一 claimId 只提醒一次 —— 反馈预算比信息量更金贵。

import fs from 'node:fs';
import path from 'node:path';
import { REVISIONS_FILE, SHADOW_FILE } from './revision-log.js';

const readJsonl = (file) => {
  if (!fs.existsSync(file))
    return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)) {
    try { out.push(JSON.parse(line)); }
    catch { /* 坏行跳过 */ }
  }
  return out;
};

/**
 * 从修订记录里生成"下一轮该说什么"。
 * @returns {{ lines: string[], counts: object, samples: object[] }}
 */
export function adviseFromRevisions(dir, { limit = 8 } = {}) {
  const rows = readJsonl(path.join(dir, REVISIONS_FILE));
  const shadow = readJsonl(path.join(dir, SHADOW_FILE));
  const recent = shadow.slice(-limit);

  const counts = { atomic: rows.length, ackOnly: 0, actOnly: 0, none: 0 };
  const seen = new Set();
  const lines = [];
  const samples = [];

  for (const r of recent) {
    if (!r || typeof r !== 'object')
      continue;
    const ack = r.ack;
    const ok = r.action && r.action.ok === true;
    const claimId = String(r.claimId || r.txid || '?');
    const type = (r.action && r.action.type) || 'action';

    if (ack === 'admitted' && !ok)
      counts.ackOnly += 1;
    else if (ack !== 'admitted' && ok)
      counts.actOnly += 1;
    else
      counts.none += 1;

    if (seen.has(claimId))
      continue;

    if (ack === 'admitted' && !ok) {
      seen.add(claimId);
      samples.push({ claimId, kind: 'ackOnly', type, txid: r.txid });
      lines.push(
        `【修订】你认了账，但系统没有观测到改动（${type}，claim ${claimId}）。`
        + '只认不改不算完成：要么真的改，要么说明为什么不需要改。',
      );
    }
    else if (ack !== 'admitted' && ok) {
      seen.add(claimId);
      samples.push({ claimId, kind: 'actOnly', type, txid: r.txid });
      lines.push(
        `【修订】你在没有认账的情况下做了改动（${type}，claim ${claimId}）。`
        + '若之前那条断言确实错了，请明确说出来；否则写清这次改动的理由。',
      );
    }
  }

  return { lines, counts, samples };
}
