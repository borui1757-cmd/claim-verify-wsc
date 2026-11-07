// probe-tool.mjs —— check_truth 工具（agent 主动探针）自测。
//
// 依据 PaaT (ICML 2026 workshop)：delivery mechanism 会翻转符号——
// agent 主动调用探针能降低有害顺从，被动注入同样信号反而可能抬高。
// 所以"观察通道"这条缺口，我们走"可调用探针"而不是硬改工具结果。
//
// 这个测试不依赖 DSH 宿主：直接调 execute()，verify 用桩注入。
import { REPORT_TOOL_AVAILABLE, makeCheckTruthTool } from '../lib/report-tool.js'

let pass = 0
let fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

check('报告工具在当前环境可用（有 @deepseek-ai/dsh-tools）', REPORT_TOOL_AVAILABLE === true, REPORT_TOOL_AVAILABLE)

if (!REPORT_TOOL_AVAILABLE) {
  // 脱离 DSH 时工具造不出来：这本身也要如实报告，不能假装通过
  console.log('SKIP  宿主工具 API 不在，跳过 execute 级别断言')
  console.log(`\n${pass}/${pass + fail} 通过`)
  process.exit(fail === 0 ? 0 : 1)
}

// ① 没有 verify 依赖 → 不造工具（宁可没有，也不造一个会瞎判的）
check('缺 verify 依赖 → 返回 null', makeCheckTruthTool({}) === null)

// ② 正常：把 verify 的结果转成 summary/results
const tool = makeCheckTruthTool({
  verify: async (text) => ({
    results: [
      { kind: 'port', target: '3080', verdict: 'supported', reason: '未与系统真值冲突' },
      { kind: 'path', target: 'C:\\nope.txt', verdict: 'contradicted', reason: '与系统真值冲突' },
      { kind: 'cmd', target: 'npm test', verdict: 'insufficient', reason: '未评估' },
    ],
    _text: text,
  }),
})
check('有 verify 依赖 → 造出工具', Boolean(tool))
check('工具名是 check_truth', tool && tool.name === 'check_truth', tool && tool.name)
check('参数是 JSON Schema 且 text 必填', Boolean(
  tool && tool.parameters && tool.parameters.properties && tool.parameters.properties.text
  && Array.isArray(tool.parameters.required) && tool.parameters.required.includes('text'),
), tool && tool.parameters)

const out = await tool.execute({ text: '端口 3080 在听，C:\\nope.txt 不存在' })
check('summary.total=3', out.summary.total === 3, out.summary)
check('summary.supported=1', out.summary.supported === 1, out.summary)
check('summary.contradicted=1', out.summary.contradicted === 1, out.summary)
check('summary.insufficient=1', out.summary.insufficient === 1, out.summary)
check('每条结果带 verdict', out.results.every((r) => ['supported', 'contradicted', 'insufficient'].includes(r.verdict)), out.results)

// ③ 空文本：verify 拿到空串也要能返回结构（不抛）
const empty = await makeCheckTruthTool({ verify: async () => ({ results: [] }) }).execute({ text: '' })
check('空文本 → total=0 且不抛', empty.summary.total === 0, empty.summary)

// ④ verify 抛错时，错误要冒出来而不是被吞成"没问题"
let threw = false
try {
  await makeCheckTruthTool({ verify: async () => { throw new Error('engine down') } }).execute({ text: 'x' })
}
catch { threw = true }
check('verify 抛错 → 工具抛错（不假装成功）', threw)

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
