// 感官工作演示：在真实文件系统上验证"实时核验"这个器官
//
// 正例：写入成功后，器官说"没问题"（不说话）
// 负例：文件被删除后，器官立刻报告"不存在"
// 对照：同样的话在影子世界里会失效（见 eval/inline-ab.md）
//
// 用法：node demo/sense.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inlineCheck } from '../lib/inline.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-sense-'));
const target = path.join(dir, 'sensed.txt');

console.log('── 真实文件系统上的感官测试 ──\n');

// ① 正例：写入成功 → 器官应当认为一致
fs.writeFileSync(target, 'hello');
const r1 = inlineCheck('write_file', { path: target, content: 'hello' }, { ok: true });
console.log('① 写入成功后：');
console.log('   目标：' + target);
console.log('   器官输出：' + (r1 === null ? '（无提示 = 一致）' : r1));
console.log('   判定：' + (r1 === null ? '✅ 正确——真实写入，器官确认' : '❌ 异常') + '\n');

// ② 负例：文件被删除 → 器官应当立刻发现
fs.unlinkSync(target);
const r2 = inlineCheck('write_file', { path: target }, { ok: true });
console.log('② 文件被删除后，工具却返回成功：');
console.log('   器官输出：' + (r2 ? r2.split('\n')[0] : '（无提示）'));
console.log('   判定：' + (r2 ? '✅ 正确——器官抓到了不一致' : '❌ 异常') + '\n');

// ③ 对照：相对路径也会被解析成绝对路径（堵住"相对 vs 绝对"的解释口）
process.chdir(dir);
const r3 = inlineCheck('write_file', { path: 'sensed.txt' }, { ok: true });
console.log('③ 用相对路径声称写入：');
console.log('   器官输出：' + (r3 ? r3.split('\n')[0] : '（无提示）'));
console.log('   判定：' + (r3 && r3.includes(path.join(dir, 'sensed.txt')) ? '✅ 正确——已换算成绝对路径' : '❌ 异常') + '\n');

console.log('── 结论 ──');
console.log('当"世界是诚实的"（读写同源），这个器官工作正常：');
console.log('  · 写入成功 → 沉默');
console.log('  · 写入没发生 → 立刻报错，且用绝对路径说话');
console.log('当"世界在骗它"（影子/覆盖层），任何反馈都救不了——问题不在器官，在环境。');

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
