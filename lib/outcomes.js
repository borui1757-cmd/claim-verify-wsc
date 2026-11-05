// outcomes.js —— 干预与结果的关联（借鉴 dsh-completion-supervisor 的 outcome 行思想）
//
// 目的：日志里只有"我们说了什么"是不够的，还要知道"用户接下来做了什么"，
// 否则永远无法回答"这次干预是对的么"。
//
// 行格式（JSONL）：
//   { event:'intervention', id, at, sessionId, target, chars }
//   { event:'outcome', id, at, sessionId, kind, afterMs }
//
// 结果类型（保守，只记录可观察的）：
//   user_message      —— 用户随后发消息（可能是在抱怨，也可能是继续；无法自动区分）
//   no_followup       —— 超时仍无任何用户消息（视为这次干预没有引起反弹）

import fs from 'node:fs';
import path from 'node:path';

const PENDING = new Map(); // sessionId -> { id, at, target }
const TIMEOUT_MS = 10 * 60 * 1000;

function append(file, row) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
  }
  catch { /* 记账失败绝不影响主流程 */ }
}

export function makeOutcomeLog(file) {
  return {
    /** 记录一次干预 */
    intervention(sessionId, { target = null, text = '' } = {}) {
      const sid = sessionId || 'default';
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const at = Date.now();
      PENDING.set(sid, { id, at, target });
      append(file, { event: 'intervention', id, at, sessionId: sid, target, chars: String(text || '').length });
      return id;
    },

    /** 用户随后发消息：结掉该会话的干预 */
    userMessage(sessionId) {
      const sid = sessionId || 'default';
      const p = PENDING.get(sid);
      if (!p)
        return null;
      PENDING.delete(sid);
      append(file, { event: 'outcome', id: p.id, at: Date.now(), sessionId: sid, kind: 'user_message', afterMs: Date.now() - p.at });
      return p.id;
    },

    /** 清理超时未跟进的干预 */
    sweep(now = Date.now()) {
      for (const [sid, p] of PENDING) {
        if (now - p.at < TIMEOUT_MS)
          continue;
        PENDING.delete(sid);
        append(file, { event: 'outcome', id: p.id, at: now, sessionId: sid, kind: 'no_followup', afterMs: now - p.at });
      }
    },

    pendingCount() {
      return PENDING.size;
    },
  };
}
