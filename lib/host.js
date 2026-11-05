// host.js —— 主机类断言：进程 PID / 文件行数 / 文件大小 / 文件哈希。
//
// 为什么单独一文件：这四类的真值都来自本机系统调用（process.kill(pid,0) / fs.statSync /
// 读文件算 sha256），不经模型、不联网，和 extra.js 的「程序算」区分开，方便单独扩。
//
// 设计原则同主抽取层：**precision-first**。宁可只认最明确的说法，也不去猜。
//   行数必须写「一共/共/有 N 行」，大小必须带单位（字节/KB/MB/GB），
//   哈希必须和「哈希/sha256/校验」同句出现，PID 必须带「在跑/活着/退出/不在了」这类谓词。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const HOST_KINDS = new Set(['pid', 'lines', 'size', 'hash', 'pkgversion', 'mem', 'disk', 'service', 'registry', 'task']);

const SENT_END = /[。！？!?；;\n]+/g;

function sentencesOf(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(SENT_END)) {
    if (m.index > last)
      out.push(text.slice(last, m.index));
    last = m.index + m[0].length;
  }
  if (last < text.length)
    out.push(text.slice(last));
  return out;
}

export function expandPath(p) {
  if (typeof p !== 'string')
    return p;
  if (p.startsWith('~/'))
    return path.join(process.env.USERPROFILE || process.env.HOME || '.', p.slice(2));
  return p;
}

/** 否定说法：只说「它不在了 / 找不到」才算否定。 */
const PID_NEG = ['已经不在了', '不在了', '已退出', '退出了', '已经退出', '挂了', '停了', '没有这个进程', '找不到进程', '没有在跑', '没在跑'];
const FILE_NEG = ['不存在', '找不到', '没有这个文件', '已被删除', '被删了', '已删除'];

