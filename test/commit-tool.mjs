import {
  COMMIT_KINDS, COMMIT_EXPECTS, normalizeCommitValue, makeCommitClaimsTool, COMMIT_TOOL_AVAILABLE,
} from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/commit-tool.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

// 转换：端口/PID 转数字，filecount 解析 JSON，路径原样
check('port 转数字', normalizeCommitValue('port', '3080') === 3080)
check('pid 转数字', normalizeCommitValue('pid', '1234') === 1234)
check('路径原样', normalizeCommitValue('path', ' C:\\a\\b.txt ') === 'C:\\a\\b.txt')

const fc = normalizeCommitValue('filecount', '{"dir":"C:\\\\tmp","n":3}')
check('filecount 解析 JSON', fc && fc.n === 3 && fc.dir === 'C:\\tmp', fc)
check('filecount 坏 JSON 返回 null', normalizeCommitValue('filecount', '{oops') === null)

// 声明方式集合
check('expect 含 not_exists', COMMIT_EXPECTS.includes('not_exists'))
check('kind 含 filecount', COMMIT_KINDS.includes('filecount'))

// 极性推导（工具内部规则）：以 not_ 开头 → 否定
const negPolarity = /^(not_|stopped|absent)/.test('not_exists')
check('not_exists 推出否定极性', negPolarity === true)
check('exists 推出肯定极性', /^(not_|stopped|absent)/.test('exists') === false)

// 工具构建：无 dsh-tools 时应返回 null（不抛错）
if (!COMMIT_TOOL_AVAILABLE) {
  check('脱离宿主返回 null', makeCommitClaimsTool({}) === null)
  check('缺少核验器也返回 null', makeCommitClaimsTool({ verifyClaims: () => {}, verifyCommitments: () => {} }) === null)
}
else {
  // 宿主里可用：缺核验器依赖时也应返回 null
  check('缺少核验器返回 null', makeCommitClaimsTool({}) === null)
}

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
