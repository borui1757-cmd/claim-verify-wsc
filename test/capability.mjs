import { checkCapability, renderCapability, SENSITIVE_PATTERNS } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/capability.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

// ① 空策略 = 不限制
check('空策略放行', checkCapability({ tool: 'pwsh', args: { command: 'ls' } }, {}).allow === true)

// ② 工具白名单
const p1 = { allowedTools: ['read', 'write', 'pwsh'] }
check('白名单内放行', checkCapability({ tool: 'write', args: {} }, p1).allow === true)
const r2 = checkCapability({ tool: 'wechat_transfer', args: {} }, p1)
check('白名单外拦截', r2.allow === false && r2.kind === 'tool-not-allowed', r2)

// ③ 敏感目标：支付域名
const r3 = checkCapability({ tool: 'pwsh', args: { command: 'curl https://api.wxpay.com/v3/pay' } }, {})
check('支付域名被拦', r3.allow === false && r3.kind === 'payment-domain', r3)

// ④ 敏感关键词：转账
const r4 = checkCapability({ tool: 'pwsh', args: { command: 'echo 我要给你转账 100 元' } }, {})
check('资金关键词被拦', r4.allow === false && r4.kind === 'wallet-keyword', r4)

// ⑤ 凭据文件
const r5 = checkCapability({ tool: 'read', args: { path: 'C:\\Users\\x\\.ssh\\id_rsa' } }, {})
check('凭据文件被拦', r5.allow === false && r5.kind === 'credential-file', r5)

// ⑥ 显式允许敏感操作
check('allowSensitive 放行', checkCapability({ tool: 'pwsh', args: { command: 'curl https://api.wxpay.com/x' } }, { allowSensitive: true }).allow === true)

// ⑦ 普通命令不受影响
check('普通命令放行', checkCapability({ tool: 'pwsh', args: { command: 'npm test' } }, {}).allow === true)
check('写文件放行', checkCapability({ tool: 'write', args: { path: 'C:\\tmp\\a.txt', content: 'hi' } }, {}).allow === true)

// ⑧ 文案
const msg = renderCapability(r3, { tool: 'pwsh' })
check('拦截文案含【能力边界】', msg.includes('【能力边界】'))
check('放行时文案为空', renderCapability({ allow: true }, { tool: 'pwsh' }) === '')

// ⑨ 默认规则表非空
check('默认敏感规则 >=3 条', SENSITIVE_PATTERNS.length >= 3)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
