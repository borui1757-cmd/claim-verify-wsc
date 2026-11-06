// 三层扩展的合并测试：角色建模 / 跨消息时序 / 多约束求解
import { resolveConflict, annotateByRole, ROLE } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/roles.js'
import { classifyTemporal, findTemporalIssues } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/temporal-reasoning.js'
import { minimumDropSet } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/solve.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

// ── ③ 角色建模 ──
const tool = { role: ROLE.TOOL, kind: 'path', value: 'a' }
const model = { role: ROLE.MODEL, kind: 'path', value: 'b' }
const r1 = resolveConflict(tool, model)
check('工具 vs 模型 → 采信工具', r1.verdict === 'reject-loser' && r1.winner === tool, r1)
check('理由可读', /优先/.test(r1.reason), r1.reason)

const r2 = resolveConflict({ role: ROLE.TOOL, value: 1 }, { role: ROLE.TOOL, value: 2 })
check('工具 vs 工具 → 不下结论', r2.verdict === 'inconclusive', r2)

const r3 = resolveConflict({ role: ROLE.MODEL, value: 1 }, { role: ROLE.MODEL, value: 2 })
check('模型 vs 模型 → uncertain', r3.verdict === 'uncertain', r3)

const ann = annotateByRole([tool, model, { role: ROLE.DOC }])
check('工具=authoritative', ann[0].trust === 'authoritative', ann[0])
check('模型=to-verify', ann[1].trust === 'to-verify', ann[1])
check('文档=reference', ann[2].trust === 'reference', ann[2])

// ── ④ 跨消息时序 ──
const T0 = 1_700_000_000_000
const near = classifyTemporal(
  { claim: { kind: 'path', value: 'a.txt' }, at: T0 },
  { claim: { kind: 'path', value: 'a.txt' }, at: T0 + 2000 },
)
check('同一时刻冲突 → contradiction', near.kind === 'contradiction', near)

const evolved = classifyTemporal(
  { claim: { kind: 'path', value: 'C:\\a.txt' }, at: T0 },
  { claim: { kind: 'path', value: 'C:\\a.txt' }, at: T0 + 3600_000 },
  [{ at: T0 + 1000, path: 'C:\\a.txt', op: 'delete' }],
)
check('中间有删除 → evolution', evolved.kind === 'evolution', evolved)

const susp = classifyTemporal(
  { claim: { kind: 'lines', value: { path: 'C:\\a.txt', n: 3 } }, at: T0 },
  { claim: { kind: 'lines', value: { path: 'C:\\a.txt', n: 5 } }, at: T0 + 600_000 },
  [],
)
check('无变化证据 → suspicious', susp.kind === 'suspicious', susp)

const issues = findTemporalIssues([
  { claim: { kind: 'lines', value: { path: 'C:\\a.txt', n: 3 } }, at: T0 },
  { claim: { kind: 'lines', value: { path: 'C:\\a.txt', n: 5 } }, at: T0 + 600_000 },
], [])
check('批量检出一条可疑', issues.length === 1 && issues[0].kind === 'suspicious', issues.length)

// ── ⑤ 多约束求解 ──
const P = 'C:\\data\\a.txt'
const claims = [
  { kind: 'lines', value: { path: P, n: 3 } },
  { kind: 'lines', value: { path: P, n: 5 } },
  { kind: 'lines', value: { path: P, n: 7 } },
]
const sol = minimumDropSet(claims)
check('3 条互斥 → 最少否定 2 条', sol.size === 2, sol)
check('被否定的 2 条之外还剩 1 条', sol.toDrop.length === 2, sol.toDrop.length)

const ok = minimumDropSet([
  { kind: 'lines', value: { path: P, n: 3 } },
  { kind: 'path', value: P },
])
check('本来就一致 → 否定 0 条', ok.size === 0, ok)

const single = minimumDropSet([
  { kind: 'path', value: P, polarity: 'pos' },
  { kind: 'path', value: P, polarity: 'neg' },
])
check('一正一负 → 否定 1 条', single.size === 1, single)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
