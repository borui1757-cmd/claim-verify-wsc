import {
  createBox, writeFile, snapshot, restore, compareWithLive, destroyBox,
} from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/mirror-box.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const box = createBox()
writeFile(box, 'a.txt', 'hello world\n')
writeFile(box, 'sub/b.txt', 'x'.repeat(100))

const snap = snapshot(box)
check('快照记录 2 个文件', snap.entries.length === 2, snap.entries.length)
check('快照记了大小', snap.entries.find((e) => e.rel === 'a.txt').size === 12)
check('快照记了哈希', /^[0-9a-f]{64}$/.test(snap.entries.find((e) => e.rel === 'a.txt').hash))
check('快照记了行数', snap.entries.find((e) => e.rel === 'a.txt').lines === 2)

// 无变化时不应有漂移
check('未变动时无漂移', compareWithLive(box, snap).drifted === false)

// 1) 删除 → 应报 missing
import fs from 'node:fs'
import path from 'node:path'
fs.rmSync(path.join(box.root, 'a.txt'))
let r = compareWithLive(box, snap)
check('删除被检出(missing)', r.drifted && r.drift.some((d) => d.kind === 'missing'), r.drift)

// 2) 复位应补回
const rest = restore(box, snap)
check('复位补回了文件', rest.restored.includes('a.txt'), rest)
check('复位后大小一致', fs.statSync(path.join(box.root, 'a.txt')).size === 12)

// 3) 新增多余文件 → extra
writeFile(box, 'extra.txt', 'z')
r = compareWithLive(box, snap)
check('多余文件被检出(extra)', r.drifted && r.drift.some((d) => d.kind === 'extra'), r.drift)

// 4) 复位应删掉多余
const rest2 = restore(box, snap)
check('复位删掉了多余文件', rest2.removed.includes('extra.txt'), rest2)
check('复位后无漂移', compareWithLive(box, snap).drifted === false)

// 5) 同大小改内容 → 只能靠 hash 检出
fs.writeFileSync(path.join(box.root, 'a.txt'), 'HELLO WORLD\n')
r = compareWithLive(box, snap)
check('同大小内容变化靠 hash 检出', r.drifted && r.drift.some((d) => d.kind === 'hash'), r.drift)

// 6) 越界写必须被拒绝
let threw = false
try { writeFile(box, '../../evil.txt', 'x') } catch { threw = true }
check('越界路径被拒绝', threw)

destroyBox(box)
check('箱子已清理', !fs.existsSync(box.root))

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
