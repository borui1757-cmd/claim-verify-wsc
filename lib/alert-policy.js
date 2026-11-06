// alert-policy.js —— 精度优先的告警策略（治 alert fatigue）。
//
// 类比：运维/IDS 的 **alert fatigue**。
//   告警系统的成功标准不是"抓了多少"，而是"**不打扰**"：
//     误报多了，人会关掉它；关掉之后，真阳性也一起失效。
//   我们的 12 类误报全都错在这一条上。
//
// 三条规则（都来自运维实践）：
//   1. **合流**：同一个 key 在冷却期内只报一次（dedupe）
//   2. **限额**：每轮最多报 N 条，超出的降级为日志
//   3. **升级**：同一 key 反复命中才提高可见度（不靠单次就喊）

export function createAlertPolicy(opts = {}) {
  const cooldownMs = opts.cooldownMs ?? 60_000;
  const maxPerTurn = opts.maxPerTurn ?? 3;
  const seen = new Map();       // key -> 上次告警时间
  let turnCount = 0;
  let turnSuppressed = 0;

  return {
    /**
     * 是否应该真的打扰用户。
     * @param {{key: string, severity?: 'high'|'normal', nowMs?: number}} req
     * @returns {{alert: boolean, reason: string}}
     */
    shouldAlert(req) {
      const key = String(req.key || '');
      const now = req.nowMs ?? Date.now();
      const severity = req.severity || 'normal';

      if (!key)
        return { alert: false, reason: 'no-key' };

      // 高严重度不受冷却与限额限制（真正的"文件被删"不该被吞）
      if (severity === 'high') {
        turnCount += 1;
        seen.set(key, now);
        return { alert: true, reason: 'high-severity' };
      }

      const last = seen.get(key);
      if (last !== undefined && now - last < cooldownMs) {
        turnSuppressed += 1;
        return { alert: false, reason: 'cooldown' };
      }

      if (turnCount >= maxPerTurn) {
        turnSuppressed += 1;
        return { alert: false, reason: 'turn-budget' };
      }

      turnCount += 1;
      seen.set(key, now);
      return { alert: true, reason: 'ok' };
    },

    /** 每轮开始重置计数（冷却记录保留） */
    resetTurn() {
      const prev = { alerts: turnCount, suppressed: turnSuppressed };
      turnCount = 0;
      turnSuppressed = 0;
      return prev;
    },

    stats() {
      return { alertsThisTurn: turnCount, suppressedThisTurn: turnSuppressed, trackedKeys: seen.size };
    },
  };
}
