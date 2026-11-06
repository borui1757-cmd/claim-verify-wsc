import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeTaskAcceptTool, expandRubric, TASK_TOOL_AVAILABLE } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/rubric-tool.js'
import { verifyClaims } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/index.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-task-'))
const real = path.join(dir, 'report.md')
fs.writeFileSync(real, '# 报告\n')
const fake = path.join(dir, 'missing.md')

// ── expandRubric ──
const e1 = expandRubric({ id: 'a1', criterion: 'x', evidence: [{ kind: 'path', value: real, expect: 'exists' }] })
check('path 证据展开', e1.claims.length === 1 && e1.kinds[0] === 'path', e1.kinds)

const e2 = expandRubric({ id: 'a2', criterion: 'x', evidence: [{ kind: 'port', value: '3210', expect: 'listening' }] })
check('port 值转数字', e2.claims[0].value === 3210, e2.claims[0].value)

const e3 = expandRubric({ id: 'a3', criterion: 'x', evidence: [{ kind: 'filecount', value: '{"dir":"C:/x","n":3}', expect: 'exists' }] })
check('filecount JSON 解析', e3.claims[0].value && e3.claims[0].value.n === 3, e3.claims[0].value)

const e4 = expandRubric({ id: 'a4', criterion: 'x', evidence: [{ kind: 'unknown_kind', value: 'y' }] })
check('未知证据类型被跳过', e4.claims.length === 0)

const e5 = expandRubric({ id: 'a5', criterion: 'x', role: 'theory' })
check('role 保留', e5.role === 'theory')

// ── 工具端到端 ──
check('工具可用（宿主外也能构造）', TASK_TOOL_AVAILABLE === true)
const tool = makeTaskAcceptTool({ verifyClaims, cfg: { portTimeoutMs: 300 } })
check('工具已构造', Boolean(tool))

const allPass = await tool.execute({ rubrics: [
  { id: 'p1', criterion: '报告存在', evidence: [{ kind: 'path', value: real, expect: 'exists' }] },
] })
check('全通过 → PASS', allPass.verdict === 'PASS', allPass)
check('全通过满 100 分', allPass.score === 100, allPass.score)

const oneFail = await tool.execute({ rubrics: [
  { id: 'p1', criterion: '报告存在', evidence: [{ kind: 'path', value: real, expect: 'exists' }] },
  { id: 'p2', criterion: '缺的文件也存在', evidence: [{ kind: 'path', value: fake, expect: 'exists' }] },
] })
check('有失败 → INVALID', oneFail.verdict === 'INVALID', oneFail.verdict)
check('评分 50', oneFail.score === 50, oneFail.score)

const theoryFails = await tool.execute({ rubrics: [
  { id: 'p1', criterion: '报告存在', evidence: [{ kind: 'path', value: real, expect: 'exists' }] },
  { id: 't1', criterion: '理论题', role: 'theory' },
] })
check('theory 不阻断 → PASS', theoryFails.verdict === 'PASS', theoryFails.verdict)
check('theory 不进评分分母', theoryFails.score === 100, theoryFails.score)

const noEvidence = await tool.execute({ rubrics: [
  { id: 'n1', criterion: '没有任何证据', role: 'acceptance' },
] })
check('无证据 → INCONCLUSIVE', noEvidence.verdict === 'INCONCLUSIVE', noEvidence.verdict)

const empty = await tool.execute({ rubrics: [] })
check('空列表 → INCONCLUSIVE', empty.verdict === 'INCONCLUSIVE' && empty.results.length === 0, empty)

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
