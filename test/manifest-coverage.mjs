// manifest-coverage.mjs —— 任务清单覆盖率的「三档口径」自测。
//
// 2026-11-07 修的 bug：0.9.x 把单源证据降级为 insufficient 之后，
// 覆盖率只认 supported，于是「做过但证据单源」的活被算成缺项 →
// 覆盖率假低、判定说「证据不全」。承诺项是否被处理过 ≠ 这条断言证据够不够强。
import { createManifest, computeCoverage, renderCoverage } from '../lib/manifest.js'

let pass = 0
let fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const ev = { callId: 'call_1', tool: 'write', resultSeen: true }
const mk = (items) => createManifest({ sessionId: 's', items })
const rec = (claims) => [{ claims }]

// ① 强证据 → PASS
const strong = mk([{ id: 'm1', desc: '写了 A', claim: { kind: 'write', target: 'C:\\a.txt' } }])
const covStrong = computeCoverage(strong, rec([
  { claim: { kind: 'write', target: 'C:\\a.txt' }, verdict: 'supported', evidence: ev },
]))
check('强证据 → covered=1, strong=1', covStrong.covered === 1 && covStrong.strong === 1, covStrong)
check('强证据 → COVERAGE_PASS', covStrong.verdict === 'COVERAGE_PASS', covStrong.verdict)

// ② 弱证据（单源）→ 有回执，但不算结案（本次修复的核心）
const covWeak = computeCoverage(strong, rec([
  { claim: { kind: 'write', target: 'C:\\a.txt' }, verdict: 'insufficient', evidence: ev, independent: 1 },
]))
check('弱证据 → 仍算覆盖（covered=1）', covWeak.covered === 1, covWeak)
check('弱证据 → weak=1, strong=0', covWeak.weak === 1 && covWeak.strong === 0, covWeak)
check('弱证据 → COVERAGE_WEAK（不是缺项，也不是 PASS）', covWeak.verdict === 'COVERAGE_WEAK', covWeak.verdict)
check('弱证据 → 不算 missing', covWeak.missing.length === 0, covWeak.missing)

// ③ 完全没回执 → INCONCLUSIVE
const covNone = computeCoverage(strong, rec([]))
check('没回执 → covered=0, missing=1', covNone.covered === 0 && covNone.missing.length === 1, covNone)
check('没回执 → INCONCLUSIVE_COVERAGE', covNone.verdict === 'INCONCLUSIVE_COVERAGE', covNone.verdict)

// ④ contradicted 不算覆盖（明确反驳）
const covBad = computeCoverage(strong, rec([
  { claim: { kind: 'write', target: 'C:\\a.txt' }, verdict: 'contradicted', evidence: ev },
]))
check('被反驳 → 不算覆盖', covBad.covered === 0 && covBad.verdict === 'INCONCLUSIVE_COVERAGE', covBad)

// ⑤ 无证据的 insufficient 也不算覆盖（没回执就是没回执）
const covGhost = computeCoverage(strong, rec([
  { claim: { kind: 'write', target: 'C:\\a.txt' }, verdict: 'insufficient', evidence: null },
]))
check('无证据的 insufficient → 不算覆盖', covGhost.covered === 0, covGhost)

// ⑥ 混合：一项强、一项弱 → 覆盖满但整体 WEAK
const mixed = mk([
  { id: 'a', desc: 'A', claim: { kind: 'write', target: 'C:\\a.txt' } },
  { id: 'b', desc: 'B', claim: { kind: 'port', value: '3080' } },
])
const covMix = computeCoverage(mixed, rec([
  { claim: { kind: 'write', target: 'C:\\a.txt' }, verdict: 'supported', evidence: ev },
  { claim: { kind: 'port', value: '3080' }, verdict: 'insufficient', evidence: ev },
]))
check('混合 → covered=2, strong=1, weak=1', covMix.covered === 2 && covMix.strong === 1 && covMix.weak === 1, covMix)
check('混合 → COVERAGE_WEAK', covMix.verdict === 'COVERAGE_WEAK', covMix.verdict)

// ⑦ 路径匹配的宽松（大小写 / 斜杠方向）
const covPath = computeCoverage(strong, rec([
  { claim: { kind: 'write', target: 'c:/A.TXT' }, verdict: 'supported', evidence: ev },
]))
check('路径忽略大小写与斜杠方向', covPath.covered === 1, covPath)

// ⑧ 空清单 → NO_MANIFEST，且不吹覆盖率
const empty = createManifest({ sessionId: 's', items: [] })
const covEmpty = computeCoverage(empty, rec([]))
check('空清单 → NO_MANIFEST', covEmpty.verdict === 'NO_MANIFEST', covEmpty.verdict)
check('空清单 → 不渲染报告', renderCoverage(covEmpty) === '')

// ⑨ 报告措辞
check('WEAK 报告说"活做了但证据不够"', /证据/.test(renderCoverage(covWeak)) && /不够|单源/.test(renderCoverage(covWeak)), renderCoverage(covWeak))
check('PASS 报告不再出现"不足"字样', !/不足/.test(renderCoverage(covStrong)), renderCoverage(covStrong))

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
