import { cnToNumber, enToNumber, normalizeNumbers } from 'file:///C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/lib/numerals.js'

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')) }
}

// ── 中文数字 ──
check('十二 = 12', cnToNumber('十二') === 12, cnToNumber('十二'))
check('二十 = 20', cnToNumber('二十') === 20)
check('二十三 = 23', cnToNumber('二十三') === 23)
check('一百 = 100', cnToNumber('一百') === 100)
check('一百四十三 = 143', cnToNumber('一百四十三') === 143, cnToNumber('一百四十三'))
check('三千零八十 = 3080', cnToNumber('三千零八十') === 3080, cnToNumber('三千零八十'))
check('一万 = 10000', cnToNumber('一万') === 10000)
check('两万 = 20000', cnToNumber('两万') === 20000)
check('十万 = 100000', cnToNumber('十万') === 100000)
check('单字一 = 1', cnToNumber('一') === 1)
check('单字十 = 10', cnToNumber('十') === 10)
check('非数字返回 null', cnToNumber('你好') === null)
check('空返回 null', cnToNumber('') === null)

// ── 英文数字 ──
check('twelve = 12', enToNumber('twelve') === 12)
check('twenty three = 23', enToNumber('twenty three') === 23, enToNumber('twenty three'))
check('twenty-three = 23', enToNumber('twenty-three') === 23)
check('one hundred forty three = 143', enToNumber('one hundred forty three') === 143, enToNumber('one hundred forty three'))
check('two thousand twenty four = 2024', enToNumber('two thousand twenty four') === 2024)
check('非数字返回 null', enToNumber('hello world') === null)
check('停用词不干扰', enToNumber('the twenty third day') === 23, enToNumber('the twenty third day'))

// ── 文本替换 ──
check('中文句子替换', normalizeNumbers('十二乘以十二') === '12乘以12', normalizeNumbers('十二乘以十二'))
check('单字一不动', normalizeNumbers('等一下看') === '等一下看', normalizeNumbers('等一下看'))
check('中文句子替换2', normalizeNumbers('一百四十三') === '143')
check('英文替换', normalizeNumbers('twelve times twelve') === '12 times 12', normalizeNumbers('twelve times twelve'))
check('普通英文不动', normalizeNumbers('the quick brown fox') === 'the quick brown fox', normalizeNumbers('the quick brown fox'))

console.log(`\n${pass}/${pass + fail} 通过`)
process.exit(fail === 0 ? 0 : 1)
