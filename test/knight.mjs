import { findMinimalConflicts, deriveFromKnown } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/knight.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const P = 'C:\\data\\a.txt'

// ── ① 最小矛盾集 ──
// 5 条断言：同文件 3 个不同行数（互相矛盾），另有 2 条别的文件
const many = [
  { kind: 'lines', value: { path: P, n: 3 } },
  { kind: 'lines', value: { path: P, n: 5 } },
  { kind: 'lines', value: { path: P, n: 7 } },
  { kind: 'lines', value: { path: 'C:\\data\\b.txt', n: 1 } },
  { kind: 'path', value: 'C:\\data\\c.txt' },
]
const mus = findMinimalConflicts(many)
check('检出矛盾组', mus.length === 1, mus.length)
check('最小集只有 2 条（不是 3 条全给）', mus[0] && mus[0].length === 2, mus[0] && mus[0].length)

// 没有矛盾时不报
check('一致时不报', findMinimalConflicts([
  { kind: 'lines', value: { path: P, n: 3 } },
  { kind: 'path', value: P },
]).length === 0)

// ── ② 传递推理：已知为真 → 同键不同值必假 ──
const all = [
  { kind: 'lines', value: { path: P, n: 3 } },
  { kind: 'lines', value: { path: P, n: 5 } },
]
const knownTrue = [{ kind: 'lines', value: { path: P, n: 3 } }]
const derived = deriveFromKnown(all, knownTrue)
check('同键不同值被推出为假', derived.length === 1, derived)
check('推出的是 n=5 那条', derived[0] && derived[0].claim.value.n === 5, derived[0] && derived[0].claim.value)
check('理由可读', /已被证实/.test(derived[0] && derived[0].reason), derived[0] && derived[0].reason)

// 值相同时不推
check('值相同不推', deriveFromKnown([{ kind: 'lines', value: { path: P, n: 3 } }], knownTrue).length === 0)

// ── ③ 量级约束：行数 > 字节数 ──
const bound = deriveFromKnown([
  { kind: 'lines', value: { path: P, n: 8 } },
  { kind: 'size', value: { path: P, bytes: 5 } },
], [])
check('8 行但只有 5 字节 → 必假', bound.length === 1 && /每行至少/.test(bound[0].reason), bound)

// 合理量级不推
check('3 行 30 字节 → 不推', deriveFromKnown([
  { kind: 'lines', value: { path: P, n: 3 } },
  { kind: 'size', value: { path: P, bytes: 30 } },
], []).length === 0)

// ── ④ 不同对象互不影响 ──
const crossObj = deriveFromKnown([
  { kind: 'lines', value: { path: 'C:\\a.txt', n: 9 } },
], [{ kind: 'lines', value: { path: 'C:\\b.txt', n: 3 } }])
check('不同文件不传播', crossObj.length === 0, crossObj)

// ── ⑤ 空输入 ──
check('空断言不报', findMinimalConflicts([]).length === 0)
check('空已知不推', deriveFromKnown(all, []).length === 0)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
