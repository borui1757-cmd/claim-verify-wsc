// adapter.mjs —— 端到端对接测试：模拟别人的 TaskState → 我们的判定 → 干预建议
import { adjudicate, shouldIntervene, factsToPairs } from '../lib/adapter.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const target = 'C:\\work\\out.txt';

// ① 真写了：有成功写入记录
const facts1 = { writes: [{ path: target, isError: false }], cmds: [], tests: { run: false, passed: null } };
const r1 = adjudicate(facts1, { kind: 'write', target });
check('真写了 → supported', r1.verdict === 'supported', JSON.stringify(r1));
check('supported 不干预', shouldIntervene(r1.verdict) === false);

// ② 没写成：只有失败写入
const facts2 = { writes: [{ path: target, isError: true }] };
const r2 = adjudicate(facts2, { kind: 'write', target });
check('没写成 → contradicted', r2.verdict === 'contradicted', JSON.stringify(r2));
check('contradicted 要干预', shouldIntervene(r2.verdict) === true);

// ③ 根本没提这个文件
const facts3 = { writes: [{ path: 'C:\\work\\other.txt', isError: false }] };
const r3 = adjudicate(facts3, { kind: 'write', target });
check('没记录 → insufficient', r3.verdict === 'insufficient', JSON.stringify(r3));
check('insufficient 不干预（默认放行）', shouldIntervene(r3.verdict) === false);

// ④ 说测试通过，但没跑过
const facts4 = { cmds: [], tests: { run: false, passed: null } };
const r4 = adjudicate(facts4, { kind: 'test', target: 'npm test' });
check('说通过但没跑 → contradicted', r4.verdict === 'contradicted', JSON.stringify(r4));

// ⑤ 测试跑了但失败
const facts5 = { tests: { run: true, passed: false } };
const r5 = adjudicate(facts5, { kind: 'test' });
check('测试失败 → contradicted', r5.verdict === 'contradicted', JSON.stringify(r5));

// ⑥ 测试跑了，退出码无法归属 → 弃权
const facts6 = { tests: { run: true, passed: null } };
const r6 = adjudicate(facts6, { kind: 'test' });
check('退出码不可归属 → insufficient', r6.verdict === 'insufficient', JSON.stringify(r6));

// ⑦ 命令被包装语句掩盖 → 弃权
const facts7 = { cmds: [{ cmd: 'npm test; Write-Output "after"', text: 'all good' }] };
const r7 = adjudicate(facts7, { kind: 'cmd', target: 'npm test' });
check('包装命令 → insufficient', r7.verdict === 'insufficient', JSON.stringify(r7));

// ⑧ 命令可归属且成功
const facts8 = { cmds: [{ cmd: 'npm test', text: 'ok' }] };
const r8 = adjudicate(facts8, { kind: 'cmd', target: 'npm test' });
check('可归属命令 → supported', r8.verdict === 'supported', JSON.stringify(r8));

// ⑨ facts 转换保留字段
const pairs = factsToPairs(facts1);
check('factsToPairs 保留路径', pairs[0].args.path === target);
check('factsToPairs 保留 isError', factsToPairs(facts2)[0].isError === true);

// ⑩ 空 facts 不崩
const r10 = adjudicate({}, { kind: 'write', target });
check('空 facts → insufficient', r10.verdict === 'insufficient', JSON.stringify(r10));
check('无 claim 类型 → insufficient', adjudicate({}, {}).verdict === 'insufficient');

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
