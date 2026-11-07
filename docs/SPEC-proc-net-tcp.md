# 规范依据：/proc/net/tcp 的格式

本文档记录 POSIX 平台层解析所依据的正式规范，供论文引用与复核。

## 出处

`proc_pid_net(5)`，Linux man-pages 6.19（2026-02-08）。
线上版本：https://man7.org/linux/man-pages/man5/proc_pid_net.5.html

## 字段（`/proc/net/tcp` 与 `/proc/net/tcp6`）

```
sl  local_address rem_address  st  tx_queue:rx_queue  tr:tm->when  retrnsmt  uid  timeout  inode
```

- `local_address` / `rem_address`：`AAAAAAA:PPPP`
  - `AAAAAAA`：IPv4 为 8 位十六进制，**小端字节序**（`0100007F` → `127.0.0.1`）；
    tcp6 为 32 位十六进制（4 组 8 位，每组小端）
  - `PPPP`：4 位十六进制端口
- `st`：套接字状态码，`0A` 表示 `LISTEN`（手册 udp 样例中监听套接字即 `0A`）

## 手册原文样例（udp 小节，格式与 tcp 相同）

```
  sl  local_address rem_address   st tx_queue rx_queue tr rexmits  tm->when uid
   1: 01642C89:0201 0C642C89:03FF 01 00000000:00000001 01:000071BA 00000000 0
   1: 00000000:0801 00000000:0000 0A 00000000:00000000 00:00000000 6F000100 0
   1: 00000000:0201 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0
```

解析结果（`test/spec-proc.mjs` 断言）：

| 行 | 本地地址 | 本地端口 | 状态 |
|---|---|---|---|
| 1 | 137.44.100.1 | 513 | ESTABLISHED |
| 2 | 0.0.0.0 | 2049 | LISTEN |
| 3 | 0.0.0.0 | 513 | LISTEN |

## 状态码表（`include/net/tcp_states.h`，常用子集）

| 码 | 名称 |
|---|---|
| 01 | ESTABLISHED |
| 02 | SYN_SENT |
| 03 | SYN_RECV |
| 04 | FIN_WAIT1 |
| 05 | FIN_WAIT2 |
| 06 | TIME_WAIT |
| 07 | CLOSE |
| 08 | CLOSE_WAIT |
| 09 | LAST_ACK |
| 0A | LISTEN |
| 0B | CLOSING |

## 为什么只读 /proc

- 不依赖 `netstat`/`lsof`/`ss`，不受这些工具是否安装或受限影响；
- 只读内核暴露的视图，无副作用；
- 在容器与受限沙箱中仍可访问（`/proc/net` 是 `/proc/self/net` 的符号链接，按网络命名空间隔离）。

## 实现与测试

- 实现：`lib/platform/posix.js`（`parseProcNetEntries` / `parseProcNet` / `decodeIPv4`）
- 测试：`test/spec-proc.mjs`（22 个断言，全部使用上述官方样例与边界输入）
- 真机自检：`tools/posix-selftest.mjs`（在任意 Linux 上运行，含「自开监听端口 → 解析回读」交叉验证）