const PID_PREDICATE = /在跑|活着|运行中|运行|起|退出|不在了|挂了|停了|存在/;
const SIZE_UNIT = { 字节: 1, B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

function cleanPath(s) {
  return s
    .split(/[“”‘’「」『』]/)[0]
    .replace(/[.,;:>）」』"'`]+$/, '')
    .replace(/#L\d+(?:-L\d+)?$/, '')
    .replace(/[\\/]+$/, '');
}

const PATH_RE = /(?:[A-Za-z]:\\[^\s"'`，。；、）)\]}<>“”‘’「」『』]+|~\/[^\s"'`，。；、）)\]}<>“”‘’「」『』]+)/g;

export function extractHostClaims(text) {
  const claims = [];
  if (typeof text !== 'string' || text.length < 4)
    return claims;

  for (const s of sentencesOf(text)) {
    const t = s.trim();
    if (!t)
      continue;

    // 1) 进程 PID
    for (const m of t.matchAll(/\b(?:PID|pid)\s*[:：#]?\s*(\d{2,6})\b/g)) {
      const pid = Number(m[1]);
      if (!Number.isInteger(pid) || pid < 2)
        continue;
      if (!PID_PREDICATE.test(t))
        continue;
      const neg = PID_NEG.some((c) => t.includes(c));
      claims.push({ kind: 'pid', value: pid, raw: m[0], ctx: t, polarity: neg ? 'neg' : 'pos' });
    }

    // 2) 文件行数 / 大小 / 哈希：句内必须同时有路径
    const paths = [...t.matchAll(PATH_RE)].map((x) => cleanPath(x[0])).filter((p) => p.length >= 4);
    if (!paths.length)
      continue;
    const file = paths[0];
    const neg = FILE_NEG.some((c) => t.includes(c));
    if (neg)
      continue;   // 说「这个文件不存在」时，行数/大小/哈希都不是在断言具体值，放过

    for (const m of t.matchAll(/(?:一共|共|总共|有)\s*(\d+)\s*行/g)) {
      claims.push({ kind: 'lines', value: { path: file, n: Number(m[1]) }, raw: m[0], ctx: t, polarity: 'pos' });
    }
    for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(字节|KB|MB|GB|B)\b/gi)) {
      const unit = m[2].toUpperCase() === 'B' && m[2] !== 'B' ? m[2] : m[2].toUpperCase();
      const mul = SIZE_UNIT[m[2]] ?? SIZE_UNIT[unit];
      if (!mul)
        continue;
      claims.push({ kind: 'size', value: { path: file, bytes: Number(m[1]) * mul, raw: m[0] }, raw: m[0], ctx: t, polarity: 'pos' });
    }
    if (/哈希|sha-?256|校验和|checksum/i.test(t)) {
      for (const m of t.matchAll(/\b([0-9a-f]{8,64})\b/gi)) {
        claims.push({ kind: 'hash', value: { path: file, prefix: m[1].toLowerCase() }, raw: m[0], ctx: t, polarity: 'pos' });
      }
    }
  }

  // 3) 依赖版本 / 内存 / 磁盘：不属于"某条路径"的句式，单独扫全文
  for (const s of sentencesOf(text)) {
    const t = s.trim();
    if (!t)
      continue;

    // 3a) name@1.2.3 或「`name` 的版本是 1.2.3」。只认像包名的（带 - / 或以 @ 开头），
    //     避免把 a@b.com 这类邮箱、file@1.0.0 这类杂串当成依赖。
    for (const m of t.matchAll(/\b(@?[a-z][a-z0-9._-]*(?:\/[\w.-]+)?)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\b/g)) {
      const name = m[1];
      if (!/[-/@]/.test(name))
        continue;
      claims.push({ kind: 'pkgversion', value: { name, version: m[2] }, raw: m[0], ctx: t, polarity: 'pos' });
    }
    for (const m of t.matchAll(/`?(@?[a-z][\w./@-]{2,})`?\s*的?版本(?:号)?\s*(?:是|为|：|:)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/g)) {
      const name = m[1];
      if (!/[-/@]/.test(name))
        continue;
      claims.push({ kind: 'pkgversion', value: { name, version: m[2] }, raw: m[0], ctx: t, polarity: 'pos' });
    }

    // 3b) 内存余量：「可用内存 12 GB」。百分比占用不算（口径与 freemem 不同）。
    if (/内存/.test(t) && !/%|占用/.test(t)) {
      for (const m of t.matchAll(/(?:可用|剩余|空闲|剩下|还剩)\s*内存[^\d\n]{0,10}?(\d+(?:\.\d+)?)\s*(GB|MB|GiB|MiB)/gi)) {
        const mul = /^G/i.test(m[2]) ? 1024 ** 3 : 1024 ** 2;
        claims.push({ kind: 'mem', value: { bytes: Number(m[1]) * mul }, raw: m[0], ctx: t, polarity: 'pos' });
      }
    }

    // 3c) 磁盘余量：「C 盘剩余 500 GB」
    for (const m of t.matchAll(/([A-Za-z])\s*盘[^\d\n]{0,12}?(\d+(?:\.\d+)?)\s*(TB|GB|MB)/gi)) {
      if (!/剩余|可用|空闲|还剩|剩下/.test(t))
        continue;
      const mul = /^T/i.test(m[3]) ? 1024 ** 4 : /^G/i.test(m[3]) ? 1024 ** 3 : 1024 ** 2;
      claims.push({ kind: 'disk', value: { drive: `${m[1].toUpperCase()}:`, bytes: Number(m[2]) * mul }, raw: m[0], ctx: t, polarity: 'pos' });
    }

    // 4) 服务状态 / 注册表值 / 计划任务（需要 spawn 系统工具，见 verifyHostClaim 的预算控制）
    //    只认最明确的写法，宁可漏。
    for (const m of t.matchAll(/服务\s*`?([A-Za-z][\w.-]{1,60})`?\s*(正在运行|运行中|在运行|已停止|已经停止|已停|已禁用)/g)) {
      const st = m[2];
      const neg = /停/.test(st);
      claims.push({ kind: 'service', value: { name: m[1], want: neg ? 'STOPPED' : 'RUNNING' }, raw: m[0], ctx: t, polarity: 'pos' });
    }
    for (const m of t.matchAll(/`([A-Za-z][\w.-]{1,60})`\s*服务\s*(正在运行|运行中|在运行|已停止|已经停止|已停|已禁用)/g)) {
      const neg = /停/.test(m[2]);
      claims.push({ kind: 'service', value: { name: m[1], want: neg ? 'STOPPED' : 'RUNNING' }, raw: m[0], ctx: t, polarity: 'pos' });
    }
    for (const m of t.matchAll(/\b(HKLM|HKCU|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER)(\\[^\s，。；、）」』]+)/g)) {
      const key = (m[1] === 'HKLM' ? 'HKLM' : m[1] === 'HKCU' ? 'HKCU' : m[1]) + m[2];
      const tail = t.slice(m.index + m[0].length);
      const vm = /^\s*(?:下)?\s*(?:的)?\s*([A-Za-z]\w{0,40})\s*(?:=|是|为|：|:)\s*(0x[0-9a-fA-F]+|\d+)/.exec(tail);
      if (!vm)
        continue;
      claims.push({ kind: 'registry', value: { key, name: vm[1], want: vm[2] }, raw: m[0] + vm[0], ctx: t, polarity: 'pos' });
    }
    for (const m of t.matchAll(/(?:计划任务|任务计划|计划任务项)\s*`?([\w\\ .-]{2,80}?)`?\s*(?:当前)?(?:状态)?\s*(?:是|为|：|:)?\s*(就绪|已就绪|已禁用|正在运行|已停止)/g)) {
      claims.push({ kind: 'task', value: { name: m[1].trim(), want: m[2] }, raw: m[0], ctx: t, polarity: 'pos' });
    }
  }
  return claims;
}

// ────────────────────────── 真值 ──────────────────────────

export function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  }
  catch (e) {
    // EPERM = 进程在，只是没权限发信号；ESRCH = 不存在
    return e && e.code === 'EPERM';
  }
}

export function countLines(file) {
  try {
    const s = fs.readFileSync(expandPath(file), 'utf8');
    if (!s.length)
      return 0;
    return s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
  }
  catch {
    return null;
  }
}

export function fileSize(file) {
  try {
    return fs.statSync(expandPath(file)).size;
  }
  catch {
    return null;
  }
}

export function fileHash(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(expandPath(file))).digest('hex');
  }
  catch {
    return null;
  }
}

/** 本机可用物理内存（字节）。 */
export function availableMem() {
  try {
    return os.freemem();
  }
  catch {
    return null;
  }
}

/** 某个盘符的可用空间（字节）。Node 18.15+ 的 fs.statfsSync，不需要起子进程。 */
export function diskFree(drive) {
  try {
    const st = fs.statfsSync(`${drive}\\`);
    return st.bfree * st.bsize;
  }
  catch {
    return null;
  }
}

/** 依赖版本：从几个 node_modules 根里找 <name>/package.json。 */export function pkgVersion(name) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const roots = [
    process.cwd(),
    path.join(home, 'profiles', 'web'),
    path.join(home, 'profiles', 'desktop'),
  ];
  for (const r of roots) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(r, 'node_modules', name, 'package.json'), 'utf8'));
      if (j && j.version)
        return String(j.version);
    }
    catch { /* 换下一个根 */ }
  }
  return null;
}

