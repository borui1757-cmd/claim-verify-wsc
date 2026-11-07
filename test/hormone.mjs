// hormone.mjs —— 激素式全局调制
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordFact } from '../lib/worldmodel.js';
import { vigilance, modulation, currentModulation } from '../lib/hormone.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-hor-'));
const file = path.join(dir, 'wm.jsonl');
const T = Date.now();

// 无数据
check('空账本 → 警觉度 null', vigilance({ file, now: T }).value === null);
check('无数据 → 按正常处理', currentModulation({ file, now: T }).level === 'unknown');

// 样本不足
recordFact({ kind: 'file', target: 'C:/a', verdict: 'contradicted', file, at: T - 1000 });
check('样本不足 → null', vigilance({ file, now: T, minSamples: 5 }).value === null);

// 低矛盾（1/8 = 0.125）→ 松懈
for (let i = 0; i < 7; i += 1)
  recordFact({ kind: 'file', target: `C:/ok${i}`, verdict: 'supported', file, at: T - 1000 });
const v1 = vigilance({ file, now: T });
check('警觉度 0.125', v1.value === 0.125, JSON.stringify(v1));
check('低警觉 → relaxed', modulation(v1.value).level === 'relaxed');
check('relaxed 用 soft', modulation(v1.value).feedbackLevel === 'soft');

// 中等（4 反 / 10 = 0.4）→ 正常
const f2 = path.join(dir, 'mid.jsonl');
for (let i = 0; i < 6; i += 1)
  recordFact({ kind: 'file', target: `C:/m${i}`, verdict: 'supported', file: f2, at: T - 1000 });
for (let i = 0; i < 4; i += 1)
  recordFact({ kind: 'file', target: `C:/mf${i}`, verdict: 'contradicted', file: f2, at: T - 1000 });
const v2 = vigilance({ file: f2, now: T });
check('警觉度 0.4', v2.value === 0.4, JSON.stringify(v2));
check('中警觉 → normal', modulation(v2.value).level === 'normal');
check('normal 用 firm', modulation(v2.value).feedbackLevel === 'firm');

// 高（8 反 / 10 = 0.8）→ 警觉
const f3 = path.join(dir, 'high.jsonl');
for (let i = 0; i < 2; i += 1)
  recordFact({ kind: 'file', target: `C:/h${i}`, verdict: 'supported', file: f3, at: T - 1000 });
for (let i = 0; i < 8; i += 1)
  recordFact({ kind: 'file', target: `C:/hf${i}`, verdict: 'contradicted', file: f3, at: T - 1000 });
const v3 = vigilance({ file: f3, now: T });
check('警觉度 0.8', v3.value === 0.8, JSON.stringify(v3));
check('高警觉 → alert', modulation(v3.value).level === 'alert');
check('alert 用 block', modulation(v3.value).feedbackLevel === 'block');
check('alert 容差更严', modulation(v3.value).tolerance < 1);

// 窗口：旧数据不算
const f4 = path.join(dir, 'old.jsonl');
for (let i = 0; i < 10; i += 1)
  recordFact({ kind: 'file', target: `C:/o${i}`, verdict: 'contradicted', file: f4, at: T - 10 * 24 * 3600 * 1000 });
check('窗口外不计入', vigilance({ file: f4, now: T }).value === null);

// currentModulation 一步到位
const cm = currentModulation({ file: f3, now: T });
check('currentModulation 带 vigilance', cm.level === 'alert' && cm.vigilance.samples === 10);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
