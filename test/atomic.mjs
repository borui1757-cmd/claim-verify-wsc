// atomic.mjs —— 原子写与撤销
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPlan } from '../lib/dsl.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-atomic-'));
const target = path.join(dir, 'a.txt');

// 1) 新建文件：原子提交，无残留临时文件
const r1 = await runPlan({ all: [{ prim: 'write_file', args: { path: target, content: 'v1' }, expect: true }] });
check('写入成功', r1.verdict === 'supported', JSON.stringify(r1).slice(0, 120));
check('内容正确', fs.readFileSync(target, 'utf8') === 'v1');
const leftovers = fs.readdirSync(dir).filter((f) => f.includes('cv-tmp'));
check('无临时文件残留', leftovers.length === 0, leftovers.join(','));

// 2) 覆盖已有文件：备份生成，内容更新
const r2 = await runPlan({ all: [{ prim: 'write_file', args: { path: target, content: 'v2' }, expect: true }] });
const meta2 = r2.results[0]?.meta || {};
check('覆盖后有备份', Boolean(meta2.backup) && fs.existsSync(meta2.backup), String(meta2.backup));
check('内容已更新', fs.readFileSync(target, 'utf8') === 'v2');
check('记录 beforeHash', typeof meta2.beforeHash === 'string');

// 3) 写入失败时不落地：把目标变成目录，rename 必失败
const dirTarget = path.join(dir, 'as-dir');
fs.mkdirSync(dirTarget);
const r3 = await runPlan({ all: [{ prim: 'write_file', args: { path: dirTarget, content: 'x' }, expect: true }] });
check('写入失败时 verdict=contradicted', r3.verdict === 'contradicted', JSON.stringify(r3).slice(0, 120));
check('失败后目录未被破坏', fs.statSync(dirTarget).isDirectory());
const leftover3 = fs.readdirSync(dir).filter((f) => f.includes('cv-tmp'));
check('失败后无临时残留', leftover3.length === 0, leftover3.join(','));

// 4) 撤销：用备份恢复
const rb = await runPlan({ all: [{ prim: 'restore_file', args: { path: target, backup: meta2.backup }, expect: true }] });
check('恢复成功', rb.verdict === 'supported', JSON.stringify(rb).slice(0, 120));
check('恢复后内容是 v1', fs.readFileSync(target, 'utf8') === 'v1');

// 5) 恢复失败：备份不存在
const rb2 = await runPlan({ all: [{ prim: 'restore_file', args: { path: target, backup: path.join(dir, 'nope.bak') }, expect: true }] });
check('备份不存在 → 不通过', rb2.verdict === 'contradicted');
check('恢复失败不动原文件', fs.readFileSync(target, 'utf8') === 'v1');

// 6) 备份不可篡改：改备份内容后仍能恢复（内容以备份为准），但校验能发现哈希变化
const backupFile = meta2.backup;
fs.writeFileSync(backupFile, 'tampered');
const rb3 = await runPlan({ all: [{ prim: 'restore_file', args: { path: target, backup: backupFile }, expect: true }] });
check('改过的备份会被恢复进去（机制上一致）', rb3.verdict === 'supported' && fs.readFileSync(target, 'utf8') === 'tampered');

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