// ────────── 需要 spawn 系统工具的三类：预算 + 缓存 ──────────
//
// 实测（2026-11-05 本机，spawnSync 不经 cmd shell）：
//   sc query      p50 13ms
//   reg query     p50 12ms
//   schtasks      p50 30ms
// 对比：powershell Get-Service 429ms（启动开销吃掉一切），wmic 已弃用。
// 预算仍然死死卡住：单次 400ms 超时、每轮最多 3 次、同名 20 秒内复用。
const SPAWN_TIMEOUT_MS = 400;
const MAX_SPAWNS_PER_TURN = 3;
const CACHE_TTL_MS = 20000;

/**
 * 系统工具在中文 Windows 上输出的是 **OEM 代码页（GBK/936）**，不是 UTF-8。
 * 按 utf8 解码会把「状态: 就绪」变成乱码，正则永远匹配不上 —— 2026-11-05 实测踩到。
 * 统一按 GBK 解码；英文系统下 GBK 对 ASCII 是恒等的，不影响。
 */
function decodeBuf(buf) {
  if (!buf || !buf.length)
    return '';
  try {
    return new TextDecoder('gbk', { fatal: false }).decode(buf);
  }
  catch {
    return Buffer.from(buf).toString('utf8');
  }
}

function runTool(file, args, state) {
  const st = state || { spawns: 0, cache: new Map() };
  const key = `${file} ${args.join(' ')}`;
  const hit = st.cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS)
    return hit.out;
  if (st.spawns >= MAX_SPAWNS_PER_TURN)
    return null;
  st.spawns += 1;
  try {
    const r = spawnSync(file, args, { timeout: SPAWN_TIMEOUT_MS, encoding: 'buffer', windowsHide: true });
    const out = {
      status: r.status,
      stdout: decodeBuf(r.stdout),
      stderr: decodeBuf(r.stderr),
      err: r.error ? String(r.error.message) : null,
    };
    st.cache.set(key, { at: Date.now(), out });
    return out;
  }
  catch {
    return null;
  }
}

