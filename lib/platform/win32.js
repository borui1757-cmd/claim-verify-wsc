// win32.js —— Windows 状态读取。
//
// 进程：用 process.kill(pid, 0) 探测。语义要点：
//   ESRCH  → 不存在
//   EPERM  → **存在但无权限**（此前被误判为"无法判断"，2026-11-05 修）
//   其它   → 无法判断
//
// 端口：交给调用方用 TCP connect 探活（跨平台一致），这里不提供列表。

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0)
    return null;
  try {
    process.kill(pid, 0);
    return true;
  }
  catch (e) {
    const code = e && e.code;
    if (code === 'ESRCH')
      return false;
    if (code === 'EPERM')
      return true;
    return null;
  }
}

export function listeningPorts() {
  return null; // Windows 无 /proc；由 TCP 探活兜底
}

export const PLATFORM_NAME = 'win32';
