// vagueness.mjs —— 模糊词区间化自测（FUTURE-IDEAS #1 的回归）
//
// 核心断言：模糊说法翻成**有方向的区间**，不再用对称容差替它开脱。
//   「2:40 多」→ [02:40, 02:50)，02:36 必须判"不在区间内"。
import { timeIntervalOf, countIntervalOf, inWindow, timeWindow, isPoint } from '../lib/vagueness.js'

let pass = 0
let fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const mins = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// ── 时间：24 小时的区间方向 ──
const more = timeIntervalOf('2:40 多')
check('「2:40 多」→ [02:40, 02:50)', more && more.from === '02:40' && more.to === '02:50', more)
check('「2:40 多」在 02:36 → 不在区间（旧容差法会误判 supported）', inWindow(mins('02:36'), mins(more.from), mins(more.to)) === false)
check('「2:40 多」在 02:45 → 在区间', inWindow(mins('02:45'), mins(more.from), mins(more.to)) === true)

const less = timeIntervalOf('将近 2:40')
check('「将近 2:40」→ [02:30, 02:40)', less && less.from === '02:30' && less.to === '02:40', less)
check('「将近 2:40」在 02:45 → 不在区间', inWindow(mins('02:45'), mins(less.from), mins(less.to)) === false)

const around = timeIntervalOf('约 2:40')
check('「约 2:40」→ [02:35, 02:45)', around && around.from === '02:35' && around.to === '02:45', around)
check('「约 2:40」在 02:36 → 在区间', inWindow(mins('02:36'), mins(around.from), mins(around.to)) === true)

const exact = timeIntervalOf('2:40')
check('「2:40」（无模糊词）→ [02:40, 02:41)', exact && exact.from === '02:40' && exact.to === '02:41', exact)

check('「差不多两点」没分钟 → 翻不出区间（insufficient）', timeIntervalOf('差不多两点') === null)
check('中文冒号也能识别', Boolean(timeIntervalOf('2：40 多')))

// ── 跨零点 ──
const wrap = timeWindow(mins('23:58'), { before: 5, after: 0 })
check('「将近 23:58」跨零点 → from 23:53 to 23:58', wrap.from === '23:53' && wrap.to === '23:58', wrap)
check('跨零点窗口：昨天 23:59 落在 [23:53,23:58) → 不在', inWindow(mins('23:59'), wrap.fromMin, wrap.toMin) === false)
const wrap2 = timeWindow(mins('23:58'), { before: 0, after: 10 }) // [23:58, 00:08)
check('跨零点窗口：[23:58,00:08) 里 00:03 算在', inWindow(mins('00:03'), wrap2.fromMin, wrap2.toMin) === true)
check('跨零点窗口：[23:58,00:08) 里 23:50 算不在', inWindow(mins('23:50'), wrap2.fromMin, wrap2.toMin) === false)

// ── 数量：整数语境不放大 ──
const cAround = countIntervalOf(3, '约 3 个文件')
check('「约 3 个」→ 就是 3（不是 2~4）', cAround && isPoint(cAround) && cAround.from === 3 && cAround.to === 3, cAround)

const cMore = countIntervalOf(3, '3 个多')
check('「3 个多」→ 4 以上', cMore && cMore.from === 4 && cMore.to > 4, cMore)

const cAtLeast = countIntervalOf(3, '至少 3 个')
check('「至少 3 个」→ [3, ∞)', cAtLeast && cAtLeast.from === 3, cAtLeast)

const cLess = countIntervalOf(3, '不到 3 个')
check('「不到 3 个」→ [0, 2]', cLess && cLess.from === 0 && cLess.to === 2, cLess)

const cAtMost = countIntervalOf(3, '最多 3 个')
check('「最多 3 个」→ [0, 3]', cAtMost && cAtMost.from === 0 && cAtMost.to === 3, cAtMost)

check('非法数量 → null', countIntervalOf(-1, '约 3 个') === null)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
