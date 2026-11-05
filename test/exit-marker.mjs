// exit-marker.mjs —— 回归测试：DSH 的失败标记是 "[exit code: N]"（带方括号与冒号）
// 注意：decideAlt 直接返回字符串 'supported' | 'contradicted' | 'insufficient'
import { decideAlt } from '../lib/decide-alt.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const pair = (text, extra = {}) => ({ name: 'pwsh', args: { command: 'npm test' }, text, isError: false, resultSeen: true, ...extra });
const claim = { kind: 'cmd', target: 'npm test' };

const r1 = decideAlt(claim, [pair('FAIL src/a.test.mjs\n\n[exit code: 1]')]);
check('识别 [exit code: 1]', r1 === 'contradicted', r1);

const r2 = decideAlt(claim, [pair('some output\n[exit code: 2]')]);
check('识别 [exit code: 2]', r2 === 'contradicted', r2);

const r3 = decideAlt(claim, [pair('all good\n12 passing')]);
check('成功不误判', r3 === 'supported', r3);

const r4 = decideAlt(claim, [pair('boom\nexit code: 1')]);
check('兼容无括号格式', r4 === 'contradicted', r4);

const r5 = decideAlt(claim, [pair('[exit code: 0]\nall good')]);
check('[exit code: 0] 不误判', r5 === 'supported', r5);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
