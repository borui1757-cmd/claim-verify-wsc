import { createBreaker, CLOSED, OPEN, HALF_OPEN } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/breaker.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const t0 = 1_000_000

// ① 正常可拦
let b = createBreaker({ failureThreshold: 3, cooldownMs: 1000 })
check('初始可拦截', b.canBlock(t0) === true && b.stats().state === CLOSED)

// ② 拦 2 次还不熔断
b.recordBlock(t0); b.recordBlock(t0)
check('拦 2 次仍 CLOSED', b.stats().state === CLOSED, b.stats())

// ③ 第 3 次熔断
const r3 = b.recordBlock(t0)
check('拦 3 次熔断 OPEN', r3.state === OPEN, r3)
check('熔断后不允许拦', b.canBlock(t0 + 10) === false)

// ④ 冷却后进入 HALF_OPEN，允许试探一次
check('冷却后可试探', b.canBlock(t0 + 2000) === true)
check('状态变 HALF_OPEN', b.stats().state === HALF_OPEN, b.stats())

// ⑤ 试探成功 → 恢复 CLOSED
b.recordPass()
check('试探成功回 CLOSED', b.stats().state === CLOSED, b.stats())
check('恢复后失败计数清零', b.stats().failures === 0)

// ⑥ 试探期又拦 → 回 OPEN
let b2 = createBreaker({ failureThreshold: 2, cooldownMs: 1000 })
b2.recordBlock(t0); b2.recordBlock(t0)      // → OPEN
b2.canBlock(t0 + 2000)                       // → HALF_OPEN
const r6 = b2.recordBlock(t0 + 2000)
check('试探期再拦 → 回 OPEN', r6.state === OPEN, r6)

// ⑦ 放行会清零连续计数
let b3 = createBreaker({ failureThreshold: 3 })
b3.recordBlock(t0); b3.recordPass(); b3.recordBlock(t0)
check('放行清零计数', b3.stats().failures === 1, b3.stats())

// ⑧ 熔断次数统计
check('记录了熔断次数', b.stats().tripped >= 1, b.stats())

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
