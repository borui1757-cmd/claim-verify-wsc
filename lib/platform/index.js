// index.js —— 平台适配层：按 process.platform 分发，所有系统读取可注入（便于测试）。
//
// 设计约定：
//   - 只读：不写文件、不 spawn 命令（posix 走 /proc，win32 走 kill(0)）
//   - 失败要区分「否」与「不知道」：返回 null 表示无法判断，绝不猜

import fs from 'node:fs';
import os from 'node:os';

import * as posix from './posix.js';
import * as win32 from './win32.js';

/** 默认 IO：直接读本机。 */
export const defaultIO = {
  readFile(p) {
    try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
  },
  exists(p) {
    try { return fs.existsSync(p); } catch { return null; }
  },
};

/** 选出当前平台的实现。 */
export function adapterFor(platform = process.platform) {
  return platform === 'win32' ? win32 : posix;
}

/** 平台信息（用于能力矩阵与回执元数据）。 */
export function platformInfo(platform = process.platform) {
  return {
    platform,
    arch: process.arch,
    release: os.release(),
    adapter: adapterFor(platform).PLATFORM_NAME,
    hasProcFs: platform !== 'win32',
    procReadable: platform !== 'win32' ? defaultIO.exists('/proc') : false,
  };
}

/** 进程是否存活；返回 true / false / null（不知道）。 */
export function pidAlive(pid, opts = {}) {
  const adapter = adapterFor(opts.platform);
  const io = opts.io || defaultIO;
  try {
    return adapter.pidAlive(pid, { io });
  }
  catch {
    return null;
  }
}

/** 本机监听端口集合；返回 Set 或 null（该平台不支持 / 读不到）。 */
export function listeningPorts(opts = {}) {
  const adapter = adapterFor(opts.platform);
  const io = opts.io || defaultIO;
  try {
    return adapter.listeningPorts({ io });
  }
  catch {
    return null;
  }
}
