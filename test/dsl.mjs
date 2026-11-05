// dsl.mjs —— 受限检查 DSL 的校验与执行
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePlan, runPlan, safeMath, PRIMS } from '../lib/dsl.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// 1. 校验器：拒绝非法计划
check('未知原语被拒', validatePlan({ all: [{ prim: 'rm_rf', args: {}, expect: true }] }).ok === false);
check('多余字段被拒', validatePlan({ all: [{ prim: 'exists', args: { path: 'C:\\a' }, expect: true, evil: 1 }] }).ok === false);
check('缺参数被拒', validatePlan({ all: [{ prim: 'exists', args: {}, expect: true }] }).ok === false);
check('参数类型错被拒', validatePlan({ all: [{ prim: 'port', args: { port: '8700' }, expect: true }] }).ok === false);
check('端口越界被拒', validatePlan({ all: [{ prim: 'port', args: { port: 70000 }, expect: true }] }).ok === false);
check('相对路径被拒', validatePlan({ all: [{ prim: 'exists', args: { path: 'etc/passwd' }, expect: true }] }).ok === false);
check('空计划被拒', validatePlan({ all: [] }).ok === false);
check('超过 6 条被拒', validatePlan({ all: Array.from({ length: 7 }, () => ({ prim: 'exists', args: { path: 'C:\\a' }, expect: true })) }).ok === false);
check('合法计划通过', validatePlan({ all: [{ prim: 'exists', args: { path: 'C:\\Windows' }, expect: true }] }).ok === true);

// 2. 安全算术
check('四则运算正确', safeMath('1873*4') === 7492);
check('括号与小数', safeMath('(1024/8)+0.5') === 128.5);
check('拒绝字母', (() => { try { safeMath('process.exit(1)'); return false; } catch { return true; } })());
check('拒绝尾部垃圾', (() => { try { safeMath('1+1;rm'); return false; } catch { return true; } })());

// 3. 执行：真实环境
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-dsl-'));
const f = path.join(dir, 'a.txt');
fs.writeFileSync(f, 'hello 世界');

const ok1 = await runPlan({ all: [{ prim: 'exists', args: { path: f }, expect: true }] });
check('存在的文件 → supported', ok1.verdict === 'supported', JSON.stringify(ok1));

const bad1 = await runPlan({ all: [{ prim: 'exists', args: { path: path.join(dir, 'nope.txt') }, expect: true }] });
check('不存在的文件 → contradicted', bad1.verdict === 'contradicted');

const c1 = await runPlan({ all: [{ prim: 'file_contains', args: { path: f, text: '世界' }, expect: true }] });
check('文件包含内容 → supported', c1.verdict === 'supported');
const c2 = await runPlan({ all: [{ prim: 'file_contains', args: { path: f, text: '不存在的文字' }, expect: true }] });
check('文件不含内容 → contradicted', c2.verdict === 'contradicted');

const m1 = await runPlan({ all: [{ prim: 'math_eq', args: { expr: '1024/8', value: 128 }, expect: true }] });
check('算式正确 → supported', m1.verdict === 'supported');
const m2 = await runPlan({ all: [{ prim: 'math_eq', args: { expr: '1873*4', value: 7000 }, expect: true }] });
check('算式错误 → contradicted', m2.verdict === 'contradicted');

const p1 = await runPlan({ all: [{ prim: 'proc_alive', args: { pid: process.pid }, expect: true }] });
check('当前进程存活 → supported', p1.verdict === 'supported', JSON.stringify(p1));

const port1 = await runPlan({ all: [{ prim: 'port', args: { port: 64164 }, expect: true }] });
check('没人监听的端口 → contradicted', port1.verdict === 'contradicted');

// 4. 无法评估 → insufficient（不瞎判）
const ins = await runPlan({ all: [{ prim: 'file_contains', args: { path: path.join(dir, 'missing.txt'), text: 'x' }, expect: true }] });
check('读不到文件 → insufficient（不是 contradicted）', ins.verdict === 'insufficient', JSON.stringify(ins));

// 5. 非法计划不执行
const illegal = await runPlan({ all: [{ prim: 'exec', args: { cmd: 'whoami' }, expect: true }] });
check('非法计划不执行 → insufficient', illegal.verdict === 'insufficient' && /不合法/.test(illegal.reason));

check('原语表包含 7 个只读原语', Object.keys(PRIMS).length >= 7, Object.keys(PRIMS).join(','));try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败无所谓 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
