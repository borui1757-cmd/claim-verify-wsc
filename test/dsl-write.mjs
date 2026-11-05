// dsl-write.mjs —— 可写原语 write_file：备份、哈希、以及"pending 不执行"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePlan, runPlan } from '../lib/dsl.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-wr-'));
const target = path.join(dir, 'out.txt');
fs.writeFileSync(target, 'original content');

const plan = { all: [{ prim: 'write_file', args: { path: target, content: 'new content' }, expect: true }] };

check('write_file 计划合法', validatePlan(plan).ok === true, JSON.stringify(validatePlan(plan).errors));
check('content 超长被拒', validatePlan({ all: [{ prim: 'write_file', args: { path: target, content: 'x'.repeat(5000) }, expect: true }] }).ok === false);
check('相对路径被拒', validatePlan({ all: [{ prim: 'write_file', args: { path: 'a.txt', content: 'x' }, expect: true }] }).ok === false);

// 放行：写 + 备份 + 前后哈希
const r1 = await runPlan(plan, { policy: { default: 'allow', rules: {} } });
check('放行 → supported', r1.verdict === 'supported', JSON.stringify(r1));
check('文件内容已更新', fs.readFileSync(target, 'utf8') === 'new content');
const meta = r1.results?.[0]?.meta || {};
check('带 beforeHash/afterHash', typeof meta.beforeHash === 'string' && typeof meta.afterHash === 'string');
check('两个哈希不同（内容变了）', meta.beforeHash !== meta.afterHash);
check('原文件已备份', typeof meta.backup === 'string' && fs.existsSync(meta.backup));
check('备份内容是旧内容', meta.backup && fs.readFileSync(meta.backup, 'utf8') === 'original content');

// pending：不执行、文件不变
const before = fs.readFileSync(target, 'utf8');
const r2 = await runPlan(plan, { policy: { default: 'allow', rules: { write_file: 'pending' } } });
check('pending → insufficient', r2.verdict === 'insufficient');
check('pending 带策略决策', r2.policy?.decisions?.[0]?.decision === 'pending');
check('pending 时没有执行（文件未变）', fs.readFileSync(target, 'utf8') === before);
check('pending 时结果为空', (r2.results || []).length === 0);

// deny：同样不执行
const r3 = await runPlan(plan, { policy: { default: 'alllow', rules: { write_file: 'deny' } } });
check('deny → insufficient 且不执行', r3.verdict === 'insufficient' && fs.readFileSync(target, 'utf8') === before);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败无所谓 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
