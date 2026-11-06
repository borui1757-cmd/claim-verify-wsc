import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inlineCheck, resetInlineLedger } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/inline.js'

let pass = 0
let fail = 0
function check(name, got, wantNull) {
  const ok = wantNull ? got === null : got !== null
  if (ok) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.log(`FAIL  ${name} -> ${JSON.stringify(got)}`) }
}

const tmp = path.join(os.tmpdir(), 'cv-inline-probe-' + Date.now() + '.txt')
resetInlineLedger()

// 1) 正常写入：存在 → 不报
fs.writeFileSync(tmp, 'x')
check('写入后立即核验不报错', inlineCheck('write', { path: tmp }, {}), true)

// 2) 删掉它（模拟同一回合后续清理）。真实链路里核验跑在命令**执行之后**，所以先删再核验。
try { fs.unlinkSync(tmp) } catch {}
const del = inlineCheck('pwsh', { command: `Remove-Item '${tmp}' -Force` }, {})
check('删除命令本身不报错', del, true)

// 3) 关键：删除之后再回头核验同一条 write —— 必须放过（以前会报"返回成功但不存在"）
check('时点差：先写后删不报错', inlineCheck('write', { path: tmp }, {}), true)

// 4) 真·没写成功（从未存在、也没删过）仍要报
const ghost = path.join(os.tmpdir(), 'cv-never-existed-' + Date.now() + '.txt')
check('真正没落地仍要报', inlineCheck('write', { path: ghost }, {}), false)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
