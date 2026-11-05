// coverage.mjs —— 声明覆盖率：声明了多少、漏了多少
import { actualActions, declaredCoverage, coverageSummary } from '../lib/coverage.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const pairs = [
  { name: 'write', callId: 'w1', args: { file_path: 'C:\\a\\one.txt' }, isError: false, resultSeen: true },
  { name: 'write', callId: 'w2', args: { file_path: 'C:\\a\\two.txt' }, isError: true, resultSeen: true },
  { name: 'pwsh', callId: 'c1', args: { command: 'npm test' }, isError: false, resultSeen: true },
  { name: 'read', callId: 'r1', args: { file_path: 'C:\\a\\x' }, isError: false, resultSeen: true },
];

const actual = actualActions(pairs);
check('只统计写/命令，不算读', actual.length === 3 && actual.every((a) => a.kind === 'write' || a.kind === 'cmd'));

const cov1 = declaredCoverage({ pairs, claims: [{ kind: 'write', target: 'c:/A/ONE.TXT' }, { kind: 'cmd', target: 'npm test' }] });
check('路径归一化后能对上', cov1.matched === 2, JSON.stringify(cov1));
check('未声明的是失败的那次写', cov1.undeclared.length === 1 && cov1.undeclared[0].callId === 'w2');
check('覆盖率 2/3 ≈ 0.667', Math.abs(cov1.coverage - 0.667) < 0.01, String(cov1.coverage));

const cov2 = declaredCoverage({ pairs, claims: [] });
check('什么都没声明 → 覆盖 0', cov2.matched === 0 && cov2.coverage === 0 && cov2.undeclared.length === 3);

const cov3 = declaredCoverage({ pairs: [], claims: [{ kind: 'write', target: 'C:\\a' }] });
check('没有实际动作 → coverage null', cov3.coverage === null && cov3.actual === 0);

const cov4 = declaredCoverage({ pairs, claims: [{ kind: 'write', target: 'C:\\other\\x.txt' }] });
check('声明了不存在的动作 → 不计入', cov4.matched === 0 && cov4.undeclared.length === 3);

check('摘要文字可读', /实际动作 3 个/.test(coverageSummary(cov1)));

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
