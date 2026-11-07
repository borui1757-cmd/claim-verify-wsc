// revision.mjs —— 原子修订（revision/v2）自测 + CI 谓词
//
// 验证 docs/HANDOFF-2026-11-07-原子修订.md 的三条要求：
//   ① claim 记录有 ack/txid/三时钟，四项齐备才算修订
//   ② 缺一项 → 一个字节都不写（all-or-nothing 在入口）
//   ③ 非原子记录进不了 revisions.jsonl；影子记录不得当证据
//
// 坑（参考实现踩过，别再踩）：
//   - console.assert 失败不抛错 → 这里 check() 自己 throw
//   - null 时钟是 incomplete，不是"倒序"
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRevision, commit, isAtomic, audit, toV2, SCHEMA } from '../lib/revision.js'
import { classifyAck, recordRevision, auditRevisions, REVISIONS_FILE, SHADOW_FILE } from '../lib/revision-log.js'

let pass = 0
let fail = 0
function check(cond, msg, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + msg) }
  else { fail += 1; console.log('FAIL  ' + msg + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-rev-'))
const revFile = path.join(tmp, 'rev.jsonl')

const base = {
  claimId: 'c1',
  ack: 'admitted',
  action: { type: 'rewrite', ok: true },
  evidence: { tool: 'write_file', callId: 'call_1', digest: 'abc' },
  tAction: '2026-11-07T03:00:00.000Z',
  tClaim: '2026-11-07T03:00:05.000Z',
  tVerify: '2026-11-07T03:00:09.000Z',
}

// ── ① ack 分类：技术性认定失败也算认（窄正则必漏）──
check(classifyAck('我错了，确实没写成').ack === 'admitted', 'A1 我错了 → admitted')
check(classifyAck('写入未真正落盘，需重试').ack === 'admitted', 'A2 技术性认定失败 → admitted')
check(classifyAck('工具返回 ok，但我无法证明文件已落盘').ack === 'admitted', 'A3 无法证明已落盘 → admitted')
check(classifyAck('我用的是相对路径，所以不矛盾').ack === 'denied', 'A4 路径语义 → denied')
check(classifyAck('好的，继续下一步').ack === 'unclear', 'A5 中性 → unclear')
check(classifyAck('').ack === 'unclear', 'A6 空文本 → unclear')
check(classifyAck('我错了').evidence.startsWith('admit:'), 'A7 分类带命中规则（标签错了能查）')

// ── ② 入口校验：不合法一个字节都不写 ──
const ok = commit(revFile, base)
check(isAtomic(ok), 'B1 四项齐备 → 原子')
const before = fs.readFileSync(revFile, 'utf8').length
let threw = 0
for (const bad of [
  { ...base, evidence: { tool: '', callId: '' } },
  { ...base, tAction: '2026-11-07T09:00:00.000Z' },   // 时钟倒序
  { ...base, ack: 'maybe' },
  { ...base, action: { type: 'rewrite', ok: 'yes' } },
]) {
  try { commit(revFile, bad); }
  catch { threw += 1; }
}
check(threw === 4, 'B2 四类非法提交全被拒', { threw })
check(fs.readFileSync(revFile, 'utf8').length === before, 'B3 被拒后文件一个字节没变')

// ── ③ 审计四态 + legacy + null 时钟走 incomplete ──
const f2 = path.join(tmp, 'half.jsonl')
const rec = (o) => JSON.stringify({ schema: SCHEMA, ...base, ...o })
fs.writeFileSync(f2, [
  rec({ txid: 'a1' }),
  rec({ txid: 'a2', ack: 'admitted', action: { type: 'rewrite', ok: false } }),
  rec({ txid: 'a3', ack: 'denied', action: { type: 'rewrite', ok: true } }),
  rec({ txid: 'a4', ack: 'unclear', action: { type: 'rewrite', ok: false } }),
  rec({ txid: 'a5', tAction: null }),                 // 缺时刻：不完整，不是倒序
  JSON.stringify({ legacy: true, schema: 'v1', claimId: 'old' }),
].join('\n') + '\n')
const a = audit(f2)
// a5 是「认了、动作成功、但缺 tAction」：它同时计入 incomplete 和 none ——
// 缺时刻的记录既不原子、也不属于"只认不改/只改不认"任何一态。CI 谓词按 incomplete 单独抓它。
check(a.atomic === 1 && a.ackOnly === 1 && a.actOnly === 1 && a.none === 2 && a.legacy === 1,
  'C1 四态分类正确（含缺时刻那条落到 none）', { atomic: a.atomic, ackOnly: a.ackOnly, actOnly: a.actOnly, none: a.none, legacy: a.legacy })
check(a.incomplete === 1 && a.clockViolations === 0, 'C2 null 时钟 = incomplete，不是 clockViolation', { incomplete: a.incomplete, clockViolations: a.clockViolations })
const v2 = toV2({ claimId: 'old1', verdict: 'supported' })
check(v2.legacy === true && v2.ack === null, 'C3 v1→v2 只标 legacy，不编造 ack')

// ── ④ 分流：原子进 revisions.jsonl，其余进影子，缺字段留 null ──
const dir = path.join(tmp, 'log')
// ② 「工具说 ok 但目标不存在」必须判成失败 —— 用一个真实存在的文件做对照组
const written = path.join(tmp, 'written.txt')
fs.writeFileSync(written, 'x', 'utf8')
const receipt = {
  digest: 'rcpt1',
  sessionId: 's1',
  at: '2026-11-07T03:00:09.000Z',
  claims: [
    // ① 工具成功 + 目标真的存在 → 算"改了"
    { claim: { kind: 'write', target: written }, verdict: 'supported', evidence: { tool: 'write', callId: 'call_A', resultDigest: 'd1', isError: false, resultSeen: true }, txid: 't1' },
    // ② 工具自称成功，但目标不存在（假成功）→ 绝不能进原子文件
    { claim: { kind: 'write', target: path.join(tmp, 'never.txt') }, verdict: 'insufficient', evidence: { tool: 'write', callId: 'call_C', isError: false, resultSeen: true }, txid: 't3' },
    // ③ 工具报错 → 动作失败 = 只认不改
    { claim: { kind: 'cmd', target: 'npm test' }, verdict: 'contradicted', evidence: { tool: 'pwsh', callId: 'call_B', isError: true, resultSeen: true }, txid: 't2' },
  ],
}

const r1 = recordRevision({
  dir, receipt, ackText: '我错了，已重写并验证。',
  tAction: '2026-11-07T03:00:00.000Z', tClaim: '2026-11-07T03:00:05.000Z', tVerify: receipt.at,
})
check(r1.committed === 1, 'D1 认账 + 工具成功 + 目标真的存在 + 三时钟 → 提交 1 条原子修订', r1)
check(r1.shadowed === 2, 'D2 假成功 / 工具报错那两条只进影子', r1)
check((r1.reasons['action-not-ok'] || 0) === 2, 'D2b 假成功也被判 action-not-ok（工具说 ok 但目标不存在）', r1.reasons)
const revRows = fs.readFileSync(path.join(dir, REVISIONS_FILE), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
check(revRows.length === 1 && isAtomic(revRows[0]), 'D3 revisions.jsonl 只有原子行')
const shRows = fs.readFileSync(path.join(dir, SHADOW_FILE), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
check(shRows.every((r) => r.shadow === true && r.usable_for_verdict === false), 'D4 影子行都带 shadow/usable_for_verdict 标记')

// 不认账 → 不提交
const dir2 = path.join(tmp, 'log2')
const r2 = recordRevision({
  dir: dir2, receipt, ackText: '我用的是相对路径，所以不矛盾。',
  tAction: '2026-11-07T03:00:00.000Z', tClaim: '2026-11-07T03:00:05.000Z', tVerify: receipt.at,
})
check(r2.committed === 0 && r2.shadowed === 3, 'E1 辩护（denied）→ 一条都不提交', r2)
check(!fs.existsSync(path.join(dir2, REVISIONS_FILE)) || fs.readFileSync(path.join(dir2, REVISIONS_FILE), 'utf8').trim() === '', 'E2 辩护时 revisions.jsonl 没被写')

// 缺 tAction → 影子，且 provenance 如实标 absent（不猜）
const dir3 = path.join(tmp, 'log3')
const r3 = recordRevision({ dir: dir3, receipt, ackText: '我错了。', tAction: null, tClaim: '2026-11-07T03:00:05.000Z', tVerify: receipt.at })
check(r3.committed === 0, 'F1 缺 tAction → 不提交原子修订', r3)
const f3rows = fs.readFileSync(path.join(dir3, SHADOW_FILE), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
check(f3rows.some((r) => String(r.provenance.tAction).startsWith('absent')), 'F2 tAction 缺失如实标 absent')
check(f3rows.every((r) => r.tAction === null), 'F3 缺的时钟就是 null，不编值')

// ── ⑤ CI 谓词：干净的通过，塞一条非原子的必须被抓 ──
const clean = auditRevisions(dir)
check(clean.ok === true, 'G1 干净目录 → CI 谓词通过', clean.violations)
fs.appendFileSync(path.join(dir, REVISIONS_FILE), JSON.stringify({ schema: SCHEMA, txid: 'x', claimId: 'bad', ack: 'unclear', action: { type: 'cmd', ok: false }, evidence: null, tAction: null, tClaim: null, tVerify: null }) + '\n')
const dirty = auditRevisions(dir)
check(dirty.ok === false && dirty.violations.length > 0, 'G2 塞入非原子记录 → CI 谓词报警', dirty.violations)

// ── ⑥ 真实目录（若已存在）：只读检查，不阻塞 ──
const realDir = path.join(os.homedir(), '.dsh', 'dsh-claim-verify')
const real = auditRevisions(realDir)
console.log(`INFO  真实目录 ${realDir}：原子 ${real.revisions.atomic} / legacy ${real.revisions.legacy} / 影子 ${real.shadow.total} / 违规 ${real.violations.length}`)
// CI 谓词（HANDOFF 第三段要求）：真实目录里出现非原子/时钟倒序/影子冒充证据 → 直接失败
check(real.ok === true, 'H1 真实回执目录通过原子性谓词', real.violations)

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
