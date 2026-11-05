// platform.mjs —— 平台适配层：用 fixture 模拟 /proc，在 Windows 上验证 POSIX 解析逻辑
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseProcNet, pidAlive as posixPidAlive, listeningPorts as posixPorts } from '../lib/platform/posix.js';
import { pidAlive as winPidAlive } from '../lib/platform/win32.js';
import { adapterFor, platformInfo, pidAlive, listeningPorts } from '../lib/platform/index.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// ── /proc/net/tcp 解析
const tcp = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 0 100 0 0 10 0',
  '   1: 0100007F:0FA0 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 0 100 0 0 10 0',
  '   2: 0100007F:FAA0 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1000        0 1 0 20 4 30 10 -1',
].join('\n');

const ports = parseProcNet(tcp);
check('解析出两个 LISTEN 端口', ports.size === 2, JSON.stringify([...ports]));
check('0x1F90 = 8080 在集合里', ports.has(8080));
check('0x0FA0 = 4000 在集合里', ports.has(4000));
check('非 LISTEN（01=ESTABLISHED）被排除', ports.size === 2);

const six = '   0: 00000000000000000000000001000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 0 100 0 0 10 0';
check('tcp6 也能解析', parseProcNet(six).has(8080));

// ── fixture 模拟 /proc
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-plat-'));
const fakeProc = path.join(dir, 'proc');
fs.mkdirSync(path.join(fakeProc, '1234'), { recursive: true });
fs.mkdirSync(path.join(fakeProc, 'net'), { recursive: true });
fs.writeFileSync(path.join(fakeProc, 'net', 'tcp'), tcp);

const io = {
  readFile(p) {
    const rel = p.replace(/^\/proc/, fakeProc).replace(/\//g, path.sep);
    try { return fs.readFileSync(rel, 'utf8'); } catch { return null; }
  },
  exists(p) {
    const rel = p.replace(/^\/proc/, fakeProc).replace(/\//g, path.sep);
    try { return fs.existsSync(rel); } catch { return null; }
  },
};

check('fixture：PID 1234 存在', posixPidAlive(1234, { io }) === true);
check('fixture：PID 4321 不存在', posixPidAlive(4321, { io }) === false);
check('fixture：端口集合可读', posixPorts({ io })?.has(8080) === true);
check('非法 PID 返回 null', posixPidAlive(0, { io }) === null && posixPidAlive(null, { io }) === null);

// 读不到 /proc 时应返回 null（不知道），而不是 false
const blindIO = { readFile: () => null, exists: () => null };
check('读不到 /proc → null（不猜）', posixPidAlive(1234, { io: blindIO }) === null);

// ── win32 语义：当前进程存活；EPERM 视为存活
check('win32：当前进程存活', winPidAlive(process.pid) === true);
check('win32：超大 PID 不存在', winPidAlive(999999) === false);
check('win32：非法 PID → null', winPidAlive('x') === null);

// ── 分发与信息
check('win32 平台选 win32 适配器', adapterFor('win32').PLATFORM_NAME === 'win32');
check('linux 平台选 posix 适配器', adapterFor('linux').PLATFORM_NAME === 'posix');
check('darwin 平台也选 posix', adapterFor('darwin').PLATFORM_NAME === 'posix');
const info = platformInfo('linux');
check('platformInfo 标记 linux 有 /proc', info.hasProcFs === true && info.adapter === 'posix');
const winInfo = platformInfo('win32');
check('platformInfo 标记 win32 无 /proc', winInfo.hasProcFs === false);

// 公共入口：不崩
check('pidAlive 公共入口可用', pidAlive(process.pid) === true);
check('listeningPorts 公共入口不抛', (() => { try { listeningPorts(); return true; } catch { return false; } })());

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
