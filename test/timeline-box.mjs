import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTimelineBox } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/timeline-box.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-tl-'))
const box = createTimelineBox(root)
const f = path.join(root, 'a.txt')

// t=100：文件存在
fs.writeFileSync(f, 'v1')
box.record(100, [f])

// t=200：文件被删
fs.rmSync(f, { force: true })
box.record(200, [f])

// t=300：文件重新出现（不同内容）
fs.writeFileSync(f, 'v2 longer')
box.record(300, [f])

// 时间点查询
check('t=150 状态里有文件', !!box.stateAt(150).entries[f], box.stateAt(150))
check('t=250 状态里没文件', !box.stateAt(250).entries[f], box.stateAt(250))
check('t=350 状态里有文件', !!box.stateAt(350).entries[f], box.stateAt(350))

// 时间窗查询：这是四维箱子的核心能力
check('窗口 [90,150] 曾存在', box.existedBetween(f, 90, 150).existed === true)
check('窗口 [210,260] 曾存在（删除后重建之间）', box.existedBetween(f, 210, 260).existed === false)
check('窗口 [250,350] 曾存在（重建）', box.existedBetween(f, 250, 350).existed === true)

// 世界线：含删除事件（tombstone）
const wl = box.worldline(f)
check('世界线有 3 个事件（v1 / 删除 / v2）', wl.length === 3, wl)
check('第二个事件是删除', wl[1].deleted === true, wl[1])
check('两个版本哈希不同', wl[0].hash !== wl[2].hash)

// 删除事件查询
check('窗口 [190,210] 检出删除', box.deletedBetween(f, 190, 210).deleted === true)
check('窗口 [90,150] 无删除', box.deletedBetween(f, 90, 150).deleted === false)
check('删除事件带 prevHash', box.deletedBetween(f, 190, 210).prevHash === wl[0].hash)

// 内容不变的重复曝光不应记新版本
const same = fs.readFileSync(f)
box.record(350, [f])
check('内容未变不新增版本', box.worldline(f).length === 3, box.worldline(f).length)

// 当时那份字节
check('t=150 的版本是 v1', box.versionAt(f, 150).hash === wl[0].hash)
check('t=350 的版本是 v2', box.versionAt(f, 350).hash === wl[2].hash)

// 内容寻址去重：同样的内容只存一份
const g = path.join(root, 'b.txt')
fs.writeFileSync(g, 'v1')
const before = fs.readdirSync(path.join(root, 'blobs')).length
box.record(400, [g])
const after = fs.readdirSync(path.join(root, 'blobs')).length
check('相同内容不重复存 blob', after === before, { before, after })

// 统计
check('统计正确', box.stats().versions === 5 && box.stats().paths === 2, box.stats())

fs.rmSync(root, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
