// build-id.mjs —— 源码指纹稳定性
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeBuildId, BUILD_ID } from '../lib/build-id.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

check('BUILD_ID 是 12 位十六进制', /^[0-9a-f]{12}$/.test(BUILD_ID), BUILD_ID);
check('同一目录两次计算一致', computeBuildId() === computeBuildId());

// 内容变 → 哈希变
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-bid-'));
fs.writeFileSync(path.join(dir, 'a.js'), 'export const a = 1;\n');
const h1 = computeBuildId(dir);
fs.writeFileSync(path.join(dir, 'a.js'), 'export const a = 2;\n');
const h2 = computeBuildId(dir);
check('文件内容变化会改变指纹', h1 !== h2, `${h1} vs ${h2}`);

// 文件名变 → 哈希变
fs.writeFileSync(path.join(dir, 'b.js'), 'export const b = 1;\n');
const h3 = computeBuildId(dir);
check('新增文件会改变指纹', h2 !== h3);

// 只哈希 .js
fs.writeFileSync(path.join(dir, 'c.txt'), 'ignored');
check('忽略非 .js 文件', computeBuildId(dir) === h3);

// 目录不存在不抛
check('目录不存在返回 unknown', computeBuildId(path.join(dir, 'nope')) === 'unknown');

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
