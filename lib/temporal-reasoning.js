// temporal-reasoning.js —— 跨消息时序：是"矛盾"还是"演化"？
//
// 骑士题里的矛盾是**同一时刻**的说法冲突。
// 但我们的断言分布在时间线上：昨天说"文件在"，今天说"文件没了"——那不是撒谎，是世界变了。
//
// 所以判矛盾必须带时间：
//   - 同一时刻的两条冲突       → 真矛盾
//   - 不同时刻 + 中间有变化证据 → 演化（不报）
//   - 不同时刻 + 没有变化证据   → 可疑（可能是漏报变化），但不直接判假

/**
 * @param {object} a 断言 {claim, at}（at 为毫秒时间戳）
 * @param {object} b 另一条
 * @param {Array<{at:number, path?:string, op:string}>} events 世界变化事件（delta/tombstone）
 * @returns {{kind:'contradiction'|'evolution'|'suspicious', reason:string}}
 */
export function classifyTemporal(a, b, events = []) {
  const ta = Number(a && a.at) || 0;
  const tb = Number(b && b.at) || 0;
  const gap = Math.abs(ta - tb);

  // 同一时刻（或极近）：就是矛盾
  if (gap <= 5_000)
    return { kind: 'contradiction', reason: `两条说法只差 ${Math.round(gap / 1000)} 秒，属于同一时刻的冲突` };

  // 找两者之间有没有"改变世界"的事件
  const lo = Math.min(ta, tb);
  const hi = Math.max(ta, tb);
  const target = (a && a.claim && a.claim.value && (a.claim.value.path || a.claim.value))
    || (b && b.claim && b.claim.value && (b.claim.value.path || b.claim.value));
  const within = (Array.isArray(events) ? events : []).filter((e) => e && e.at >= lo && e.at <= hi);
  const relevant = within.filter((e) => {
    if (!target || typeof target !== 'string')
      return true;
    const p = e.path || '';
    return String(p).toLowerCase() === String(target).toLowerCase();
  });

  if (relevant.length)
    return { kind: 'evolution', reason: `中间有 ${relevant.length} 次变化事件，属于世界变了而不是撒谎` };

  return { kind: 'suspicious', reason: `相隔 ${Math.round(gap / 60000)} 分钟、没有变化证据，可能是漏报变化` };
}

/** 批量：把一组带时间的断言两两分类，只返回非演化的那些 */
export function findTemporalIssues(items, events = []) {
  const out = [];
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const ka = keyOf(a);
      const kb = keyOf(b);
      if (!ka || ka !== kb)
        continue;
      if (JSON.stringify(a.claim.value) === JSON.stringify(b.claim.value))
        continue;
      const r = classifyTemporal(a, b, events);
      if (r.kind !== 'evolution')
        out.push({ a, b, ...r });
    }
  }
  return out;
}

function keyOf(item) {
  const c = item && item.claim;
  if (!c)
    return null;
  const v = c.value;
  if (c.kind === 'path') return 'path|' + String(v).toLowerCase();
  if (c.kind === 'lines' || c.kind === 'size' || c.kind === 'hash')
    return c.kind + '|' + String(v && v.path || '').toLowerCase();
  return c.kind + '|' + JSON.stringify(v);
}
