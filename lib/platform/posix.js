// posix.js —— Linux/macOS 状态读取：只读 /proc，不 spawn 任何命令。
//
// 格式依据：proc_pid_net(5)（Linux man-pages 6.19，2026-02-08）：
//   sl  local_address rem_address  st  tx_queue:rx_queue  tr:tm->when  retrnsmt  uid  timeout  inode
//   地址为 `AAAAAAA:PPPP`，AAAAAAA 为 8 位十六进制（IPv4，小端字节序），PPPP 为 4 位十六进制端口；
//   tcp6 的地址为 32 位十六进制（4 组 8 位，每组小端）。
//   st（状态）：01=ESTABLISHED，0A=LISTEN（手册 udp 样例中监听套接字即 0A）。

/** 套接字状态码 → 名称（常用子集，来自 include/net/tcp_states.h）。 */
export const STATE_NAMES = {
  '01': 'ESTABLISHED',
  '02': 'SYN_SENT',
  '03': 'SYN_RECV',
  '04': 'FIN_WAIT1',
  '05': 'FIN_WAIT2',
  '06': 'TIME_WAIT',
  '07': 'CLOSE',
  '08': 'CLOSE_WAIT',
  '09': 'LAST_ACK',
  '0A': 'LISTEN',
  '0B': 'CLOSING',
};

/** IPv4：/proc 里是 32 位小端十六进制，例如 0100007F → 127.0.0.1。 */
export function decodeIPv4(hex) {
  const s = String(hex || '').toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(s))
    return null;
  const b = [s.slice(6, 8), s.slice(4, 6), s.slice(2, 4), s.slice(0, 2)].map((x) => parseInt(x, 16));
  return b.join('.');
}

/** 解析 /proc/net/tcp 与 tcp6 的每一行。 */
export function parseProcNetEntries(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^\d+:\s+([0-9A-Fa-f]{8,32}):([0-9A-Fa-f]{4})\s+([0-9A-Fa-f]{8,32}):([0-9A-Fa-f]{4})\s+([0-9A-Fa-f]{2})\b(.*)$/);
    if (!m)
      continue;
    const addrHex = m[1];
    out.push({
      localAddr: addrHex.length === 8 ? decodeIPv4(addrHex) : `[v6:${addrHex}]`,
      localPort: parseInt(m[2], 16),
      remoteAddr: m[3].length === 8 ? decodeIPv4(m[3]) : `[v6:${m[3]}]`,
      remotePort: parseInt(m[4], 16),
      state: m[5].toUpperCase(),
      stateName: STATE_NAMES[m[5].toUpperCase()] || 'UNKNOWN',
      raw: line.trim(),
    });
  }
  return out;
}

/** 端口集合：解析 /proc/net/tcp 与 tcp6 中 state=0A（LISTEN）的本地端口。 */
export function parseProcNet(text) {
  const ports = new Set();
  for (const e of parseProcNetEntries(text)) {
    if (e.state === '0A')
      ports.add(e.localPort);
  }
  return ports;
}

/**
 * 读本机监听端口。
 * @param {{readFile:(p:string)=>string|null}} io 可注入
 */
export function listeningPorts({ io }) {
  const out = new Set();
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    const text = io.readFile(f);
    if (!text)
      continue;
    for (const p of parseProcNet(text))
      out.add(p);
  }
  return out.size ? out : null;
}

/** 进程是否存在：/proc/<pid> 是目录即存在。 */
export function pidAlive(pid, { io }) {
  if (!Number.isInteger(pid) || pid <= 0)
    return null;
  const exists = io.exists(`/proc/${pid}`);
  if (exists === null)
    return null; // 读不到 /proc（非 Linux 或受限）
  return exists;
}

export const PLATFORM_NAME = 'posix';
