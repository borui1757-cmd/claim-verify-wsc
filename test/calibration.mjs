// calibration.mjs —— B 自校准 / C 重复假声明
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordFact } from '../lib/worldmodel.js';
import { objectKey, historyOf, calibrationNote, repeatLiarNote } from '../lib/calibration.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-cal-'));
const file = path.join(dir, 'wm.jsonl');

// 对象键归一
check('路径归一大写/斜杠', objectKey('file', 'C:/A/B.TXT') === objectKey('file', 'c:\\a\\b.txt'));
check('命令空白归一', objectKey('cmd', 'npm   test') === objectKey('cmd', 'npm test'));

// 空账本
check('无历史 → total=0', historyOf('file', 'C:/x', { file }).total === 0);
check('样本不足 → 无校准提示', calibrationNote('file', 'C:/x', { file }) === null);
check('无历史 → 无重复提示', repeatLiarNote('file', 'C:/x', { file }) === null);

// B：3 次证伪 → 触发校准
for (let i = 0; i < 3; i += 1)
  recordFact({ kind: 'file', target: 'C:/x', verdict: 'contradicted', file, at: Date.now() });
const b = calibrationNote('file', 'C:/x', { file });
check('3 次证伪 → 有校准提示', Boolean(b) && b.includes('100%'), String(b));
check('提示含次数', Boolean(b) && b.includes('3 次'), String(b));

// 混合样本：2 支持 3 反对 → 60%
for (let i = 0; i < 2; i += 1)
  recordFact({ kind: 'file', target: 'C:/y', verdict: 'supported', file, at: Date.now() });
for (let i = 0; i < 3; i += 1)
  recordFact({ kind: 'file', target: 'C:/y', verdict: 'contradicted', file, at: Date.now() });
const b2 = calibrationNote('file', 'C:/y', { file });
check('混合样本触发校准', Boolean(b2) && b2.includes('60%'), String(b2));

// 低反驳率不触发
for (let i = 0; i < 5; i += 1)
  recordFact({ kind: 'file', target: 'C:/z', verdict: 'supported', file, at: Date.now() });
recordFact({ kind: 'file', target: 'C:/z', verdict: 'contradicted', file, at: Date.now() });
check('反驳率低 → 不提示', calibrationNote('file', 'C:/z', { file }) === null);

// C：重复证伪 ≥2 → 升级
const c1 = repeatLiarNote('file', 'C:/x', { file });
check('A 对象证伪 3 次 → 升级提示', Boolean(c1) && c1.includes('3 次'), String(c1));
const c2 = repeatLiarNote('file', 'C:/z', { file });
check('只证伪 1 次 → 不升级', c2 === null);

// 窗口：很旧的历史不算
const old = Date.now() - 30 * 24 * 3600 * 1000;
recordFact({ kind: 'file', target: 'C:/old', verdict: 'contradicted', file, at: old });
recordFact({ kind: 'file', target: 'C:/old', verdict: 'contradicted', file, at: old });
check('旧记录不计入 7 天窗口', calibrationNote('file', 'C:/old', { file }) === null);
check('但重复提示仍可见（无窗口限制）', Boolean(repeatLiarNote('file', 'C:/old', { file })));

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
