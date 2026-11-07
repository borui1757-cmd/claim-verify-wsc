#!/usr/bin/env node
// posix-selftest.mjs —— 单文件、零依赖的 Linux 真机自检。
// 复制到任意有 Node 的 Linux 上执行：node posix-selftest.mjs
// 输出可直接贴回来，用来确认「/proc 解析在本机是否成立」。

import fs from 'node:fs';

const out = [];
const log = (s) => { out.push(s); console.log(s); };

function parseProcNet(text) {
  const ports = new Set();
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^\d+:\s+([0-9A-Fa-f]{8,32}):([0-9A-Fa-f]{4})\s+\S+\s+([0-9A-Fa-f]{2})\b/);
    if (!m)
      continue;
    if (m[3].toUpperCase() !== '0A')
      continue;
    ports.add(parseInt(m[2], 16));
  }
  return ports;
}

log('=== POSIX 自检 ' + new Date().toISOString() + ' ===');
log('node ' + process.version + ' / ' + process.platform + ' ' + process.arch);

// 1. /proc 存在
const hasProc = fs.existsSync('/proc');
log('[/proc] ' + (hasProc ? '存在' : '不存在 —— 后面全部无意义'));
if (!hasProc) {
  log('结论：失败（无 /proc）');
  process.exit(1);
}

// 2. /proc/self 与 PID 探测
const selfOk = fs.existsSync(`/proc/${process.pid}`);
log(`[/proc/self] 用 /proc/${process.pid} 探测自身：` + (selfOk ? '存在 ✓' : '不存在 ✗'));
const deadOk = fs.existsSync('/proc/999999');
log('[/proc/999999] 应不存在：' + (deadOk ? '存在 ✗' : '不存在 ✓'));

// 3. /proc/net/tcp 解析
let total = 0;
for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
  let text = null;
  try { text = fs.readFileSync(f, 'utf8'); } catch { /* 无该文件 */ }
  if (text === null) {
    log(`[${f}] 读不到`);
    continue;
  }
  const lines = text.trim().split('\n');
  const ports = parseProcNet(text);
  total += ports.size;
  log(`[${f}] 行数 ${lines.length}，解析出 LISTEN 端口 ${ports.size} 个：${[...ports].slice(0, 8).join(', ') || '（无）'}`);
  if (lines.length > 1)
    log(`[${f}] 样例首行数据：${lines[1].trim().slice(0, 80)}`);
}

// 4. 交叉验证：自己开一个监听端口，看能否被解析出来
import net from 'node:net';
const srv = net.createServer(() => {});
await new Promise((res) => srv.listen(0, '127.0.0.1', res));
const port = srv.address().port;
const text2 = (() => { try { return fs.readFileSync('/proc/net/tcp', 'utf8'); } catch { return ''; } })();
const found = parseProcNet(text2).has(port);
log(`[交叉验证] 监听 ${port} → /proc/net/tcp 里${found ? '能找到 ✓' : '找不到 ✗'}`);
srv.close();

const ok = hasProc && selfOk && !deadOk && found;
log('');
log('结论：' + (ok ? '通过 —— 本机 /proc 解析成立' : '未通过 —— 请看上面标记 ✗ 的项'));
process.exit(ok ? 0 : 1);
