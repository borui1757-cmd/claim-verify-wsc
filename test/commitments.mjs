import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseCommitments, verifyCommitments, summarize,
} from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/commitments.js'
import { verifyClaims } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/index.js'
import { verifyHostClaim } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/host.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? ' -> ' + JSON.stringify(extra) : '')) }
}

// ── 解析 ──
const t1 = '做完啦。\n```claims\n[{"kind":"path","value":"C:\\\\tmp\\\\a.txt","expect":"exists"}]\n```\n以上。'
check('解析单个承诺块', parseCommitments(t1).items.length === 1)

check('无块返回 no-block', parseCommitments('没有块').error === 'no-block')
check('坏 JSON 返回 bad-json', parseCommitments('```claims\n[{oops]\n```').error === 'bad-json')
check('空数组返回 no-items', parseCommitments('```claims\n[]\n```').error === 'no-items')

const neg = parseCommitments('```claims\n[{"kind":"port","value":59000,"expect":"not_exists"}]\n```')
check('expect=not_exists 推出否定极性', neg.items[0].polarity === 'neg', neg.items[0])

// ── 核验三态 ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-commit-'))
const real = path.join(tmp, 'exists.txt')
fs.writeFileSync(real, 'x'.repeat(32))
const ghost = path.join(tmp, 'ghost.txt')

const io = { verifyClaims, verifyHostClaim, cfg: { portTimeoutMs: 400, moneyTolerance: 0.15 } }

const text = '```claims\n' + JSON.stringify([
  { kind: 'path', value: real, expect: 'exists' },       // PASS
  { kind: 'path', value: ghost, expect: 'exists' },      // INVALID
  { kind: 'filecount', value: { dir: tmp, n: 999 }, expect: 'exists' }, // INCONCLUSIVE（不支持的 kind 走 verifyClaims → checked=0）
  { kind: 'pid', value: process.pid, expect: 'exists' }, // HOST 路径 → PASS
]) + '\n```'

const parsed = parseCommitments(text)
check('解析 4 条承诺', parsed.items.length === 4, parsed.items.length)

const summary = await verifyCommitments(parsed.items, io)
console.log('三态:', JSON.stringify({ pass: summary.pass, invalid: summary.invalid, inconclusive: summary.inconclusive }))
check('有 PASS', summary.pass >= 2, summary.pass)
check('有 INVALID（不存在的路径）', summary.invalid >= 1, summary.invalid)
check('摘要只在有 INVALID 时给', summarize(summary).length > 0)

const allGood = parseCommitments('```claims\n' + JSON.stringify([{ kind: 'path', value: real, expect: 'exists' }]) + '\n```')
const s2 = await verifyCommitments(allGood.items, io)
check('全通过时摘要为空', summarize(s2) === '')

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
