// mcp.mjs —— MCP 协议核心
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleMessage, TOOLS, PROTOCOL_VERSION } from '../lib/mcp-core.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// initialize
const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
check('initialize 返回协议版本', init.result.protocolVersion === PROTOCOL_VERSION);
check('initialize 声明 tools 能力', Boolean(init.result.capabilities.tools));
check('serverInfo 有名字', init.result.serverInfo.name === 'claim-verify-wsc');

// notifications/initialized 无响应
check('initialized 通知无响应', (await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })) === null);

// tools/list
const list = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
check('tools/list 返回 2 个工具', list.result.tools.length === 2, String(list.result.tools.length));
check('工具名正确', list.result.tools.map((t) => t.name).join(',') === 'check_path,check_claim');
check('每个工具有 inputSchema', list.result.tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'));

// check_path：存在的文件
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-mcp-'));
const f = path.join(dir, 'a.txt');
fs.writeFileSync(f, 'x');
const r1 = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'check_path', arguments: { path: f } } });
const p1 = JSON.parse(r1.result.content[0].text);
check('check_path 存在的文件 → true', p1.exists === true, JSON.stringify(p1));

const r2 = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'check_path', arguments: { path: path.join(dir, 'nope.txt') } } });
const p2 = JSON.parse(r2.result.content[0].text);
check('check_path 不存在 → false', p2.exists === false);

// check_claim：带证据
const r3 = await handleMessage({
  jsonrpc: '2.0', id: 5, method: 'tools/call',
  params: { name: 'check_claim', arguments: { kind: 'write', target: 'C:\\x.txt', evidence: { writes: [{ path: 'C:\\x.txt', isError: true }], cmds: [] } } },
});
const c3 = JSON.parse(r3.result.content[0].text);
check('check_claim 失败证据 → contradicted', c3.verdict === 'contradicted', JSON.stringify(c3));

// check_claim：无证据走 OS 探测
const r4 = await handleMessage({
  jsonrpc: '2.0', id: 6, method: 'tools/call',
  params: { name: 'check_claim', arguments: { kind: 'write', target: f } },
});
const c4 = JSON.parse(r4.result.content[0].text);
check('check_claim 存在的路径 → supported', c4.verdict === 'supported', JSON.stringify(c4));

// 错误路径
const bad = await handleMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope', arguments: {} } });
check('未知工具 → isError', bad.result.isError === true);
const noTarget = await handleMessage({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'check_claim', arguments: { kind: 'write' } } });
check('缺 target → isError', noTarget.result.isError === true);
const unknownMethod = await handleMessage({ jsonrpc: '2.0', id: 9, method: 'nope/method' });
check('未知方法 → -32601', unknownMethod.error.code === -32601);
const badReq = await handleMessage({ id: 10, method: 'initialize' });
check('非 JSON-RPC → -32600', badReq.error.code === -32600);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
