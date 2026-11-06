import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { observeFile, summarizeConflicts } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/independence.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-indep-'))
const f = path.join(dir, 'a.txt')
const content = 'line1\nline2\nline3\n'
fs.writeFileSync(f, content)

// ① 正常文件：四条观测一致
const o1 = observeFile(f)
check('stat 认为存在', o1.statExists === true)
check('readdir 也认为存在', o1.readdirExists === true)
check('stat 大小 = 真实字节数', o1.sizeStat === Buffer.byteLength(content), { s: o1.sizeStat, b: Buffer.byteLength(content) })
check('行数正确', o1.lines === 3, o1.lines)
check('哈希非空', typeof o1.hash === 'string' && o1.hash.length === 64)
check('无冲突', o1.conflicts.length === 0, o1.conflicts)

// ② 不存在的文件：两个观测都说不存在（一致）
const missing = path.join(dir, 'nope.txt')
const o2 = observeFile(missing)
check('不存在：stat=false', o2.statExists === false)
check('不存在：readdir=false', o2.readdirExists === false)
check('不存在时不报冲突（两源一致）', o2.conflicts.length === 0, o2.conflicts)

// ③ 目录冒充文件：stat 说不是文件，readdir 说存在 → 冲突
const sub = path.join(dir, 'sub')
fs.mkdirSync(sub)
const o3 = observeFile(sub)
check('目录：statExists=false（不是文件）', o3.statExists === false)
check('目录：readdirExists=true', o3.readdirExists === true)
check('目录：存在性不一致 → 报冲突', o3.conflicts.some((c) => c.kind === '存在性不一致'), o3.conflicts)

// ④ 摘要可读
const s = summarizeConflicts(o3)
check('摘要含【证据冲突】', s.includes('【证据冲突】'))
check('无冲突时摘要为空', summarizeConflicts(o1) === '')

// ⑤ 大小交叉验证能抓到"元数据说谎"（模拟：手改 stat 不可行，用大文件+截断验证一致性逻辑）
const big = path.join(dir, 'big.bin')
fs.writeFileSync(big, Buffer.alloc(1024, 7))
const o5 = observeFile(big)
check('大文件 stat = read 长度', o5.sizeStat === o5.contentLength && o5.contentLength === 1024)

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
