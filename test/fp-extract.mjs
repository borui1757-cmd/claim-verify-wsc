// 回归：2026-11-06 实机误报四例 + 三条正例不许被误伤
// 跑法：node test/fp-extract.mjs
import { extractClaims } from '../lib/index.js'

let pass = 0
let fail = 0

function check(name, text, want) {
  const got = extractClaims(text)
  const ok = want === 'none' ? got.length === 0 : got.length === want.length && got.every((c, i) => c.kind === want[i].kind && c.polarity === want[i].polarity)
  if (ok) {
    pass++
    console.log(`PASS  ${name}`)
  } else {
    fail++
    console.log(`FAIL  ${name}`)
    console.log(`      期望 ${JSON.stringify(want)}`)
    console.log(`      实际 ${JSON.stringify(got.map((c) => ({ k: c.kind, v: c.value, p: c.polarity })))}`)
  }
}

// ── 三个必须放过（真机误报）──
// ① 引用核验器自己的报错：命令提示符片段被当路径
check('引用核验说明时不抽断言', '【实时核验】命令返回成功，但 `C:\\Users\\19156\\>` 不存在。', 'none')
// ② PowerShell 变量拼接不是路径
check('$ 变量伪路径不抽断言', '路径里那个 `C:\\Users\\19156\\$p1` 不是我写的真实路径。', 'none')
// ③ Markdown 引用块里是复述历史，不是当前断言
check('引用块里的端口不当断言', '> **现在启动第二个实例（端口 3099），当前宿主不受影响**', 'none')

// ── 三条正例必须照旧成立（防止修过头）──
check('正常端口断言仍要抓到', '服务已经在 127.0.0.1:3210 上监听。', [{ kind: 'port', polarity: 'pos' }])
check('正常路径断言仍要抓到', '配置写进了 `C:\\Users\\19156\\.dsh\\profiles\\web\\package.json`。', [{ kind: 'path', polarity: 'pos' }])
check('否定路径断言仍是 neg', '这个路径不存在：`C:\\Users\\19156\\Desktop\\季度报告-20261106.md`', [{ kind: 'path', polarity: 'neg' }])

// ── 时态：历史叙述不核，现况照旧核（2026-11-06 加）──
check('历史端口不抽断言', '找到第二个实例（端口 3099），当时确实起来过。', 'none')
check(
  '混合句只留"现在"那个端口',
  '当时端口是 3099，现在改成 3210 了，服务在 127.0.0.1:3210 上监听。',
  [{ kind: 'port', polarity: 'pos' }],
)
check('现况端口必须抓到', '宿主现在在 127.0.0.1:3080 上监听。', [{ kind: 'port', polarity: 'pos' }])

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
