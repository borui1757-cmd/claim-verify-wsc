import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDeltaEngine } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/task-delta.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-delta-'))
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-outside-'))

const eng = createDeltaEngine({ roots: [ws], ignore: [/node_modules/] })

// 回合 1：创建 + 修改 + 删除
fs.writeFileSync(path.join(ws, 'a.txt'), 'hello')
fs.writeFileSync(path.join(ws, 'b.txt'), 'world')
eng.beginTurn('t1')
fs.writeFileSync(path.join(ws, 'a.txt'), 'hello changed')       // modify
fs.writeFileSync(path.join(ws, 'c.txt'), 'new')                   // create
fs.rmSync(path.join(ws, 'b.txt'))                                 // delete
// 圈外改动不应被记录
fs.writeFileSync(path.join(outside, 'secret.txt'), 'x')
const d1 = eng.endTurn('t1')

const ops = d1.changes.map((c) => c.op + ':' + path.basename(c.path)).sort()
check('回合1 三个变化', d1.changes.length === 3, ops)
check('记录 modify', ops.includes('modify:a.txt'), ops)
check('记录 create', ops.includes('create:c.txt'), ops)
check('记录 delete', ops.includes('delete:b.txt'), ops)
check('圈外变化不计入', !d1.changes.some((c) => c.path.includes('cv-outside')), ops)
check('改了内容有 hash', d1.changes.find((c) => c.op === 'modify').hash !== null)
check('parent 是 genesis', d1.parentHash === 'genesis')

// 回合 2：无变化
eng.beginTurn('t2')
const d2 = eng.endTurn('t2')
check('回合2 无变化', d2.changes.length === 0, d2.changes)
check('链式 parent', d2.parentHash === d1.deltaHash)

// 回合 3：再改一次，验证链路
eng.beginTurn('t3')
fs.writeFileSync(path.join(ws, 'a.txt'), 'again')
const d3 = eng.endTurn('t3')
check('回合3 一个变化', d3.changes.length === 1, d3.changes)

// 链校验
check('链完整', eng.verifyChain().ok === true, eng.verifyChain())
check('链长度 3', eng.chain().length === 3)

// 篡改检测：改一个 delta 的内容
const chain = eng.chain()
chain[1].changes.push({ path: 'x', op: 'create', size: 1, hash: 'deadbeef' })
check('篡改被检出', eng.verifyChain().ok === false, eng.verifyChain())

fs.rmSync(ws, { recursive: true, force: true })
fs.rmSync(outside, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
