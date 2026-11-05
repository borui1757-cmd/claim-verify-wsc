// mutation.mjs —— 变异测试：故意改坏证据/声明，检查判定的变化是否符合预期
import { extractEvidence, decideClaims } from '../lib/isolated-audit.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const write = (p, err = false, resultSeen = true) => ({ name: 'write', callId: 'w1', args: { file_path: p }, isError: err, resultSeen, text: err ? 'FAIL' : 'ok' });
const claim = { sentence: '写好了', kind: 'write', target: 'C:\\a\\b.txt' };
const decide = (pairs) => decideClaims([claim], extractEvidence(pairs))[0].verdict;

let killed = 0;
let total = 0;
const mutant = (name, pairs, expect) => {
  total += 1;
  const got = decide(pairs);
  const ok = got === expect;
  if (ok) killed += 1;
  check(`${name}（期望 ${expect}，得到 ${got}）`, ok);
};

// 原始体：应 supported
check('原始体 → supported', decide([write('C:\\a\\b.txt')]) === 'supported');

// 变异体
mutant('M1 翻转 isError', [write('C:\\a\\b.txt', true)], 'contradicted');
mutant('M2 删除写入调用', [], 'insufficient');
mutant('M3 去掉 resultSeen', [write('C:\\a\\b.txt', false, false)], 'insufficient');
mutant('M4 改路径', [write('C:\\a\\OTHER.txt')], 'insufficient');
mutant('M5 改成失败文本（无 isError）', [{ name: 'write', callId: 'w1', args: { file_path: 'C:\\a\\b.txt' }, isError: false, resultSeen: true, text: 'Error: permission denied' }], 'contradicted');

// mutation score
const score = total ? (killed / total) * 100 : 0;
check(`变异得分 ${score.toFixed(0)}%（≥80% 视为充分）`, score >= 80);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
