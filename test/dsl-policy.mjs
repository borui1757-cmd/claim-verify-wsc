// dsl-policy.mjs —— 执行前授权闸门（对标 SOF authorization boundary）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePolicy, checkPlan, policyHash, defaultPolicy } from '../lib/policy.js';
import { runPlan } from '../lib/dsl.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-pol-'));
const file = path.join(dir, 'a.txt');
fs.writeFileSync(file, 'hello');
const plan = { all: [{ prim: 'exists', args: { path: file }, expect: true }] };

// 策略校验
check('默认策略合法', validatePolicy(defaultPolicy()).ok === true);
check('default 非法值被拒', validatePolicy({ default: 'maybe' }).ok === false);
check('规则取值非法被拒', validatePolicy({ rules: { exists: 'yolo' } }).ok === false);
check('多余字段被拒', validatePolicy({ default: 'allow', extra: 1 }).ok === false);

// 哈希稳定
check('同策略同哈希', policyHash({ default: 'allow', rules: { exists: 'allow' } }) === policyHash({ rules: { exists: 'allow' }, default: 'allow' }));
check('不同策略不同哈希', policyHash({ default: 'allow' }) !== policyHash({ default: 'deny' }));

// 决策
const d1 = checkPlan(plan, { default: 'allow' });
check('全放行 → blocked=false', d1.blocked === false && d1.decisions[0].decision === 'allow');
const d2 = checkPlan(plan, { default: 'deny' });
check('全禁止 → blocked=true', d2.blocked === true && d2.decisions[0].decision === 'deny');
const d3 = checkPlan(plan, { default: 'allow', rules: { exists: 'pending' } });
check('按原语覆盖为 pending', d3.blocked === true && d3.decisions[0].decision === 'pending');

// 执行：被拦就不跑
const rAllowed = await runPlan(plan, { policy: { default: 'allow' } });
check('放行时正常判定', rAllowed.verdict === 'supported' && rAllowed.policy === undefined);
const rDenied = await runPlan(plan, { policy: { default: 'deny' } });
check('禁止时不执行 → insufficient', rDenied.verdict === 'insufficient' && /策略未放行/.test(rDenied.reason));
check('禁止时带上策略哈希', typeof rDenied.policy?.hash === 'string' && rDenied.policy.hash.length === 64);
check('禁止时 results 为空', Array.isArray(rDenied.results) && rDenied.results.length === 0);

const rPending = await runPlan(plan, { policy: { default: 'allow', rules: { exists: 'pending' } } });
check('pending 也视为未放行', rPending.verdict === 'insufficient' && /pending/.test(rPending.reason));

// 不传策略 = 全放行（向后兼容）
const rNoPolicy = await runPlan(plan);
check('不传策略仍能跑（兼容旧行为）', rNoPolicy.verdict === 'supported');

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败无所谓 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
