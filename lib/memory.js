// memory.js —— 真值记忆（grounded memory）
//
// 与常见 agent 记忆的差别：
//   mem0 / Zep / Graphiti：从**对话**里抽取事实，再按时间失效
//   本模块：记忆的写入由**核验结果**驱动——先问系统"是不是这样"，再决定记不记
//
// 依据（文献 + 我们的实验）：
//   · "More Memory, Worse Agents"：记忆会复现错误 → 每条带来源与真值标记
//   · "What Is Seen Cannot Be Unseen"：冲突会破坏行为 → 冲突提前消解，不并列
//   · 我们的实验：并列陈述被辩论（4/8）→ 注入时必须**断言化**
//
// 六条规则：
//   ① 值 + 来源 + 时间 + 作用域 + 置信
//   ② 冲突优先级写死：os > observation > inference > summary
//   ③ 双时态：valid_from / valid_to，不覆盖
//   ④ 注入前按作用域与时效过滤
//   ⑤ 注入用断言句式，不并列两种说法
//   ⑥ 记录"曾导致纠错失败"，用于淘汰

import fs from 'node:fs';
import path from 'node:path';

const PRIORITY = { os: 3, observation: 2, inference: 1, summary: 0 };

/**
 * @param {string} file JSONL 文件路径
 */
export function makeMemory(file) {
  const load = () => {
    if (!fs.existsSync(file))
      return [];
    return fs.readFileSync(file, 'utf8').trim().split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  };
  const append = (row) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify(row) + '\n');
    }
    catch { /* 记账失败不影响主流程 */ }
  };

  /** 折叠日志 → 当前有效记忆 */
  const current = (scope) => {
    const rows = load();
    const map = new Map();
    // 先按时间排序（日志本应有序，稳妥起见）
    rows.sort((a, b) => (a.at || 0) - (b.at || 0));
    for (const r of rows) {
      if (scope && r.scope !== scope)
        continue;
      if (r.op === 'invalidate') {
        const cur = map.get(r.key);
        if (cur && r.at >= cur.validFrom)
          map.delete(r.key);
        continue;
      }
      if (r.op !== 'set')
        continue;
      const prev = map.get(r.key);
      const p = PRIORITY[r.source] ?? 0;
      const pp = prev ? (PRIORITY[prev.source] ?? 0) : -1;
      // 高优先级来源可以覆盖；同优先级后来者覆盖
      if (!prev || p >= pp)
        map.set(r.key, { ...r, validFrom: r.at, confidence: r.confidence ?? (p / 3) });
    }
    return map;
  };

  return {
    /** 写入一条记忆（应来自核验结果） */
    set({ key, value, source = 'os', scope = 'project', at = Date.now(), confidence }) {
      if (!key)
        throw new Error('需要 key');
      append({ op: 'set', key, value, source, scope, at, confidence });
      return this.get(key, scope);
    },

    /** 失效（双时态：不删旧行，只记失效） */
    invalidate(key, { scope = 'project', at = Date.now() } = {}) {
      append({ op: 'invalidate', key, scope, at });
    },

    /** 取当前有效值 */
    get(key, scope) {
      return current(scope).get(key) || null;
    },

    /** 列出当前有效记忆 */
    list(scope) {
      return [...current(scope).values()];
    },

    /** 注入文本：断言化，不并列 */
    render(key, scope) {
      const m = this.get(key, scope);
      if (!m)
        return null;
      const when = new Date(m.validFrom).toISOString();
      return `【系统记录】${m.key} = ${JSON.stringify(m.value)}（来源：${m.source}，记录于 ${when}）`;
    },

    /** 记录一次"这条记忆导致纠错失败" */
    markFailure(key, note = '') {
      append({ op: 'failure', key, note, at: Date.now() });
      return this.failureCount(key);
    },

    failureCount(key) {
      return load().filter((r) => r.op === 'failure' && r.key === key).length;
    },
  };
}
