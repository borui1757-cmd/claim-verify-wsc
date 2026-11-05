// cascade.js —— 级联触发：核验失败 → 下一次请求自动升级模型。
//
// 为什么不在 llm/stream 里重答：
//   该 waterfall 的签名是 (options, next) => AsyncIterable，而 next 是 () => AsyncIterable
//   —— **不接受参数**。第二次调用 next() 只会用同一个已准备好的调用再请求一次同一个模型，
//   换不了 provider/model。而且下游插件（比如 dsh-bill）会被重复触发，可能重复计费。
//
// 所以升级必须落在 agent/request 这个 waterfall 上。它的契约是：
//   dispatch.waterfall('agent/request', { turn, step, signal }, () => seedConfig)
//   监听器返回一个 { provider, model, reasoningEffort?, maxTokens? } 就生效。
//   （见 dsh-agent-loop/lib/index.js:1191）
//
// 语义边界（别夸大）：
//   它提升的是**下一次请求**所用的模型，不是把这一轮的回答推倒重来。
//   要真正"重答同一句"，得在 agent loop 层面重放，那是另一个量级的改动。

import fs from 'node:fs';
import path from 'node:path';

/**
 * 升级决策状态机。纯内存，按 sessionId 记账；不落盘（重启即清空）。
 */
export function createCascade(cfg, logFn = () => {}) {
  // sessionId -> { pending, used, lastAt }
  const state = new Map();
  // agent/request 的 payload 只有 {turn, step, signal}，不带 sessionId，
  // 所以记一下"最近一次失败属于哪个会话"，单用户本地场景够用。
  let lastSessionId = null;

  function slot(sessionId) {
    const key = sessionId || 'unknown';
    let s = state.get(key);
    if (!s) {
      s = { pending: 0, used: 0, lastAt: 0 };
      state.set(key, s);
    }
    return s;
  }

  /** 一轮核验结束时调用；失败就记一次待升级。 */
  function noteFailure(sessionId, hardCount) {
    if (!cfg.enabled || !hardCount)
      return;
    const s = slot(sessionId);
    if (s.used >= cfg.maxEscalations)
      return;
    s.pending += 1;
    s.lastAt = Date.now();
    lastSessionId = sessionId || 'unknown';
    logFn({ event: 'escalation-pending', sessionId, hard: hardCount, pending: s.pending, used: s.used });
  }

  /**
   * 在 agent/request 里决定要不要换模型。
   * @param {string} sessionId
   * @param {{provider:string, model:string}} seed 本轮原本要用的配置
   * @returns {{provider:string, model:string}|null} null = 不升级
   */
  function decide(sessionId, seed) {
    if (!cfg.enabled || !cfg.provider || !cfg.model)
      return null;
    const s = slot(sessionId || lastSessionId);
    if (s.pending <= 0 || s.used >= cfg.maxEscalations)
      return null;
    // 已经在目标模型上了就别再升，避免自我循环
    if (seed && seed.provider === cfg.provider && seed.model === cfg.model)
      return null;
    s.pending -= 1;
    s.used += 1;
    s.lastAt = Date.now();
    logFn({ event: 'escalated', sessionId, from: `${seed?.provider}/${seed?.model}`, to: `${cfg.provider}/${cfg.model}`, used: s.used });
    return { provider: cfg.provider, model: cfg.model };
  }

  function snapshot(sessionId) {
    const s = state.get(sessionId || 'unknown');
    return s ? { ...s } : { pending: 0, used: 0, lastAt: 0 };
  }

  function reset(sessionId) {
    state.delete(sessionId || 'unknown');
  }

  return { noteFailure, decide, snapshot, reset };
}

/** 把升级记录追加到 jsonl（每次升级一行，供后续统计"升级后是否真的更准"）。 */
export function makeEscalationLogger(file) {
  return (entry) => {
    if (!file)
      return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
    }
    catch { /* 日志失败不影响主流程 */ }
  };
}
