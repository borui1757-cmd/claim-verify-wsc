// outcomes.mjs —— 干预与结果关联
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeOutcomeLog } from '../lib/outcomes.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-oc-'));
const file = path.join(dir, 'outcomes.jsonl');
const log = makeOutcomeLog(file);

const id = log.intervention('s1', { target: 'pwsh|x', text: '核验失败' });
check('干预返回 id', typeof id === 'string' && id.length > 3, id);
check('有待跟进', log.pendingCount() === 1);

const closed = log.userMessage('s1');
check('用户消息结掉干预', closed === id);
check('跟进后无挂起', log.pendingCount() === 0);

// 没有干预时用户消息不产生 outcome
check('无干预时不写 outcome', log.userMessage('s1') === null);

// 超时清扫
log.intervention('s2', { target: 't' });
log.sweep(Date.now() + 11 * 60 * 1000);
check('超时被清理', log.pendingCount() === 0);

const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
check('写出 intervention 行', rows.some((r) => r.event === 'intervention'));
check('写出 user_message 结果行', rows.some((r) => r.event === 'outcome' && r.kind === 'user_message'));
check('写出 no_followup 结果行', rows.some((r) => r.event === 'outcome' && r.kind === 'no_followup'));
check('结果行带 afterMs', rows.filter((r) => r.event === 'outcome').every((r) => Number.isFinite(r.afterMs)));

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
