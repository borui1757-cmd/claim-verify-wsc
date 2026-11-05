// spec-proc.mjs —— 规范符合性测试：用 proc_pid_net(5) 手册里的官方样例逐字段验证解析器
//
// 依据：Linux man-pages 6.19（2026-02-08）proc_pid_net(5)
//   sl  local_address rem_address  st  tx_queue:rx_queue  tr:tm->when  retrnsmt  uid  timeout  inode
//   地址 = 8 位十六进制（IPv4 小端）: 4 位十六进制端口；tcp6 = 32 位十六进制。
//   手册 udp 样例中监听套接字 st=0A，据此确认 0A=LISTEN。

import { parseProcNetEntries, parseProcNet, decodeIPv4, STATE_NAMES } from '../lib/platform/posix.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// ── 手册原文样例（udp 小节，格式与 tcp 相同）
const manPageSample = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr rexmits  tm->when uid',
  '   1: 01642C89:0201 0C642C89:03FF 01 00000000:00000001 01:000071BA 00000000 0',
  '   1: 00000000:0801 00000000:0000 0A 00000000:00000000 00:00000000 6F000100 0',
  '   1: 00000000:0201 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0',
].join('\n');

const entries = parseProcNetEntries(manPageSample);
check('手册样例解析出 3 条', entries.length === 3, String(entries.length));
check('首条 state=01 → ESTABLISHED', entries[0].stateName === 'ESTABLISHED', entries[0].stateName);
check('首条本地地址 01642C89 → 137.44.100.1', entries[0].localAddr === '137.44.100.1', entries[0].localAddr);
check('首条本地端口 0x0201 = 513', entries[0].localPort === 513, String(entries[0].localPort));
check('首条远端端口 0x03FF = 1023', entries[0].remotePort === 1023, String(entries[0].remotePort));
check('第二条 state=0A → LISTEN', entries[1].stateName === 'LISTEN');
check('监听端口 0x0801 = 2049', entries[1].localPort === 2049, String(entries[1].localPort));
check('监听套接字只取 0A：parseProcNet 得 2 个', parseProcNet(manPageSample).size === 2);

// ── IPv4 解码（小端）
check('decodeIPv4 0100007F → 127.0.0.1', decodeIPv4('0100007F') === '127.0.0.1');
check('decodeIPv4 00000000 → 0.0.0.0', decodeIPv4('00000000') === '0.0.0.0');
check('decodeIPv4 非法输入 → null', decodeIPv4('XYZ') === null && decodeIPv4('') === null);

// ── 表头行必须被忽略
check('表头不被当成条目', !entries.some((e) => /local_address/.test(e.raw)));

// ── tcp6：32 位十六进制地址
const tcp6 = '   0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 0 100 0 0 10 0';
const e6 = parseProcNetEntries(tcp6);
check('tcp6 解析出 1 条', e6.length === 1);
check('tcp6 端口 0x1F90 = 8080', e6[0].localPort === 8080);
check('tcp6 地址标记为 v6', String(e6[0].localAddr).startsWith('[v6:'));
check('tcp6 LISTEN 计入端口集合', parseProcNet(tcp6).has(8080));

// ── 状态表覆盖
check('状态表含 LISTEN', STATE_NAMES['0A'] === 'LISTEN');
check('状态表含 TIME_WAIT', STATE_NAMES['06'] === 'TIME_WAIT');
check('未知状态给 UNKNOWN', parseProcNetEntries('1: 0100007F:1F90 00000000:0000 7F 0:0 00:0 0 0')[0]?.stateName === 'UNKNOWN');

// ── 空输入与垃圾输入
check('空输入 → 空数组', parseProcNetEntries('').length === 0);
check('垃圾行被忽略', parseProcNetEntries('hello\n---\n').length === 0);
check('截断行（只有 sl 和地址）被忽略', parseProcNetEntries('1: 0100007F:1F90').length === 0);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
