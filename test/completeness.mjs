// completeness.mjs —— 清单完备性（分母有没有被低估）自测。
import { createManifest } from '../lib/manifest.js'
import { computeCommitmentCompleteness, renderCompleteness } from '../lib/completeness.js'

let pass = 0
let fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const ev = { callId: 'call_1', tool: 'write', resultSeen: true }
const rec = (claims) => [{ claims }]
const mk = (items) => createManifest({ sessionId: 's', items })

// ① 动作全在清单里 → OK
const m1 = mk([
  { id: 'a', desc: 'A', claim: { kind: 'write', target: 'C:\\a.txt' } },
  { id: 'b', desc: 'B', claim: { kind: 'port', value: '3080' } },
])
const c1 = computeCommitmentCompleteness(m1, rec([
  { claim: { kind: 'write', target: 'C:\\a.txt' }, verdict: 'supported', evidence: ev },
  { claim: { kind: 'port', value: '3080' }, verdict: 'insufficient', evidence: ev },
]))
check('全部已发生动作都在清单 → COMPLETENESS_OK', c1.verdict === 'COMPLETENESS_OK', c1)
check('全部在清单 → completeness=1', c1.completeness === 1, c1.completeness)
check('全部在清单 → 没有未承诺动作', c1.uncommitted.length === 0, c1.uncommitted)

// ② 有一个动作没进清单 → 分母被低估
const m2 = mk([{ id: 'a', desc: 'A', claim: { kind: 'write', target: 'C:\\a.txt' } }])
const c2 = computeCommitmentCompleteness(m2, rec([
  { claim: { kind: 'write', target: 'C:\\a.txt' }, verdict: 'supported', evidence: ev },
  { claim: { kind: 'write', target: 'C:\\b.txt' }, verdict: 'supported', evidence: ev },
]))
check('漏一项 → UNCOMMITTED_ACTIONS', c2.verdict === 'UNCOMMITTED_ACTIONS', c2)
check('漏一项 → uncommitted=1', c2.uncommitted.length === 1, c2.uncommitted)
check('漏一项 → completeness=1/2', Math.abs(c2.completeness - 0.5) < 1e-9, c2.completeness)
check('报告说清"分母被低估"', /分母被低估/.test(renderCompleteness(c2)), renderCompleteness(c2))

// ③ 无证据的 claim 不算"已发生的可核验动作"
const c3 = computeCommitmentCompleteness(m2, rec([
  { claim: { kind: 'write', target: 'C:\\c.txt' }, verdict: 'insufficient', evidence: null },
]))
check('无回执证据的动作不计入分母', c3.uncommitted.length === 0, c3.uncommitted)

// ④ 被反驳的不算做成的活
const c4 = computeCommitmentCompleteness(m2, rec([
  { claim: { kind: 'write', target: 'C:\\d.txt' }, verdict: 'contradicted', evidence: ev },
]))
check('被反驳的动作不计入未承诺', c4.uncommitted.length === 0, c4.uncommitted)

// ⑤ 同一动作重复出现只算一次
const c5 = computeCommitmentCompleteness(m2, rec([
  { claim: { kind: 'write', target: 'C:\\b.txt' }, verdict: 'supported', evidence: ev },
  { claim: { kind: 'write', target: 'C:\\b.txt' }, verdict: 'supported', evidence: ev },
]))
check('同一动作重复只算一次', c5.uncommitted.length === 1, c5.uncommitted)

// ⑥ 空清单 → NO_MANIFEST，不吹完备性
const c6 = computeCommitmentCompleteness(createManifest({ sessionId: 's', items: [] }), rec([
  { claim: { kind: 'write', target: 'C:\\a.txt' }, verdict: 'supported', evidence: ev },
]))
check('空清单 → NO_MANIFEST', c6.verdict === 'NO_MANIFEST', c6.verdict)
check('空清单 → 不渲染报告', renderCompleteness(c6) === '')

// ⑦ 边界如实写进输出
check('输出带边界说明（只能发现做了没承诺）', /不可观测/.test(c1.boundary), c1.boundary)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
