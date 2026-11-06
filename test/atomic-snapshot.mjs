import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readOnce, readMany, truthOf } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/atomic-snapshot.js'
import { verifyHostClaim } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/host.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-atomic-'))
const f = path.join(tmp, 'a.txt')
fs.writeFileSync(f, 'l1\nl2\nl3\n') // 3 行，12 字节（末尾换行）

const s = readOnce(f)
check('读到存在', s.exists === true)
check('大小正确', s.size === 9, s.size)
check('行数正确(末尾换行不多算)', s.lines === 3, s.lines)
check('哈希是 64 位 hex', /^[0-9a-f]{64}$/.test(s.hash))

const missing = readOnce(path.join(tmp, 'nope.txt'))
check('不存在返回 exists:false 且不抛错', missing.exists === false)

// ── 关键：篡改文件后，用旧快照核验应仍按旧值判定 ──
fs.writeFileSync(f, 'changed\n')
const claims = [
  { kind: 'lines', value: { path: f, n: 3 }, raw: '', ctx: '', polarity: 'pos' },
  { kind: 'size', value: { path: f, bytes: 9 }, raw: '', ctx: '', polarity: 'pos' },
  { kind: 'hash', value: { path: f, prefix: s.hash.slice(0, 12) }, raw: '', ctx: '', polarity: 'pos' },
]

// 用快照核验：应全部按"当时的字节"判 pass
for (const c of claims) {
  const r = await verifyHostClaim(c, {}, { fileSnapshot: new Map([[f, s]]) })
  check(`快照核验 ${c.kind} 用旧值 → ok`, r && r.ok === true, r)
}

// 不用快照：现在文件已改，应判不符
const r2 = await verifyHostClaim(claims[0], {})
check('无快照时按现状判 → 不符', r2 && r2.ok === false, r2)

// 批量读取去重
const many = readMany([f, f, f])
check('readMany 去重', many.size === 1)
check('truthOf 取得到', truthOf(many, f) !== null)
check('truthOf 取不到返回 null', truthOf(many, path.join(tmp, 'x.txt')) === null)

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
