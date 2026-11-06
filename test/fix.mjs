import { fixText, correctionLine } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/fix.js'
import { extractProgramClaims } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/extra.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const NOW = new Date('2026-11-07T04:30:00+08:00').getTime()

// ① 算术错 → 直接改正
const t1 = '先算一下：12 × 12 = 143。'
let r = await fixText(t1, { claims: extractProgramClaims(t1), nowMs: NOW })
check('算术被更正', r.text.includes('144') && !r.text.includes('143'), r)
check('记录了更正明细', r.fixed.length === 1 && r.fixed[0].kind === 'math', r.fixed)

// ② 算术对 → 不动
const t2 = '12 × 12 = 144。'
r = await fixText(t2, { claims: extractProgramClaims(t2), nowMs: NOW })
check('正确的算术不动', r.text === t2 && r.fixed.length === 0, r)

// ③ 时间错 → 替换成真实时间
const t3 = '现在是 03:40。'
r = await fixText(t3, { claims: extractProgramClaims(t3), nowMs: NOW })
check('时间被更正为 04:30', r.text.includes('04:30'), r)
check('没有重复前缀', !r.text.includes('现在是 现在是'), r)

// ④ 时间对 → 不动
const t4 = '现在是 04:30。'
r = await fixText(t4, { claims: extractProgramClaims(t4), nowMs: NOW })
check('正确时间不动', r.text === t4 && r.fixed.length === 0, r)

// ⑤ 除法
const t5 = '10 除以 4 = 2.5。'
r = await fixText(t5, { claims: extractProgramClaims(t5), nowMs: NOW })
check('正确除法不动', r.fixed.length === 0, r)

const t6 = '10 除以 4 = 3。'
r = await fixText(t6, { claims: extractProgramClaims(t6), nowMs: NOW })
check('错误除法被更正', r.fixed.length === 1 && r.text.includes('2.5'), r)

// ⑥ correctionLine
const [c1] = extractProgramClaims('12 × 12 = 143。')
const line = await correctionLine(c1, { nowMs: NOW })
check('更正行含【更正】', line.includes('【更正】'), line)
check('更正行含正确值', line.includes('144'), line)

const [c2] = extractProgramClaims('12 × 12 = 144。')
check('对的没有更正行', (await correctionLine(c2, { nowMs: NOW })) === '')

// ⑦ 无法判断的（引用/示例）不应更正
const t7 = '比如 `12 × 12 = 143` 这种错。'
r = await fixText(t7, { claims: extractProgramClaims(t7), nowMs: NOW })
check('引用的不更正', r.fixed.length === 0, r)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
