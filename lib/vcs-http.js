// vcs-http.js —— 追加两类只读 oracle：git 状态 与 HTTP 状态码。
//
// 为什么加：覆盖率分析显示，卡点主要在「有证据但没原语」，而非句子太粗。
// 这两类在编程/运维 agent 的报告里高频出现（"已提交""工作区干净""接口 200"）。
//
// 安全约束：
//   · 只读：git 只跑 status/rev-parse 级别命令；HTTP 只发请求不改状态
//   · 仅 http(s)；超时 2s；重定向跟随后仍校验最终状态码
//   · git_clean 依赖 git 可执行文件；无法执行时返回 null（不知道），绝不猜

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** 读 .git/HEAD 得到当前提交 SHA（纯文件操作，不依赖 git 命令）。 */
export function readGitHead(dir) {
  try {
    const gitDir = path.join(dir, '.git');
    const headFile = path.join(gitDir, 'HEAD');
    const head = fs.readFileSync(headFile, 'utf8').trim();
    if (/^[0-9a-f]{40}$/i.test(head))
      return head.toLowerCase();
    const m = /^ref:\s*(.+)$/.exec(head);
    if (!m)
      return null;
    const refPath = path.join(gitDir, m[1].trim());
    const sha = fs.readFileSync(refPath, 'utf8').trim();
    if (/^[0-9a-f]{40}$/i.test(sha))
      return sha.toLowerCase();
    // packed-refs 回退
    const packed = path.join(gitDir, 'packed-refs');
    const body = fs.readFileSync(packed, 'utf8');
    for (const line of body.split('\n')) {
      const mm = /^([0-9a-f]{40})\s+(.+)$/.exec(line.trim());
      if (mm && mm[2] === m[1].trim())
        return mm[1].toLowerCase();
    }
    return null;
  }
  catch {
    return null;
  }
}

/** 工作区是否干净：git status --porcelain 输出为空。 */
export function gitIsClean(dir, { run = defaultGit } = {}) {
  try {
    const out = run(['status', '--porcelain'], dir);
    if (out === null)
      return null;
    return String(out).trim() === '';
  }
  catch {
    return null;
  }
}

function defaultGit(args, dir) {
  try {
    const out = execFileSync('git', args, { cwd: dir, timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out;
  }
  catch {
    return null;
  }
}

/** HTTP 状态码；失败返回 null（不知道），不猜。 */
export async function httpStatus(url, { timeoutMs = 2000, fetchImpl = globalThis.fetch } = {}) {
  try {
    const u = new URL(String(url));
    if (!/^https?:$/.test(u.protocol))
      return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(u.toString(), { method: 'GET', redirect: 'follow', signal: ctrl.signal });
      return { status: res.status, ok: res.ok };
    }
    finally {
      clearTimeout(timer);
    }
  }
  catch {
    return null;
  }
}
