import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRecorder } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/recorder.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-bb-'))
let clock = Date.UTC(2026, 10, 7, 0, 0, 0)
const rec = createRecorder({ dir, maxRecords: 100, now: () => new Date(clock).toISOString() })

// 记录三类事件
rec.message('user', '帮我看看端口')
rec.toolCall('read', { path: 'C:/a.txt' }, { content: 'hi' })
clock += 1000
rec.toolCall('write', { path: 'C:/b.txt', content: 'x' }, { ok: true, isError: false })
clock += 1000
rec.delta([{ path: 'C:/b.txt', op: 'create' }])
clock += 1000
rec.message('assistant', '已写入 b.txt')

check('记录了 5 条', rec.stats().records === 5, rec.stats())
check('链校验通过', rec.verify().ok === true, rec.verify())

// 只存哈希：工具结果里不应出现原文
const lines = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
check('不存参数原文', !lines.some((l) => JSON.stringify(l).includes('帮我看看端口')))
check('消息只存长度+哈希', lines.some((l) => l.type === 'message' && typeof l.payload.len === 'number' && typeof l.payload.hash === 'string'))

// 回放
const rp = rec.replay(clock - 1500)
check('回放能看到之前的事件数', rp.events >= 2, rp.events)
check('回放按类型统计', rp.byType.message >= 1, rp.byType)
check('回放给出最后事件', !!rp.lastEvent)

// 时间窗
const win = rec.between(0, clock)
check('时间窗取到全部', win.length === 5, win.length)

// 篡改检测：改一条内存记录
const before = rec.verify().ok
const saved = lines[1]
lines[1] = { ...saved, payload: { tool: 'evil' } }
// 直接改文件后重新载入验证
fs.writeFileSync(path.join(dir, 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
const rec2 = createRecorder({ dir, maxRecords: 100 })
check('篡改被检出', rec2.verify().ok === false, rec2.verify())

// 环形淘汰：超限后仍可校验
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-bb2-'))
const rec3 = createRecorder({ dir: dir2, maxRecords: 5 })
for (let i = 0; i < 12; i++) rec3.event('tick', { i })
check('环形保留上限', rec3.stats().records === 5, rec3.stats().records)
check('淘汰后链仍可校验', rec3.verify().ok === true, rec3.verify())

fs.rmSync(dir, { recursive: true, force: true })
fs.rmSync(dir2, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
