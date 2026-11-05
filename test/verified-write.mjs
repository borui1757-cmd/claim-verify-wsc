// verified-write.mjs —— 工具形态的器官：写入与核验同一工具
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeVerified } from '../lib/verified-write.js';
import { handleMessage } from '../lib/mcp-core.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-vw-'));
const target = path.join(dir, 'a.txt');

// 正常写入
const r1 = writeVerified({ path: target, content: 'hello' });
check('写入返回 ok', r1.ok === true, JSON.stringify(r1));
check('文件真实存在', fs.existsSync(target));
check('verified.exists 为真', r1.verified.exists === true);
check('返回 sha256', typeof r1.sha256 === 'string' && r1.sha256.length === 64);
check('返回字节数', r1.bytes === 5, String(r1.bytes));
check('路径是绝对路径', path.isAbsolute(r1.path));

// 覆盖写入
const r2 = writeVerified({ path: target, content: 'hello world' });
check('覆盖后内容正确', fs.readFileSync(target, 'utf8') === 'hello world');
check('覆盖后字节数更新', r2.bytes === 11, String(r2.bytes));

// 父目录不存在 → 不静默成功
const bad = path.join(dir, 'no-such-dir', 'x.txt');
const r3 = writeVerified({ path: bad, content: 'x' });
check('父目录不存在 → ok 为 false', r3.ok === false, JSON.stringify(r3));
check('父目录不存在 → verified 给出原因', typeof r3.verified.reason === 'string' && r3.verified.reason.includes('父目录'), JSON.stringify(r3.verified));
check('父目录未被自动创建', !fs.existsSync(path.dirname(bad)));

// createDirs
const deep = path.join(dir, 'x', 'y', 'z.txt');
const r4 = writeVerified({ path: deep, content: 'deep', createDirs: true });
check('createDirs 能创建目录', r4.ok === true && fs.existsSync(deep), JSON.stringify(r4));

// 空内容
const empty = path.join(dir, 'empty.txt');
const r5 = writeVerified({ path: empty, content: '' });
check('空内容也能写', r5.ok === true && r5.bytes === 0, JSON.stringify(r5));

// MCP 工具层
const list = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
check('MCP 暴露 3 个工具', list.result.tools.length === 3, String(list.result.tools.length));
check('工具名含 write_verified', list.result.tools.some((t) => t.name === 'write_verified'));

const call = await handleMessage({
  jsonrpc: '2.0', id: 2, method: 'tools/call',
  params: { name: 'write_verified', arguments: { path: path.join(dir, 'mcp.txt'), content: 'via mcp' } },
});
const payload = JSON.parse(call.result.content[0].text);
check('MCP 调用返回 verified 块', payload.verified && payload.verified.exists === true, JSON.stringify(payload));
check('MCP 写入真实落盘', fs.readFileSync(path.join(dir, 'mcp.txt'), 'utf8') === 'via mcp');

const badCall = await handleMessage({
  jsonrpc: '2.0', id: 3, method: 'tools/call',
  params: { name: 'write_verified', arguments: { content: 'no path' } },
});
check('缺 path → isError', badCall.result.isError === true);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