/** Windows 服务状态。null = 取不到；{found:false} = 服务不存在。 */
export function serviceState(name, state) {
  const r = runTool('sc', ['query', name], state);
  if (!r)
    return null;
  const m = /STATE\s*:\s*(\d+)\s+(\w+)/i.exec(r.stdout);
  if (!m)
    return { found: false };
  return { found: true, text: m[2].toUpperCase() };
}

/** 注册表值。 */
export function registryValue(key, name, state) {
  const r = runTool('reg', ['query', key, '/v', name], state);
  if (!r)
    return null;
  const m = /^\s{1,}(\S+)\s+(REG_\w+)\s+(.+)$/m.exec(r.stdout);
  if (!m)
    return { found: false };
  return { found: true, type: m[2], data: m[3].trim() };
}

/** 计划任务状态。 */
export function taskState(name, state) {
  const r = runTool('schtasks', ['/query', '/tn', name, '/fo', 'list'], state);
  if (!r)
    return null;
  // 中文版 schtasks 把运行状态放在「模式」这一栏（就绪/正在运行/已禁用），
  // 而「计划任务状态: 已启用」是另一个字段（是否启用），别弄混。
  // 必须锚定行首：否则「登录状态: 只使用交互方式」会被当成任务状态（2026-11-05 实测）。
  const m = /^\s*(?:模式|状态|Status)\s*[:：]\s*(.+)$/im.exec(r.stdout);
  if (!m)
    return { found: false };
  return { found: true, text: m[1].trim() };
}

function normReg(v) {
  const s = String(v).trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(s))
    return String(Number.parseInt(s, 16));
  if (/^\d+$/.test(s))
    return String(Number(s));
  return s;
}

function fmtBytes(n) {
  if (n < 1024)
    return `${n} 字节`;
  if (n < 1024 ** 2)
    return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3)
    return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n < 1024 ** 4)
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return `${(n / 1024 ** 4).toFixed(2)} TB`;
}

/**
 * 核验一条主机类断言。
 * @returns {null|{ok:boolean, expect:string}} null = 取不到真值，放过
 */
