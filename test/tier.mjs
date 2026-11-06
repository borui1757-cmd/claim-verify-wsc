import { classify, disposition, renderTier, T1, T2, T3 } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/tier.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const P = { allowedTools: ['read', 'write', 'pwsh', 'grep'] }

// T1：只读
check('read → T1', classify({ tool: 'read', args: { path: 'a.txt' } }, P).tier === T1)
check('grep → T1', classify({ tool: 'grep', args: { pattern: 'x' } }, P).tier === T1)
check('T1 处置=allow', disposition(T1) === 'allow')

// T2：写入（可回滚）
const w = classify({ tool: 'write', args: { path: 'a.txt', content: 'x' } }, P)
check('write → T2', w.tier === T2, w)
check('T2 处置=allow-and-queue', disposition(T2) === 'allow-and-queue')

// T2：普通命令
check('npm test → T2', classify({ tool: 'pwsh', args: { command: 'npm test' } }, P).tier === T2)

// T3：敏感目标
const r1 = classify({ tool: 'pwsh', args: { command: 'curl https://api.wxpay.com/pay' } }, P)
check('支付域名 → T3', r1.tier === T3, r1)
check('原因含敏感目标', r1.reason.includes('敏感'), r1)

// T3：转账关键词
check('转账 → T3', classify({ tool: 'pwsh', args: { command: '给他转账 100' } }, P).tier === T3)

// T3：删除
check('Remove-Item → T3', classify({ tool: 'pwsh', args: { command: 'Remove-Item C:\\a.txt' } }, P).tier === T3)
check('delete_file 工具 → T3', classify({ tool: 'delete_file', args: {} }, P).tier === T3)

// T3：未知工具（不确定取更严）
const r2 = classify({ tool: 'wechat_transfer', args: {} }, P)
check('白名单外工具 → T3', r2.tier === T3 && r2.kind === 'tool-not-allowed', r2)

// T3：完全不认识的工具类型
check('未知工具 → T3（按最严）', classify({ tool: 'quantum_thing', args: {} }, {}).tier === T3)

// T3 处置=stop
check('T3 处置=stop', disposition(T3) === 'stop')

// 文案
check('文案含【动作分档】', renderTier(r1, { tool: 'pwsh' }).includes('【动作分档】'))
check('T3 文案含需人工确认', renderTier(r1, { tool: 'pwsh' }).includes('需人工确认'))

// 凭据文件
check('id_rsa → T3', classify({ tool: 'read', args: { path: 'C:\\Users\\x\\.ssh\\id_rsa' } }, P).tier === T3)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
