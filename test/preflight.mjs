import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { preflightWrite, renderPreflight } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/preflight.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-pf-'))
const inside = path.join(dir, 'a.txt')
const outside = path.join(os.tmpdir(), 'cv-outside-' + Date.now() + '.txt')

// ① 允许范围内、新文件 → 放行
check('范围内新文件放行', preflightWrite({ path: inside, content: 'x', allowedRoots: [dir] }).allow === true)

// ② 越界 → 拦
const r2 = preflightWrite({ path: outside, content: 'x', allowedRoots: [dir] })
check('越界被拦', r2.allow === false && r2.kind === 'out-of-scope', r2)

// ③ 没配 allowedRoots 时不做越界判定（避免误伤）
check('未配根目录不判越界', preflightWrite({ path: outside, content: 'x' }).allow === true)

// ④ 疑似截断：大文件被覆盖成小内容 → 拦
const big = path.join(dir, 'big.txt')
fs.writeFileSync(big, 'x'.repeat(4096))
const r4 = preflightWrite({ path: big, content: 'tiny', allowedRoots: [dir] })
check('大文件缩水 → 拦', r4.allow === false && r4.kind === 'truncation', r4)

// ⑤ 正常改写（内容不小于一半）→ 放行
const r5 = preflightWrite({ path: big, content: 'y'.repeat(3000), allowedRoots: [dir] })
check('正常改写放行', r5.allow === true, r5)

// ⑥ 小文件缩水不拦（阈值 1KB 以下不管，避免噪音）
const small = path.join(dir, 'small.txt')
fs.writeFileSync(small, 'x'.repeat(200))
check('小文件不拦', preflightWrite({ path: small, content: 'y', allowedRoots: [dir] }).allow === true)

// ⑦ 受保护目录 → 拦
const r7 = preflightWrite({ path: 'C:\\Windows\\System32\\drivers\\etc\\hosts', content: 'x' })
check('系统目录被拦', r7.allow === false && r7.kind === 'protected', r7)

// ⑧ 渲染文案
const msg = renderPreflight(r4, { path: big })
check('拦截文案含【事前拦截】', msg.includes('【事前拦截】'))
check('放行时文案为空', renderPreflight({ allow: true }, { path: big }) === '')

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
