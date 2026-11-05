// metamorphic.mjs —— 蜕变测试：不依赖金标，只检验"输入变换后结论必须如何"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractEvidence, decideClaims } from '../lib/isolated-audit.js';
import { validatePlan, runPlan } from '../lib/dsl.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const mkWrite = (p, err = false) => ({ name: 'write', callId: 'w-' + Math.random().toString(36).slice(2, 8), args: { file_path: p }, isError: err, resultSeen: true, text: err ? 'EACCES' : 'ok' });
const mkCmd = (c, err = false) => ({ name: 'pwsh', callId: 'c-' + Math.random().toString(36).slice(2, 8), args: { command: c }, isError: err, resultSeen: true, text: err ? 'FAIL' : 'ok' });

const claim = { sentence: '写入了目标', kind: 'write', target: 'C:\\Users\\x\\a.txt' };
const basePairs = [mkWrite('C:\\Users\\x\\a.txt')];
const decide = (pairs, c = claim) => decideClaims([c], extractEvidence(pairs))[0].verdict;

// MR1 顺序置换不变
check('MR1 顺序置换不改结论', decide(basePairs) === decide([...basePairs].reverse()));
// MR2 追加无关动作不变
check('MR2 追加无关命令不改结论', decide([...basePairs, mkCmd('node other.js')]) === decide(basePairs));
// MR3 重复动作不变
check('MR3 重复同一动作不改结论', decide([...basePairs, basePairs[0], basePairs[0]]) === decide(basePairs));
// MR4 路径大小写/斜杠归一
check('MR4 路径大小写/斜杠归一', decide(basePairs, { ...claim, target: 'c:/users/X/A.TXT' }) === 'supported');
// MR5 插入失败但无关的动作不改变结论
check('MR5 无关失败动作不影响', decide([...basePairs, mkWrite('C:\\Users\\x\\other.txt', true)]) === 'supported');
// MR6 翻转证据则结论翻转（supported → contradicted）
check('MR6 证据翻转 → 结论翻转', decide([mkWrite('C:\\Users\\x\\a.txt', true)]) === 'contradicted');
// MR7 删除证据则弃权（不是判否定）
check('MR7 删除证据 → 弃权', decide([]) === 'insufficient');
// MR8 DSL：追加无关检查不改变 supported
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-mm-'));
const f = path.join(dir, 'a.txt');
fs.writeFileSync(f, 'x');
const p1 = await runPlan({ all: [{ prim: 'exists', args: { path: f }, expect: true }] });
const p2 = await runPlan({ all: [{ prim: 'exists', args: { path: f }, expect: true }, { prim: 'math_eq', args: { expr: '1+1', value: 2 }, expect: true }] });
check('MR8 追加无关检查不改判定', p1.verdict === p2.verdict && p1.verdict === 'supported');
// MR9 计划里检查顺序无关
const p3 = await runPlan({ all: [{ prim: 'math_eq', args: { expr: '1+1', value: 2 }, expect: true }, { prim: 'exists', args: { path: f }, expect: true }] });
check('MR9 检查顺序无关', p3.verdict === 'supported');

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
