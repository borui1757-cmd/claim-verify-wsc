import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCoherence } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/coherence.js'
import { chunkBuffer, createChunkStore } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/chunk-store.js'
import { createAlertPolicy } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/alert-policy.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

// ── ① 一致性：版本变了就失效，不看时间 ──
const co = createCoherence()
co.put('/a.txt', 'PASS', 'hash-v1')
check('同版本可命中', co.get('/a.txt', 'hash-v1') !== null)
check('版本变了立即失效', co.get('/a.txt', 'hash-v2') === null)
check('失效后被移除', co.size() === 0, co.size())

co.put('/dir/x', 'PASS', 'v1')
co.put('/dir/y', 'PASS', 'v1')
co.put('/other', 'PASS', 'v1')
check('前缀批量失效', co.invalidatePrefix('/dir/') === 2, co.size())
check('其他键仍在', co.size() === 1)

// ── ② CDC：插入一个字节，只影响局部块 ──
const base = Buffer.from('A'.repeat(5000) + 'MARKER' + 'B'.repeat(5000))
const modified = Buffer.from('A'.repeat(5000) + 'X' + 'MARKER' + 'B'.repeat(5000))
const cb = chunkBuffer(base, { avg: 1024 })
const cm = chunkBuffer(modified, { avg: 1024 })
check('分块产生多块', cb.length > 2, cb.length)
check('块总长还原原长', cb.reduce((s, c) => s + c.length, 0) === base.length)
check('轻微改动后块数接近', Math.abs(cb.length - cm.length) <= 1, { b: cb.length, m: cm.length })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-chunk-'))
const store = createChunkStore(root)
const r1 = store.put(base)
const r2 = store.put(modified)
check('还原内容正确', store.get(r1.chunks).equals(base))
check('CDC 去重：第二次只存少量新块', r2.bytesStored < base.length / 2, { stored: r2.bytesStored, total: base.length })
check('两次文件哈希不同', r1.hash !== r2.hash)

// ── ③ 告警策略：冷却 + 限额 + 高优先 ──
const ap = createAlertPolicy({ cooldownMs: 60_000, maxPerTurn: 2 })
check('首次告警', ap.shouldAlert({ key: 'k1', nowMs: 0 }).alert === true)
check('冷却期内不重复打扰', ap.shouldAlert({ key: 'k1', nowMs: 1000 }).alert === false)
check('不同 key 可告警', ap.shouldAlert({ key: 'k2', nowMs: 2000 }).alert === true)
check('超本轮限额被抑制', ap.shouldAlert({ key: 'k3', nowMs: 3000 }).alert === false)
check('高严重度突破限额', ap.shouldAlert({ key: 'k4', severity: 'high', nowMs: 4000 }).alert === true)
const st = ap.resetTurn()
check('重置返回上轮统计', st.alerts === 3, st)
check('冷却记录跨轮保留', ap.shouldAlert({ key: 'k1', nowMs: 5000 }).alert === false)

fs.rmSync(root, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
