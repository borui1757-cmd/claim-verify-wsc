// revision-advice.mjs —— 修订层消费端：把「认了没改 / 改了没认」变成下一轮的点名。
// 关键约束：带 claimId（可复核）、每轮最多一条、同一 claimId 只提一次、只看最近 N 条。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { adviseFromRevisions } from '../lib/revision-advice.js'
import { REVISIONS_FILE, SHADOW_FILE } from '../lib/revision-log.js'

let pass = 0
let fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-adv-'))
const mkdir = (n) => {
  const d = path.join(tmp, n)
  fs.mkdirSync(d, { recursive: true })
  return d
}
const row = (o) => JSON.stringify({ schema: 'revision/v2', shadow: true, usable_for_verdict: false, ...o })

// ① 空目录：不该凭空产生提示
const d1 = mkdir('empty')
const a1 = adviseFromRevisions(d1)
check('空目录 → 0 条提示', a1.lines.length === 0, a1.lines)

// ② 认了没改
const d2 = mkdir('ackOnly')
fs.writeFileSync(path.join(d2, SHADOW_FILE), row({
  claimId: 'c-ack', ack: 'admitted',
  action: { type: 'write', ok: false }, evidence: { tool: 'write', callId: 'k1' },
}) + '\n')
const a2 = adviseFromRevisions(d2)
check('认了没改 → 1 条提示', a2.lines.length === 1, a2.lines)
check('提示里点名 claim（可复核）', a2.lines[0].includes('c-ack'), a2.lines[0])
check('提示说清是"只认不改"', /只认不改/.test(a2.lines[0]), a2.lines[0])
check('计数：ackOnly=1', a2.counts.ackOnly === 1, a2.counts)

// ③ 改了没认
const d3 = mkdir('actOnly')
fs.writeFileSync(path.join(d3, SHADOW_FILE), row({
  claimId: 'c-act', ack: 'denied',
  action: { type: 'write', ok: true }, evidence: { tool: 'write', callId: 'k2' },
}) + '\n')
const a3 = adviseFromRevisions(d3)
check('改了没认 → 1 条提示', a3.lines.length === 1, a3.lines)
check('提示说清是"没认账"', /没有认账/.test(a3.lines[0]), a3.lines[0])

// ④ 正常原子记录 → 不该有提示
const d4 = mkdir('clean')
fs.writeFileSync(path.join(d4, REVISIONS_FILE), JSON.stringify({
  schema: 'revision/v2', txid: 't9', claimId: 'c-ok', ack: 'admitted',
  action: { type: 'write', ok: true }, evidence: { tool: 'write', callId: 'k3' },
  tAction: '2026-11-07T03:00:00.000Z', tClaim: '2026-11-07T03:00:05.000Z', tVerify: '2026-11-07T03:00:09.000Z',
}) + '\n')
const a4 = adviseFromRevisions(d4)
check('全是原子修订 → 0 条提示', a4.lines.length === 0, a4.lines)
check('计数：atomic=1', a4.counts.atomic === 1, a4.counts)

// ⑤ 同一 claimId 重复 → 只提醒一次
const d5 = mkdir('dedupe')
const dup = row({ claimId: 'c-dup', ack: 'admitted', action: { type: 'write', ok: false }, evidence: { tool: 'write', callId: 'k4' } })
fs.writeFileSync(path.join(d5, SHADOW_FILE), [dup, dup, dup].join('\n') + '\n')
const a5 = adviseFromRevisions(d5)
check('同一 claimId 连记 3 次 → 只 1 条提示', a5.lines.length === 1 && a5.counts.ackOnly === 3, a5.counts)

// ⑥ limit：只看最近 N 条，老的不再唠叨
const d6 = mkdir('limit')
const old = row({ claimId: 'c-old', ack: 'admitted', action: { type: 'write', ok: false }, evidence: { tool: 'write', callId: 'k5' } })
const recent = Array.from({ length: 3 }, (_, i) => row({ claimId: 'c-new' + i, ack: 'unclear', action: { type: 'cmd', ok: false }, evidence: { tool: 'pwsh', callId: 'k6' } }))
fs.writeFileSync(path.join(d6, SHADOW_FILE), [old, ...recent].join('\n') + '\n')
const a6 = adviseFromRevisions(d6, { limit: 3 })
check('limit=3 → 老的那条不提醒', a6.lines.length === 0, { lines: a6.lines, counts: a6.counts })

// ⑦ 坏行不影响
const d7 = mkdir('bad')
fs.writeFileSync(path.join(d7, SHADOW_FILE), 'not-json\n' + row({ claimId: 'c-bad', ack: 'admitted', action: { type: 'write', ok: false }, evidence: { tool: 'write', callId: 'k7' } }) + '\n')
const a7 = adviseFromRevisions(d7)
check('坏行被跳过，仍能给出提示', a7.lines.length === 1, a7.lines)

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
