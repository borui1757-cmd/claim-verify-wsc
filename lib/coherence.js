// coherence.js —— 用「失效通知」代替「过期时间」。
//
// 类比：分布式缓存的 cache coherence。
//   我们之前的做法是 TTL（等它自己过期）→ **过期前的变化看不见**，过期后又白查一次。
//   正统做法是 **invalidate**：世界一变，立刻把相关结论标为失效。
//
// 谁知道世界变了？已经有两个人：
//   - timeline-box.record()：每次曝光时知道版本变了
//   - atomic-snapshot.isStale()：需要时能查
// 这个模块负责把"变更"翻译成"哪些结论作废"。

/**
 * 结论登记册：key -> {verdict, version, at}
 * version 是登记时的世界版本（文件哈希 / 服务状态字符串等）；
 * 取用时若世界版本变了，视为失效。
 */
export function createCoherence() {
  const entries = new Map();

  return {
    /** 登记一条结论 */
    put(key, verdict, version, nowMs = Date.now()) {
      entries.set(key, { verdict, version, at: nowMs });
      return entries.get(key);
    },

    /** 主动失效（知道世界变了就调它，不用等过期） */
    invalidate(key) {
      return entries.delete(key);
    },

    /** 按前缀批量失效（例如某个目录下所有路径） */
    invalidatePrefix(prefix) {
      let n = 0;
      for (const k of [...entries.keys()]) {
        if (k.startsWith(prefix)) {
          entries.delete(k);
          n += 1;
        }
      }
      return n;
    },

    /**
     * 取用：版本一致才返回，否则视为失效（返回 null）。
     * 这就是"一致性"与"过期"的区别——我们看的是**世界有没有变**，不是**过了多久**。
     */
    get(key, currentVersion) {
      const e = entries.get(key);
      if (!e)
        return null;
      if (currentVersion !== undefined && currentVersion !== e.version) {
        entries.delete(key);
        return null;
      }
      return e;
    },

    /** 仅看存在性，不校验版本 */
    peek(key) {
      return entries.get(key) || null;
    },

    size() {
      return entries.size;
    },

    clear() {
      entries.clear();
    },
  };
}
