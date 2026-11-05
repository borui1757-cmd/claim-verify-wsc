// aivs.js —— 与 AIVS（IETF draft-stone-aivs-01）对齐的行哈希与链校验。
//
// AIVS 的规定（第 3.1 节）：
//   row_hash = SHA-256(canonical_json({row_id, session_id, action_type,
//                                      tool_name, cost_cents, timestamp, prev_hash}))
//   canonical_json = 键名排序、无空白、UTF-8
// 注意：inputs_json / outputs_json / error **不参与**哈希（便于脱敏与截断）。
//
// 我们只借用它的"行哈希 + 链"这一层；**声称真实性**仍由本插件自己的核验负责
// ——这正是 AIVS 第 9.2 节明确声明它不证明的那一项。

import crypto from 'node:crypto';
import { canonicalJson } from './policy.js';

/** 计算一行 AIVS 哈希。 */
export function aivsRowHash({
  rowId,
  sessionId = '',
  actionType = 'claim_verification',
  toolName = 'claim-verify',
  costCents = 0,
  timestamp,
  prevHash = '',
} = {}) {
  const payload = canonicalJson({
    row_id: rowId,
    session_id: sessionId,
    action_type: actionType,
    tool_name: toolName,
    cost_cents: costCents,
    timestamp,
    prev_hash: prevHash,
  });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** 生成要写进回执的 AIVS 字段块。 */
export function aivsFields({ rowId, sessionId, timestamp, prevHash }) {
  const ts = typeof timestamp === 'number' ? timestamp : Date.now() / 1000;
  const rowHash = aivsRowHash({ rowId, sessionId, timestamp: ts, prevHash: prevHash || '' });
  return {
    row_id: rowId,
    session_id: sessionId || '',
    action_type: 'claim_verification',
    tool_name: 'claim-verify',
    cost_cents: 0,
    timestamp: ts,
    prev_hash: prevHash || '',
    row_hash: rowHash,
  };
}

/** 校验一组回执的 AIVS 链；返回首个断点。 */
export function verifyAivsChain(records) {
  let prev = '';
  let count = 0;
  for (const rec of records || []) {
    const a = rec && rec.aivs;
    if (!a)
      continue;
    const expect = aivsRowHash({
      rowId: a.row_id,
      sessionId: a.session_id,
      actionType: a.action_type,
      toolName: a.tool_name,
      costCents: a.cost_cents,
      timestamp: a.timestamp,
      prevHash: prev,
    });
    if (expect !== a.row_hash)
      return { ok: false, brokenAt: a.row_id, expected: expect, actual: a.row_hash, count };
    if ((a.prev_hash || '') !== prev && count > 0)
      return { ok: false, brokenAt: a.row_id, reason: 'prev_hash 与上一行不一致', count };
    prev = a.row_hash;
    count += 1;
  }
  return { ok: true, count, head: prev };
}
