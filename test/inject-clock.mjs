import { injectClock } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/index.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

const at = new Date('2026-11-07T02:52:31+08:00').getTime()

// ① 字符串内容
const req1 = { messages: [{ role: 'system', content: 'S' }, { role: 'user', content: '你好' }] }
const out1 = injectClock(req1, at)
check('注入到最后一条 user', out1.messages[1].content.includes('[系统注入] 当前时间 2026-11-07 02:52:31'), out1.messages[1].content)
check('系统提示未被改动', out1.messages[0].content === 'S')
check('原地注入（宿主可能忽略返回值）', req1.messages[1].content.includes('[系统注入]'))

// ② 幂等：已注入就不重复
const out2 = injectClock(out1, at)
check('幂等：不重复注入', (out2.messages[1].content.match(/\[系统注入\]/g) || []).length === 1)

// ③ 数组形态内容
const req3 = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }
const out3 = injectClock(req3, at)
check('数组内容追加文本块', out3.messages[0].content.length === 2 && out3.messages[0].content[1].text.includes('2026-11-07 02:52:31'))

// ④ 边界：没有 messages / 没有 user
check('无 messages 原样返回', injectClock({}, at) !== null && !injectClock({}, at).messages)
check('无 user 原样返回', injectClock({ messages: [{ role: 'system', content: 'S' }] }, at).messages.length === 1)

// ⑤ 只注入最后一条 user
const req5 = { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] }
const out5 = injectClock(req5, at)
check('只动最后一条 user', !out5.messages[0].content.includes('[系统注入]') && out5.messages[2].content.includes('[系统注入]'))

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
