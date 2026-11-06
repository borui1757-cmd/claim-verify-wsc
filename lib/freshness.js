// freshness.js —— 验证结果的**新鲜度**，以及过期后的再验证。
//
// 为什么需要：我们的验证是点的（point-in-time），结论会随时间变质。
// 文献把这叫 **assurance freshness gap**（"The Assurance Freshness Gap: Risk-Bounded
// Revalidation ... for Tool-Using AI Agents"）——验证结论有个保质期，过期就该重验。
//
// 我们之前用固定 TTL 缓存（服务 3 秒），问题是：
//   - TTL 内的真实变化被掩盖（服务 3 秒内停了，仍读到 RUNNING）
//   - 不同事实的变质速度完全不同（文件哈希几乎不变，端口随时变）
//
// 做法：给每个结论盖时间戳 + 按类型定保质期；消费时判新鲜度，不新鲜就（按风险）重验。
// 这是**有意识的取舍**：宁可短暂过期，也不每次重查把开销拉满。

/** 各类型的默认保质期（毫秒）。0 表示"内容寻址，永久有效"。 */
export const DEFAULT_TTL = {
  hash: 0,        // 内容寻址：哈希不变就永远对
  size: 30_000,
  lines: 30_000,
  path: 30_000,
  filecount: 30_000,
  pkgversion: 300_000,
  mem: 2_000,
  disk: 30_000,
  port: 5_000,
  pid: 2_000,
  service: 3_000,
  registry: 30_000,
  task: 30_000,
};

/** 给一条已核验结论盖章。 */
export function stamp(kind, verdict, opts = {}) {
  const ttlMs = opts.ttlMs !== undefined ? opts.ttlMs : (DEFAULT_TTL[kind] ?? 10_000);
  return {
    kind,
    verdict,
    at: opts.nowMs !== undefined ? opts.nowMs : Date.now(),
    ttlMs,
    detail: opts.detail || '',
  };
}

/** 是否仍然新鲜。ttl=0 视为永久新鲜（内容寻址）。 */
export function isFresh(record, nowMs = Date.now()) {
  if (!record)
    return false;
  if (record.ttlMs === 0)
    return true;
  return nowMs - record.at <= record.ttlMs;
}

/** 剩余新鲜时间（毫秒）；已过期返回 0。 */
export function remainingMs(record, nowMs = Date.now()) {
  if (!record)
    return 0;
  if (record.ttlMs === 0)
    return Infinity;
  return Math.max(0, record.ttlMs - (nowMs - record.at));
}

/**
 * 过期才重验（risk-bounded revalidation 的最小实现）。
 * 新鲜的直接返回旧结论，避免无谓开销；不新鲜才调用 revalidate。
 */
export async function revalidateIfStale(record, revalidate, nowMs = Date.now()) {
  if (isFresh(record, nowMs))
    return { ...record, reused: true };
  const fresh = await revalidate();
  return { ...fresh, reused: false };
}

/** 一批结论里有多少已经过期（用来观察"新鲜度缺口"有多大）。 */
export function staleCount(records, nowMs = Date.now()) {
  const list = Array.isArray(records) ? records : [];
  return list.filter((r) => !isFresh(r, nowMs)).length;
}
