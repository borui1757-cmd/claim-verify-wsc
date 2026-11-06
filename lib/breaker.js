// breaker.js —— 电路熔断器：给"拦截"装一个自动退出的开关
//
// 问题：事前拦截（preflight）能阻止错误动作，但它也可能**误拦**，
// 一误拦会话就卡死——比漏报更糟。
//
// 解法：标准熔断器状态机（CLOSED → OPEN → HALF-OPEN）。
// 依据：agent 工程里通行的 Circuit Breaker 模式
//   （阈值 3 次连续失败 → OPEN；冷却 5 分钟 → HALF-OPEN 单次探测；
//     探测成功回 CLOSED，失败回 OPEN）。
//
// 用在这里的语义：
//   "失败" = 我们拦了一次（说明可能是我们的判据有问题 / 也可能是真拦对了）
//   连续拦 3 次 → 熔断，**自动降级为只警告**（fail-open）
//   5 分钟后放一次"试探"：如果能顺利放行，就恢复正常拦截能力
//
// 关键原则：**拦截器的默认失败方向是"放行"**，不是"拦住"。
// 因为卡死一次，用户就再也不会开它。

export const CLOSED = 'CLOSED';
export const OPEN = 'OPEN';
export const HALF_OPEN = 'HALF_OPEN';

export function createBreaker(opts = {}) {
  const threshold = opts.failureThreshold ?? 3;
  const cooldownMs = opts.cooldownMs ?? 5 * 60_000;

  let state = CLOSED;
  let failures = 0;
  let tripped = 0;
  let openedAt = 0;

  return {
    /** 当前是否允许"真正拦截"（OPEN 时不拦，只警告） */
    canBlock(nowMs = Date.now()) {
      if (state === CLOSED)
        return true;
      if (state === OPEN && nowMs - openedAt >= cooldownMs) {
        state = HALF_OPEN;
        return true; // 放一次试探
      }
      return state === HALF_OPEN;
    },

    /** 记一次"拦下"（可能误拦）。连续到阈值就熔断。 */
    recordBlock(nowMs = Date.now()) {
      failures += 1;
      if (state === HALF_OPEN) {
        // 试探期又拦了 → 回到 OPEN，重新计时
        state = OPEN;
        openedAt = nowMs;
        tripped += 1;
        return { state, reason: 'half-open 探测失败，回到 OPEN' };
      }
      if (failures >= threshold) {
        state = OPEN;
        openedAt = nowMs;
        tripped += 1;
        return { state, reason: `连续拦截 ${failures} 次，熔断（改为只警告）` };
      }
      return { state, reason: `已拦截 ${failures}/${threshold}` };
    },

    /** 记一次"放行"：探测成功 → 恢复 */
    recordPass() {
      if (state === HALF_OPEN) {
        state = CLOSED;
        failures = 0;
        return { state, reason: '探测成功，恢复拦截' };
      }
      failures = 0;
      return { state };
    },

    stats() {
      return { state, failures, tripped, openedAt };
    },
  };
}
