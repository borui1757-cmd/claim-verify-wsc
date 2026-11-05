// policy-build.mjs —— 从配置拼策略（dslPolicyDefault / Deny / Pending）
import { buildPolicy } from '../lib/index.js';
import { validatePolicy, checkPlan } from '../lib/policy.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const p1 = buildPolicy({ dslPolicyDefault: 'allow' });
check('默认全放行', p1.default === 'allow' && Object.keys(p1.rules).length === 0);
check('生成的是合法策略', validatePolicy(p1).ok === true);

const p2 = buildPolicy({ dslPolicyDefault: 'allow', dslPolicyDeny: 'file_contains, dir_count' });
check('deny 列表解析（含空格）', p2.rules.file_contains === 'deny' && p2.rules.dir_count === 'deny', JSON.stringify(p2.rules));

const p3 = buildPolicy({ dslPolicyDefault: 'allow', dslPolicyPending: 'write_file' });
check('pending 列表解析', p3.rules.write_file === 'pending', JSON.stringify(p3.rules));

const p4 = buildPolicy({ dslPolicyDefault: 'allow', dslPolicyDeny: 'write_file', dslPolicyPending: 'write_file' });
check('同原语既 deny 又 pending 时以 pending 为准（后写覆盖）', p4.rules.write_file === 'pending', JSON.stringify(p4.rules));

const p5 = buildPolicy({ dslPolicyDefault: 'bogus' });
check('非法 default 退回全放行', p5.default === 'allow' && validatePolicy(p5).ok === true);

const gate = checkPlan({ all: [{ prim: 'write_file', args: { path: 'C:\\a.txt', content: 'x' }, expect: true }] }, p3);
check('write_file 会被判 pending', gate.blocked === true && gate.decisions[0].decision === 'pending');

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
