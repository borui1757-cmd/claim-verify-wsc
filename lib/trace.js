// trace.js —— 工具轨迹缓冲（给证据表用）+ 落盘（给人工标注用）。
//
// 事件形状取自本机实测（2026-11-05，12 个会话 3195 条 call）：
//   tool/call   { turn, step, callId, name, arguments(JSON 字符串) }
//   tool/result { turn, step, message:{ role:'tool', toolCallId, source:{callId}, content:[{type:'text',text}], isError }, error? }
//
// createTrace() 只缓冲，不判定。evidence.js 从 pair 上读这些字段：
//   { name, args(对象), isError, resultSeen, errorName, callSeq, turn }

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX = 400;

function contentText(message) {
  const content = message && message.content;
  if (typeof content === 'string')
    return content;
  if (!Array.isArray(content))
    return '';
  const parts = [];
  for (const part of content) {
    if (part && typeof part.text === 'string')
      parts.push(part.text);
    else if (part && typeof part.type === 'string')
      parts.push(`[${part.type}]`);
  }
  return parts.join('\n');
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object')
    return raw;
  if (typeof raw !== 'string')
    return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  }
  catch {
    return null; // 参数不是合法 JSON：不炸，只是没有可用参数
  }
}

/**
 * 会话内工具调用/结果缓冲。
 * @param {{maxPerSession?: number}} [options]
 */
export function createTrace(options = {}) {
  const maxPerSession = Number(options.maxPerSession) > 0 ? Number(options.maxPerSession) : DEFAULT_MAX;
  /** @type {Map<string, {items: Map<string, object>, order: string[], dropped: number}>} */
  const bySession = new Map();

  function bucketOf(sid) {
    let b = bySession.get(sid);
    if (!b) {
      b = { items: new Map(), order: [], dropped: 0 };
      bySession.set(sid, b);
    }
    return b;
  }

  function trim(b) {
    while (b.order.length > maxPerSession) {
      const oldest = b.order.shift();
      b.items.delete(oldest);
      b.dropped += 1;
    }
  }

  return {
    /** 记录一条 session 事件（只关心 tool/call 与 tool/result）。 */
    onEvent(session, event) {
      try {
        if (!event || !event.type)
          return;
        const sid = typeof session === 'string' ? session : (session && session.id) || null;
        if (!sid)
          return;
        if (event.type !== 'tool/call' && event.type !== 'tool/result')
          return;

        const b = bucketOf(sid);
        const d = event.data || {};

        if (event.type === 'tool/call') {
          const callId = d.callId ?? d.id ?? null;
          if (!callId)
            return;
          const pair = {
            callId,
            turn: Number.isInteger(d.turn) ? d.turn : undefined,
            step: Number.isInteger(d.step) ? d.step : undefined,
            name: String(d.name ?? d.tool ?? d.toolName ?? 'unknown'),
            args: parseArgs(d.arguments ?? d.args),
            callSeq: event.seq ?? null,
            isError: false,
            resultSeen: false,
            errorName: undefined,
            text: '',
          };
          if (!b.items.has(callId))
            b.order.push(callId);
          b.items.set(callId, pair);
          trim(b);
          return;
        }

        // tool/result
        const msg = d.message || {};
        const callId = (msg.source && msg.source.callId) ?? msg.toolCallId ?? d.callId ?? null;
        if (!callId)
          return;
        let pair = b.items.get(callId);
        if (!pair) {
          // 没有对应 call（截断/恢复）：仍然记录结果，名字未知
          pair = {
            callId,
            turn: Number.isInteger(d.turn) ? d.turn : undefined,
            step: Number.isInteger(d.step) ? d.step : undefined,
            name: 'unknown',
            args: null,
            callSeq: null,
            isError: false,
            resultSeen: false,
            errorName: undefined,
            text: '',
          };
          b.order.push(callId);
          b.items.set(callId, pair);
          trim(b);
        }
        pair.isError = msg.isError === true;
        pair.errorName = (d.error && typeof d.error.name === 'string') ? d.error.name : pair.errorName;
        pair.resultSeen = true;
        pair.text = contentText(msg);
        if (Number.isInteger(d.turn))
          pair.turn = d.turn;
        if (Number.isInteger(d.step))
          pair.step = d.step;
      }
      catch { /* 缓冲失败绝不影响会话 */ }
    },

    /**
     * 取某个会话的工具配对。
     * @param {string} sessionId
     * @param {number} [turn] 只取某一轮（不传则全部）
     */
    pairs(sessionId, turn) {
      const b = sessionId ? bySession.get(sessionId) : undefined;
      if (!b)
        return { pairs: [], truncated: false };
      const all = b.order.map((id) => b.items.get(id)).filter(Boolean);
      const picked = Number.isInteger(turn) ? all.filter((p) => p.turn === turn) : all;
      return { pairs: picked.map((p) => ({ ...p })), truncated: b.dropped > 0 };
    },
  };
}

/** 追加一行 trace；任何异常都不影响对话。 */
export function appendTrace(logFile, entry) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  }
  catch { /* 落盘失败不影响主流程 */ }
}

/** 组装一条「本轮答案 + 本轮接地材料」记录（供人工标注与以后接 MiniCheck）。 */
export function buildTrace({ sessionId, grounding, answer, provider, model, answerMax = 4000 }) {
  const text = String(answer || '');
  return {
    at: new Date().toISOString(),
    sessionId: sessionId ?? null,
    provider: provider ?? null,
    model: model ?? null,
    answerChars: text.length,
    answer: text.slice(0, answerMax),
    groundingChars: grounding ? grounding.chars : 0,
    tools: grounding ? grounding.blocks.length : 0,
    toolErrors: grounding ? grounding.errors : 0,
    grounding: grounding ? grounding.doc : '',
  };
}
