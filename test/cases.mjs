// cases.mjs —— 案例留档的纯函数测试
import { makeCase, pairsOfCase } from '../lib/cases.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const pairs = [
  { name: 'write', callId: 'w1', turn: 3, args: { file_path: 'C:\\a.txt' }, isError: false, resultSeen: true, text: 'ok' },
  { name: 'pwsh', callId: 'c1', turn: 3, args: { command: 'npm test' }, isError: true, resultSeen: true, text: 'FAIL' },
];
const c = makeCase({ sessionId: 's1', turn: 3, report: 'x'.repeat(5000), pairs });

check('保留会话与轮次', c.sessionId === 's1' && c.turn === 3);
check('报告截断到 4000 字', c.report.length === 4000);
check('pairs 数量保留', c.pairs.length === 2);
check('pairs 字段齐全', c.pairs[1].name === 'pwsh' && c.pairs[1].isError === true && c.pairs[1].args.command === 'npm test');
check('pair 文本截断', makeCase({ report: 'r', pairs: [{ name: 'x', text: 'y'.repeat(900) }] }).pairs[0].text.length === 600);

const back = pairsOfCase(c);
check('还原出可用的 pairs', back.length === 2 && back[0].name === 'write');
check('pairsOfCase 对空值安全', pairsOfCase(null).length === 0 && pairsOfCase({}).length === 0);
check('还原的是副本（改副本不影响原案例）', (() => { back[0].name = 'mutated'; return c.pairs[0].name === 'write'; })());

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
