import {
  normalizeRubric, evidencePrecheck, hardEvidence, evaluateTask, summarizeTask,
  EVIDENCE_KINDS, OPTIONAL_EVIDENCE, ROLES,
} from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/rubric.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}
function throws(fn) { try { fn(); return false } catch { return true } }

// ── 规范化：非法直接拒绝（避免"字段存在但不生效"）──
check('缺少 id 被拒', throws(() => normalizeRubric({ criterion: 'x' })))
check('缺少 criterion 被拒', throws(() => normalizeRubric({ id: 'a' })))
check('未知证据类型被拒', throws(() => normalizeRubric({ id: 'a', criterion: 'x', required_evidence: ['coded'] })))
check('负 weight 被拒', throws(() => normalizeRubric({ id: 'a', criterion: 'x', weight: -1 })))

const r1 = normalizeRubric({ id: 'rb1', criterion: '报告已生成', required_evidence: ['path', 'filecount'], weight: 2 })
check('合法 rubric 默认 acceptance', r1.role === 'acceptance')
check('weight 保留', r1.weight === 2)
check('硬门槛剔除可选类型', (() => {
  const r = normalizeRubric({ id: 'rb2', criterion: 'x', required_evidence: ['path', 'report'] })
  return hardEvidence(r).join(',') === 'path'
})())

// ── 证据预检 ──
check('证据齐 → 可评审', evidencePrecheck(r1, ['path', 'filecount']).passable === true)
const pre = evidencePrecheck(r1, ['path'])
check('缺证据 → 拦截', pre.passable === false && pre.missing[0] === 'filecount', pre)
check('可选证据缺失不拦截', evidencePrecheck(normalizeRubric({ id: 'r3', criterion: 'x', required_evidence: ['report'] }), []).passable === true)
check('theory 角色不因缺证据被拦', evidencePrecheck(normalizeRubric({ id: 'r4', criterion: 'x', role: 'theory', required_evidence: ['path'] }), []).passable === true)

// ── 任务评估：证据缺失 → INCONCLUSIVE ──
const rubrics = [
  { id: 'a1', criterion: '文件已写入', required_evidence: ['path'], weight: 2 },
  { id: 'a2', criterion: '端口在听', required_evidence: ['port'], weight: 1 },
]
const missingPort = await evaluateTask({ rubrics, available: ['path'], judge: () => ({ ok: true }) })
check('缺证据整体 INCONCLUSIVE', missingPort.verdict === 'INCONCLUSIVE', missingPort.verdict)
check('缺证据进 forced', missingPort.forced.length === 1 && missingPort.forced[0].missing[0] === 'port', missingPort.forced)

// ── 证据齐 + 全通过 → PASS ──
const allPass = await evaluateTask({ rubrics, available: ['path', 'port'], judge: () => ({ ok: true }) })
check('全部通过 → PASS', allPass.verdict === 'PASS', allPass.verdict)
check('满分 100', allPass.score === 100, allPass.score)

// ── 有失败 → INVALID ──
const oneFail = await evaluateTask({
  rubrics, available: ['path', 'port'],
  judge: (r) => (r.id === 'a2' ? { ok: false, detail: '端口没监听' } : { ok: true }),
})
check('有失败 → INVALID', oneFail.verdict === 'INVALID', oneFail.verdict)
check('评分按权重算（2/3 → 67）', oneFail.score === 67, oneFail.score)

// ── theory 失败不阻断，进 gaps ──
const withTheory = await evaluateTask({
  rubrics: [...rubrics, { id: 't1', criterion: '理论题', role: 'theory', weight: 5 }],
  available: ['path', 'port'],
  judge: (r) => (r.id === 't1' ? { ok: false, detail: '答错' } : { ok: true }),
})
check('theory 失败不阻断 → PASS', withTheory.verdict === 'PASS', withTheory.verdict)
check('theory 失败进 gaps', withTheory.gaps.length === 1, withTheory.gaps)
check('theory 不计入评分分母', withTheory.score === 100, withTheory.score)

// ── 证据齐但没有判定器 → 不能算通过 ──
const noJudge = await evaluateTask({ rubrics: [rubrics[0]], available: ['path'] })
check('无判定器 → INCONCLUSIVE', noJudge.verdict === 'INCONCLUSIVE', noJudge.verdict)
check('无判定器进 forced', noJudge.forced.length === 1, noJudge.forced)

// ── 摘要 ──
check('摘要含结论与评分', /验收 PASS/.test(summarizeTask(allPass)), summarizeTask(allPass))
check('失败摘要列出条目', /未通过: a2/.test(summarizeTask(oneFail)), summarizeTask(oneFail))

// ── 常量表完整 ──
check('证据类型含 19 类原语的代表', ['path', 'port', 'hash', 'filecount'].every((k) => EVIDENCE_KINDS.includes(k)))
check('可选证据含 report', OPTIONAL_EVIDENCE.includes('report'))
check('角色三种', ROLES.length === 3)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
