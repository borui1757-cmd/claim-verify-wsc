// memory-mem0.js —— 真值记忆 ↔ mem0 的适配层
//
// 分工：
//   我们的 memory.js：写入闸门（只存核验通过的事实）+ 冲突优先级
//   mem0           ：存储与语义检索（本地 SQLite 即可）
//
// 本模块只做**格式转换与裁决**，不依赖 mem0 包本身，便于测试。

/** 来源优先级（与 memory.js 保持一致） */
export const PRIORITY = { os: 3, observation: 2, inference: 1, summary: 0 };

/** 我们的一条记忆 → mem0 的 add 参数 */
export function toMem0Add(entry, { userId, agentId } = {}) {
  const { key, value, source = 'os', scope = 'project', validFrom = Date.now(), confidence } = entry || {};
  if (!key)
    throw new Error('需要 key');
  return {
    messages: [{ role: 'system', content: `系统确认：${key} = ${JSON.stringify(value)}` }],
    ...(userId ? { userId } : {}),
    ...(agentId ? { agentId } : {}),
    metadata: {
      key,
      source,
      scope,
      verified: source === 'os' || source === 'observation',
      priority: PRIORITY[source] ?? 0,
      validFrom,
      ...(confidence === undefined ? {} : { confidence }),
    },
  };
}

/** mem0 的检索结果 → 我们的一条记忆 */
export function fromMem0Hit(hit) {
  const m = (hit && hit.metadata) || {};
  return {
    key: m.key || String(hit?.memory || ''),
    value: hit?.memory ?? null,
    source: m.source || 'inference',
    scope: m.scope || 'project',
    validFrom: m.validFrom || (hit?.createdAt ? Date.parse(hit.createdAt) : Date.now()),
    priority: m.priority ?? PRIORITY[m.source] ?? 0,
    verified: m.verified === true,
  };
}

/**
 * 新旧记忆冲突时，谁胜出？
 * 规则：优先级高的胜；同优先级时新的胜。
 * @returns {'new'|'old'|'tie'}
 */
export function shouldSupersede(incoming, existing) {
  const a = PRIORITY[incoming?.source] ?? incoming?.priority ?? 0;
  const b = PRIORITY[existing?.source] ?? existing?.priority ?? 0;
  if (a > b) return 'new';
  if (a < b) return 'old';
  const ta = Number(incoming?.validFrom || 0);
  const tb = Number(existing?.validFrom || 0);
  if (ta > tb) return 'new';
  if (ta < tb) return 'old';
  return 'tie';
}

/**
 * 给检索结果排序（注入前用）：verified 优先，其次优先级，其次新。
 */
export function rankHits(hits = []) {
  return [...hits].map(fromMem0Hit).sort((x, y) => {
    if (x.verified !== y.verified) return x.verified ? -1 : 1;
    if (x.priority !== y.priority) return y.priority - x.priority;
    return (y.validFrom || 0) - (x.validFrom || 0);
  });
}

/** 注入文本：断言化；冲突时只注入胜者，不并列 */
export function renderInjection(winner) {
  if (!winner) return null;
  const when = new Date(winner.validFrom || Date.now()).toISOString();
  return `【系统记录】${winner.key} = ${JSON.stringify(winner.value)}（来源：${winner.source}，记录于 ${when}）`;
}
