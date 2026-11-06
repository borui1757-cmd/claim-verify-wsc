import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createManifest, computeCoverage, saveManifest, loadLatestManifest, renderCoverage } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/manifest.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-man-'))
const file = path.join(dir, 'manifests.jsonl')

// ① 建清单：哈希稳定
const items = [
  { id: 'm1', desc: '生成报告', claim: { kind: 'path', value: 'C:\\out\\report.md' } },
  { id: 'm2', desc: '端口在听', claim: { kind: 'port', value: '3080' } },
  { id: 'm3', desc: '版本更新', claim: { kind: 'pkgversion', value: '0.9.53' } },
]
const m1 = createManifest({ sessionId: 's1', title: '发版', items })
const m2 = createManifest({ sessionId: 's1', title: '发版', items })
check('同输入 → 同摘要', m1.digest === m2.digest, [m1.digest, m2.digest])
check('清单有 3 项', m1.items.length === 3)
check('摘要 64 位', /^[0-9a-f]{64}$/.test(m1.digest))

// ② 全覆盖
const receiptsFull = [
  { claims: [{ claim: { kind: 'path', value: 'c:/out/report.md' }, verdict: 'supported' }] },
  { claims: [{ claim: { kind: 'port', value: '3080' }, verdict: 'supported' }] },
  { claims: [{ claim: { kind: 'pkgversion', value: '0.9.53' }, verdict: 'supported' }] },
]
const cov1 = computeCoverage(m1, receiptsFull)
check('全覆盖 → COVERAGE_PASS', cov1.verdict === 'COVERAGE_PASS', cov1)
check('覆盖率 1.0', cov1.coverage === 1)

// ③ 缺一项 → INCONCLUSIVE_COVERAGE
const cov2 = computeCoverage(m1, receiptsFull.slice(0, 2))
check('缺一项 → INCONCLUSIVE_COVERAGE', cov2.verdict === 'INCONCLUSIVE_COVERAGE', cov2)
check('缺的是 m3', cov2.missing[0] && cov2.missing[0].id === 'm3', cov2.missing)
check('覆盖率 2/3', Math.abs(cov2.coverage - 2 / 3) < 1e-9)

// ④ verdict 不是 supported 的不算覆盖
const cov3 = computeCoverage(m1, [
  { claims: [{ claim: { kind: 'path', value: 'C:\\out\\report.md' }, verdict: 'contradicted' }] },
])
check('contradicted 不算覆盖', cov3.covered === 0, cov3)

// ⑤ 路径大小写/斜杠宽松匹配
const cov4 = computeCoverage(m1, [{ claims: [{ claim: { kind: 'path', value: 'c:\\out\\report.md' }, verdict: 'supported' }] }])
check('路径宽松匹配', cov4.covered === 1, cov4)

// ⑥ 存/读
saveManifest(file, m1)
saveManifest(file, createManifest({ sessionId: 's2', items: [{ desc: 'x' }] }))
const back = loadLatestManifest(file, 's1')
check('能读回 s1 的清单', back && back.digest === m1.digest, back && back.title)
check('没有清单时返回 null', loadLatestManifest(path.join(dir, 'nope.jsonl'), 's1') === null)

// ⑦ 空清单
const cov5 = computeCoverage(createManifest({ items: [] }), [])
check('空清单 → NO_MANIFEST', cov5.verdict === 'NO_MANIFEST', cov5)
check('空清单不渲染', renderCoverage(cov5) === '')

// ⑧ 渲染
check('通过文案含【覆盖率】', renderCoverage(cov1).includes('【覆盖率】'), renderCoverage(cov1))
check('不足文案含【覆盖率不足】', renderCoverage(cov2).includes('【覆盖率不足】'), renderCoverage(cov2))

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
