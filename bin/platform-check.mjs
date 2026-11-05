#!/usr/bin/env node
// 平台能力自检：在一台新机器（尤其是 Linux）上跑一次，确认真值层可移植。
//
// 用法：node bin/platform-check.mjs [--json]

import fs from 'node:fs';
import path from 'node:path';
import { platformInfo, pidAlive, listeningPorts } from '../lib/platform/index.js';

const asJson = process.argv.includes('--json');
const info = platformInfo();
const self = pidAlive(process.pid);
const ports = listeningPorts();

// 只读性：读一次临时文件不应改变它
const dir = fs.mkdtempSync('platform-check-');
const f = path.join(dir, 'a.txt');
fs.writeFileSync(f, 'hello');
const before = fs.readFileSync(f, 'utf8');
fs.readFileSync(f, 'utf8');
const readOnly = fs.readFileSync(f, 'utf8') === before;
fs.rmSync(dir, { recursive: true, force: true });

const result = {
  ...info,
  selfPidAlive: self,
  portListSupported: ports !== null,
  portCount: ports ? ports.size : 0,
  samplePorts: ports ? [...ports].slice(0, 5) : [],
  fsReadOnlyOk: readOnly,
  canWriteTemp: true,
  verdict: {
    procFs: info.hasProcFs ? (ports !== null ? 'ok' : 'readable-but-no-tcp') : 'n/a (win32 用 kill 探测)',
    pidProbe: self === true ? 'ok' : (self === null ? 'unknown' : 'broken'),
  },
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

console.log('平台能力自检');
console.log('─'.repeat(46));
console.log(`平台        ${result.platform} / ${result.arch}  (${result.adapter})`);
console.log(`内核        ${result.release}`);
console.log(`/proc 可读  ${result.hasProcFs ? '是' : '否（win32 走 kill 探测）'}`);
console.log(`自身进程    ${self === true ? '存活 ✓' : self === null ? '无法判断 ✗' : '探测失败 ✗'}`);
console.log(`端口列表    ${ports === null ? '不支持（用 TCP 探活兜底）' : `可读，${ports.size} 个监听端口`}${ports ? '：' + [...ports].slice(0, 5).join(', ') : ''}`);
console.log(`文件只读    ${readOnly ? '正常 ✓' : '异常 ✗'}`);
console.log('');
console.log(`结论        PID 探测 ${result.verdict.pidProbe}；/proc ${result.verdict.procFs}`);
const bad = self !== true;
if (bad) {
  console.log('\n✗ 自检未通过：PID 探测异常，请把上面的 --json 输出贴给开发者。');
  process.exit(1);
}
console.log('\n✓ 自检通过：真值层在本机可用。');
