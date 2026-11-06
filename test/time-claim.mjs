// 时间断言：真值是"消息生成时刻"，不是"核验时刻"。
// 这里固定住行为，防止再次被"降 soft"糊过去。
import { extractClaims, verifyClaims, buildNote } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/index.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const CFG = { portTimeoutMs: 300, moneyTolerance: 0.15 }

// 造一个"生成时刻"= 2026-11-07 01:31 的基准
const at0131 = new Date('2026-11-07T01:31:00+08:00').getTime()

async function checkTime(text, nowMs) {
  const claims = extractClaims(text).filter((c) => c.kind === 'time')
  if (!claims.length)
    return { extracted: false }
  const res = await verifyClaims(claims, 'time-test', CFG, { nowMs })
  return { extracted: true, bad: res.bad.length, soft: res.bad.some((b) => b.soft), expect: res.bad[0] && res.bad[0].expect }
}

// 1) 说错了 9 分钟 → 必须判错，且**不能是 soft**
const wrong = await checkTime('现在是 01:40。', at0131)
check('抽到时间断言', wrong.extracted === true, wrong)
check('说错 9 分钟被判错', wrong.bad === 1, wrong)
check('不再是 soft（会真的进核验）', wrong.soft === false, wrong)

// 2) 说对了 → 不报
const right = await checkTime('现在是 01:31。', at0131)
check('说对了不报', right.bad === 0, right)

// 3) 差 3 分钟（生成→核验的正常延迟）→ 不报
const close = await checkTime('现在是 01:34。', at0131)
check('3 分钟偏差容忍', close.bad === 0, close)

// 4) 差 6 分钟 → 报（超过 5 分钟容差）
const far = await checkTime('现在是 01:37。', at0131)
check('6 分钟偏差被判错', far.bad === 1, far)

// 5) buildNote 里 time 不再被过滤
const fake = { checked: 1, bad: [{ claim: { kind: 'time', value: { hour: 1, minute: 40 } }, expect: '现在是 01:31' }] }
check('buildNote 会显示时间不符', buildNote(fake).includes('时间'), buildNote(fake).slice(0, 40))

// 6) date 仍然静音（跨零点保护）
const fakeDate = { checked: 1, bad: [{ claim: { kind: 'date', value: { month: 11, day: 6 } }, expect: '今天是 11 月 7 日', soft: true }] }
check('date 仍不进核验', buildNote(fakeDate) === '')

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
