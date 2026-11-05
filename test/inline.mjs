// inline.mjs —— 工具结果边界的实时核验（写类 + shell）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  targetPathOf, shouldInlineCheck, inlineCheck, appendToToolContent, expectationsFromCommand,
} from '../lib/inline.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-inl-'));
const real = path.join(dir, 'a.txt');
fs.writeFileSync(real, 'x');
const missing = path.join(dir, 'nope.txt');

// ── 路径提取
check('取 path 字段', targetPathOf({ path: real }) === real);
check('取 file_path 字段', targetPathOf({ file_path: real }) === real);
check('无路径返回 null', targetPathOf({ content: 'x' }) === null);

// ── 写类工具
check('write_file → 核验', shouldInlineCheck('write_file', { path: real }, {}) === true);
check('edit_file → 核验', shouldInlineCheck('edit_file', { path: real }, {}) === true);
check('read_file → 不核验', shouldInlineCheck('read_file', { path: real }, {}) === false);
check('工具已报错 → 不重复核验', shouldInlineCheck('write_file', { path: real }, { isError: true }) === false);
check('文件存在 → 无提示', inlineCheck('write_file', { path: missing.replace('nope', 'a') }, {}) === null);
const wNote = inlineCheck('write_file', { path: missing }, {});
check('文件不存在 → 有提示', Boolean(wNote) && wNote.includes('不存在'), String(wNote));
check('提示含绝对路径', Boolean(wNote) && wNote.includes(missing));

// ── shell 命令的期望推断
const e1 = expectationsFromCommand('echo hi > out.txt');
check('重定向 → 期望存在', e1.some((x) => x.expectExists && /out\.txt$/.test(x.path)), JSON.stringify(e1));
const e2 = expectationsFromCommand('echo hi >> out.txt');
check('追加重定向 → 期望存在', e2.some((x) => x.expectExists && /out\.txt$/.test(x.path)), JSON.stringify(e2));
const e3 = expectationsFromCommand('echo hi | tee log.txt');
check('tee → 期望存在', e3.some((x) => x.expectExists && /log\.txt$/.test(x.path)), JSON.stringify(e3));
const e4 = expectationsFromCommand('mkdir newdir');
check('mkdir → 期望存在', e4.some((x) => x.expectExists && /newdir$/.test(x.path)), JSON.stringify(e4));
const e5 = expectationsFromCommand('rm old.txt');
check('rm → 期望不存在', e5.some((x) => !x.expectExists && /old\.txt$/.test(x.path)), JSON.stringify(e5));
const e6 = expectationsFromCommand('del old.txt');
check('del → 期望不存在', e6.some((x) => !x.expectExists && /old\.txt$/.test(x.path)), JSON.stringify(e6));
const e7 = expectationsFromCommand('Get-Date');
check('无副作用命令 → 空', e7.length === 0, JSON.stringify(e7));
const e8 = expectationsFromCommand('cmd > /dev/null');
check('忽略 /dev/null', e8.length === 0, JSON.stringify(e8));
const e9 = expectationsFromCommand('cmd > nul');
check('忽略 nul', e9.length === 0, JSON.stringify(e9));
check('最多 3 条期望', expectationsFromCommand('a > 1.txt & b > 2.txt & c > 3.txt & d > 4.txt').length <= 3);

// ── shell 工具的实时核验
check('shell 有副作用命令 → 核验', shouldInlineCheck('pwsh', { command: 'echo x > t.txt' }, {}) === true);
check('shell 无副作用命令 → 不核验', shouldInlineCheck('pwsh', { command: 'Get-Date' }, {}) === false);

process.chdir(dir);
const sNote = inlineCheck('pwsh', { command: 'echo x > missing_out.txt' }, {});
check('shell 声称写入但没发生 → 有提示', Boolean(sNote) && sNote.includes('不存在'), String(sNote));

const delTarget = path.join(dir, 'keep.txt');
fs.writeFileSync(delTarget, 'x');
const sNote2 = inlineCheck('pwsh', { command: `rm "${delTarget}"` }, {});
check('shell 声称删除但文件还在 → 有提示', Boolean(sNote2) && sNote2.includes('仍然存在'), String(sNote2));

// ── 追加到工具结果
check('字符串形态追加', (() => { const s = appendToToolContent('ok', '提示'); return typeof s === 'string' && s.includes('提示'); })());
check('数组形态追加', (() => { const a = appendToToolContent([{ type: 'text', text: 'ok' }], '提示'); return Array.isArray(a) && a.length === 2 && a[1].text.includes('提示'); })());
check('空内容返回 null', appendToToolContent(null, 'x') === null);
check('无提示返回 null', appendToToolContent('ok', '') === null);
check('数组无 text 返回 null', appendToToolContent([{ type: 'image' }], 'x') === null);

// ── 不抛错
check('异常路径不抛错', (() => { try { inlineCheck('write_file', { path: 'Z:\\no\\such\\dir\\x' }, {}); return true; } catch { return false; } })());

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