export async function verifyHostClaim(claim, cfg, deps = {}) {
  const pidOk = deps.pidExists ?? pidExists;
  const lines = deps.countLines ?? countLines;
  const size = deps.fileSize ?? fileSize;
  const hash = deps.fileHash ?? fileHash;

  if (claim.kind === 'pid') {
    const there = pidOk(claim.value);
    const ok = claim.polarity === 'neg' ? !there : there;
    return { ok, expect: there ? `PID ${claim.value} 确实存在` : `PID ${claim.value} 不存在` };
  }

  if (claim.kind === 'lines') {
    const real = lines(claim.value.path);
    if (real === null)
      return null;
    return { ok: real === claim.value.n, expect: `实际 ${real} 行` };
  }

  if (claim.kind === 'size') {
    const real = size(claim.value.path);
    if (real === null)
      return null;
    // 允许 1 字节误差：写「11.8 KB」这种四舍五入本来就对不上整数
    const ok = Math.abs(real - claim.value.bytes) <= Math.max(1, claim.value.bytes * 0.02);
    return { ok, expect: `实际 ${real} 字节（${fmtBytes(real)}）` };
  }

  if (claim.kind === 'hash') {
    const real = hash(claim.value.path);
    if (real === null)
      return null;
    const ok = real.startsWith(claim.value.prefix);
    return { ok, expect: `实际 sha256 前 ${claim.value.prefix.length} 位是 ${real.slice(0, claim.value.prefix.length)}` };
  }

  if (claim.kind === 'pkgversion') {
    const get = deps.pkgVersion ?? pkgVersion;
    const real = get(claim.value.name);
    if (real === null)
      return null;
    return { ok: real === claim.value.version, expect: `${claim.value.name} 实际是 ${real}` };
  }

  if (claim.kind === 'mem') {
    const get = deps.availableMem ?? availableMem;
    const real = get();
    if (real === null)
      return null;
    // 内存随时在变，给 25% 容差；口径是"可用"而不是"占用"
    const ok = Math.abs(real - claim.value.bytes) <= claim.value.bytes * 0.25;
    return { ok, expect: `实际可用内存 ${fmtBytes(real)}` };
  }

  if (claim.kind === 'disk') {
    const get = deps.diskFree ?? diskFree;
    const real = get(claim.value.drive);
    if (real === null)
      return null;
    const ok = Math.abs(real - claim.value.bytes) <= claim.value.bytes * 0.25;
    return { ok, expect: `${claim.value.drive} 盘实际可用 ${fmtBytes(real)}` };
  }

  if (claim.kind === 'service') {
    const get = deps.serviceState ?? serviceState;
    const real = get(claim.value.name, deps.__host);
    if (real === null)
      return null;
    if (!real.found)
      return { ok: false, expect: `服务 ${claim.value.name} 不存在` };
    const wantStop = claim.value.want === 'STOPPED';
    const isStopped = /^STOP/.test(real.text);
    return { ok: wantStop === isStopped && (wantStop || real.text === 'RUNNING'), expect: `服务 ${claim.value.name} 实际是 ${real.text}` };
  }

  if (claim.kind === 'registry') {
    const get = deps.registryValue ?? registryValue;
    const real = get(claim.value.key, claim.value.name, deps.__host);
    if (real === null)
      return null;
    if (!real.found)
      return { ok: false, expect: `注册表 ${claim.value.key} 下没有 ${claim.value.name}` };
    return { ok: normReg(real.data) === normReg(claim.value.want), expect: `实际是 ${real.data}` };
  }

  if (claim.kind === 'task') {
    const get = deps.taskState ?? taskState;
    const real = get(claim.value.name, deps.__host);
    if (real === null)
      return null;
    if (!real.found)
      return { ok: false, expect: `计划任务 ${claim.value.name} 不存在` };
    const want = claim.value.want.replace(/^已/, '').replace('就绪', 'READY').replace('禁用', 'DISABLED').replace('正在运行', 'RUNNING').replace('停止', 'STOPPED');
    const got = real.text.replace(/^已/, '').replace('就绪', 'READY').replace('禁用', 'DISABLED').replace('正在运行', 'RUNNING').replace('停止', 'STOPPED');
    return { ok: want === got, expect: `计划任务 ${claim.value.name} 实际是 ${real.text}` };
  }

  return null;
}
