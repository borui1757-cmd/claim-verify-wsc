// rulestore.js —— 规则的可修正性与健康度（TellOnce 的核心：revisable）
//
// 为什么需要：
//   规则和环境绑死。「报时间必须跑命令」在 DSH 里是错的——宿主每轮注入时间。
//   规则一旦失效又改不了，就变成永久误报源。
//
// 这个模块给每条规则记：启用状态 / 环境指纹 / 命中数 / 停用原因。
// 用户可以随时 `disable(id, reason)`，下一次运行立刻生效。

import fs from 'node:fs';
import path from 'node:path';

export function makeRuleStore(file) {
  let state = { version: 1, rules: {} };
  try {
    if (fs.existsSync(file))
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  catch { /* 坏文件当作空 */ }

  const slot = (id) => {
    if (!state.rules[id])
      state.rules[id] = { enabled: true, hits: 0, skips: 0, disabledReason: null, lastHitAt: null };
    return state.rules[id];
  };

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
    }
    catch { /* 写不进去不影响主流程 */ }
  }

  return {
    /** 这条规则现在该跑吗 */
    isEnabled(id) {
      return slot(id).enabled !== false;
    },
    /** 记一次命中 */
    hit(id) {
      const s = slot(id);
      s.hits += 1;
      s.lastHitAt = new Date().toISOString();
      save();
    },
    /** 记一次「因前置条件不满足而跳过」 */
    skip(id) {
      slot(id).skips += 1;
      save();
    },
    /** 停用一条规则（可修正性的入口） */
    disable(id, reason = '') {
      const s = slot(id);
      s.enabled = false;
      s.disabledReason = reason;
      save();
      return s;
    },
    enable(id) {
      const s = slot(id);
      s.enabled = true;
      s.disabledReason = null;
      save();
      return s;
    },
    snapshot() {
      return JSON.parse(JSON.stringify(state));
    },
    /** 健康度：跳过多、命中少的规则可以考虑停用 */
    health() {
      return Object.entries(state.rules).map(([id, s]) => ({
        id,
        enabled: s.enabled !== false,
        hits: s.hits,
        skips: s.skips,
        ratio: s.hits + s.skips ? s.hits / (s.hits + s.skips) : 0,
        disabledReason: s.disabledReason,
      })).sort((a, b) => a.ratio - b.ratio);
    },
  };
}
