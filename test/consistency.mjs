import { findContradictions, summarizeContradictions } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/consistency.js'
import { extractClaims } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/index.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const P = 'C:\\data\\a.txt'

// ① 同一文件给了两个行数
const c1 = [
  { kind: 'lines', value: { path: P, n: 3 }, polarity: 'pos' },
  { kind: 'lines', value: { path: P, n: 5 }, polarity: 'pos' },
]
const r1 = findContradictions(c1)
check('同文件两个行数 → 矛盾', r1.length === 1 && r1[0].kind === 'lines', r1)

// ② 存在且不存在
const c2 = [
  { kind: 'path', value: P, polarity: 'pos' },
  { kind: 'path', value: P, polarity: 'neg' },
]
check('存在 + 不存在 → 矛盾', findContradictions(c2).length === 1)

// ③ 行数 > 字节数
const c3 = [
  { kind: 'lines', value: { path: P, n: 8 }, polarity: 'pos' },
  { kind: 'size', value: { path: P, bytes: 5 }, polarity: 'pos' },
]
const r3 = findContradictions(c3)
check('8 行但只有 5 字节 → 矛盾', r3.length === 1 && r3[0].reason.includes('每行至少'), r3)

// ④ 端口既在听又没听
const c4 = [
  { kind: 'port', value: 3210, polarity: 'pos' },
  { kind: 'port', value: 3210, polarity: 'neg' },
]
check('端口肯定+否定 → 矛盾', findContradictions(c4).length === 1)

// ⑤ 一致的多条不该误报
const c5 = [
  { kind: 'lines', value: { path: P, n: 3 }, polarity: 'pos' },
  { kind: 'size', value: { path: P, bytes: 30 }, polarity: 'pos' },
  { kind: 'path', value: P, polarity: 'pos' },
]
check('一致的多条 → 无矛盾', findContradictions(c5).length === 0)

// ⑥ 不同对象各自的值不算矛盾
const c6 = [
  { kind: 'lines', value: { path: 'C:\\a.txt', n: 3 }, polarity: 'pos' },
  { kind: 'lines', value: { path: 'C:\\b.txt', n: 5 }, polarity: 'pos' },
]
check('不同文件不同行数 → 无矛盾', findContradictions(c6).length === 0)

// ⑦ 端到端：从一段话里抽出来再查
const text = `文件 \`${P}\` 有 3 行。文件 \`${P}\` 有 5 行。`
const cs = extractClaims(text).filter((c) => c.kind === 'lines')
check('抽取到两条 lines', cs.length === 2, cs.length)
check('端到端查出矛盾', findContradictions(cs).length >= 1)

// ⑧ 摘要可读
const s = summarizeContradictions(r1)
check('摘要含【自相矛盾】', s.includes('【自相矛盾】'))
check('摘要提到至少一条', s.includes('至少有一条是假的'))

// ⑨ 空输入
check('空列表无矛盾', findContradictions([]).length === 0)
check('空摘要为空串', summarizeContradictions([]) === '')

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
