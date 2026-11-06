// memory.mjs —— 真值记忆的六条规则
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeMemory } from '../lib/memory.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-mem-'));
const file = path.join(dir, 'mem.jsonl');
const mem = makeMemory(file);

// ① 基本写入读取
mem.set({ key: 'C:\\a.txt', value: { exists: true, size: 36 }, source: 'os', at: 1000 });
check('写入后可读', mem.get('C:\\a.txt').value.size === 36);

// ② 冲突优先级：os > observation > inference
mem.set({ key: 'C:\\b.txt', value: 'inferred', source: 'inference', at: 2000 });
mem.set({ key: 'C:\\b.txt', value: 'observed', source: 'observation', at: 2001 });
check('observation 覆盖 inference', mem.get('C:\\b.txt').value === 'observed');
mem.set({ key: 'C:\\b.txt', value: 'os-truth', source: 'os', at: 2100 });
check('os 覆盖 observation', mem.get('C:\\b.txt').value === 'os-truth');
mem.set({ key: 'C:\\b.txt', value: 'later-inference', source: 'inference', at: 2200 });
check('低优先级不能覆盖高优先级', mem.get('C:\\b.txt').value === 'os-truth');

// ③ 双时态失效
mem.invalidate('C:\\b.txt', { at: 3000 });
check('失效后查不到', mem.get('C:\\b.txt') === null);
mem.set({ key: 'C:\\b.txt', value: 'reborn', source: 'os', at: 3100 });
check('失效后可重新写入', mem.get('C:\\b.txt').value === 'reborn');

// ④ 作用域过滤
mem.set({ key: 'k', value: 'proj', scope: 'project', at: 4000 });
mem.set({ key: 'k', value: 'glob', scope: 'global', at: 4001 });
check('按作用域取值', mem.get('k', 'project').value === 'proj' && mem.get('k', 'global').value === 'glob');

// ⑤ 注入断言化
const r = mem.render('C:\\a.txt');
check('注入是断言句式', typeof r === 'string' && r.includes('【系统记录】') && !r.includes('可能'), r);

// ⑥ 失败计数
mem.markFailure('C:\\a.txt', '模型辩论账本');
check('失败计数为 1', mem.failureCount('C:\\a.txt') === 1);
mem.markFailure('C:\\a.txt');
check('失败计数累加', mem.failureCount('C:\\a.txt') === 2);

// 边界
check('不存在的键返回 null', mem.get('nope') === null);
check('render 不存在返回 null', mem.render('nope') === null);
let threw = false;
try { mem.set({ value: 'x' }); } catch { threw = true; }
check('缺 key 抛错', threw);

// 日志是追加式的（不覆盖旧行）
const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
check('日志为追加式', lines.length >= 10, String(lines.length));

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
