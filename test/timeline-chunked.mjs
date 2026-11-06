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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-tl-chunk-'))
const box = createTimelineBox(root, { chunked: true })
const f = path.join(root, 'big.txt')

// 造一个 30KB 文件，改一个字节后再记录
const v1 = 'A'.repeat(15000) + 'MARKER' + 'B'.repeat(15000)
fs.writeFileSync(f, v1)
box.record(100, [f])

const v2 = 'A'.repeat(15000) + 'X' + 'MARKER' + 'B'.repeat(15000)
fs.writeFileSync(f, v2)
box.record(200, [f])

check('分块模式标记', box.stats().chunked === true)
check('记录了 chunk 统计', !!box.stats().chunks, box.stats())

// 两个版本内容都能还原
const r1 = box.readAt(f, 150)
const r2 = box.readAt(f, 250)
check('能读回 v1', r1 && r1.toString() === v1)
check('能读回 v2', r2 && r2.toString() === v2)

// CDC 的收益：第二次只新增少量块
const st = box.stats().chunks
check('分块存储总量小于两倍文件大小', st.bytes < v1.length * 2, { bytes: st.bytes, file: v1.length })

// 世界线仍然正常
check('世界线 2 个版本', box.worldline(f).length === 2, box.worldline(f).length)
check('窗口查询正常', box.existedBetween(f, 90, 150).existed === true)

fs.rmSync(root, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
