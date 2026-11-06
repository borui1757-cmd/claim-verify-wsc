import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeWrite } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/actuator.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-act-'))
const f = path.join(dir, 'a.txt')

// ① 新文件写入成功
const r1 = safeWrite({ path: f, content: 'hello' })
check('新文件写入成功', r1.ok === true && r1.bytes === 5, r1)
check('内容正确', fs.readFileSync(f, 'utf8') === 'hello')

// ② 覆盖已有文件
const r2 = safeWrite({ path: f, content: 'hello world' })
check('覆盖写入成功', r2.ok === true && r2.bytes === 11, r2)

// ③ 关键：写入器"写坏了"（只写一半）→ 必须回滚到旧内容
const old = fs.readFileSync(f, 'utf8')
const truncatingWrite = (abs, content) => {
  const s = String(content);
  fs.writeFileSync(abs, s.slice(0, Math.max(1, Math.floor(s.length / 2)))); // 只写一半
}
const r3 = safeWrite({ path: f, content: 'hello world again' }, { writeFile: truncatingWrite })
check('写入截断被检出', r3.ok === false && r3.rolledBack === true, r3)
check('回滚后内容恢复', fs.readFileSync(f, 'utf8') === old, { now: fs.readFileSync(f, 'utf8'), old })

// ④ 新文件写坏 → 回滚应把文件删掉
const g = path.join(dir, 'new.txt')
const r4 = safeWrite({ path: g, content: 'brand new content' }, { writeFile: truncatingWrite })
check('新文件写坏 → 回滚删除', r4.ok === false && r4.rolledBack === true && !fs.existsSync(g), r4)

// ⑤ 写入器写入了"别的东西"（同长度不同内容）→ 哈希检出
const wrongContentWrite = (abs, content) => {
  const s = String(content);
  fs.writeFileSync(abs, 'x'.repeat(Buffer.byteLength(s, 'utf8')));
}
const r5 = safeWrite({ path: f, content: 'hello world' }, { writeFile: wrongContentWrite })
check('同长度不同内容被哈希检出', r5.ok === false && r5.rolledBack === true, r5)
check('回滚后仍是旧内容', fs.readFileSync(f, 'utf8') === old)

// ⑥ 空内容
const r6 = safeWrite({ path: path.join(dir, 'empty.txt'), content: '' })
check('空内容也能写', r6.ok === true && r6.bytes === 0, r6)

// ⑦ 中文按 UTF-8 计字节
const zh = safeWrite({ path: path.join(dir, 'zh.txt'), content: '中文测试' })
check('中文字节数正确', zh.ok === true && zh.bytes === Buffer.byteLength('中文测试', 'utf8'), zh)

// ⑧ 缺路径
check('缺路径报错', safeWrite({ content: 'x' }).ok === false)

fs.rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
