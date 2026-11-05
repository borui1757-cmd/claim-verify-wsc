// state.js —— 状态核验：直接问文件系统，而不是相信日志。
//
// 为什么需要：日志会被裁剪、stderr 会被丢弃、调用记录会滚走——但 **mtime 不会撒谎**。
// 依据：GroundEval 主张「有状态 agent 的评估必须以状态为准，不以叙述为准」；
// opendot 的做法是每个动作前先快照。
//
// 我们目前只做「存在性」核验（强否定），做成基线快照需要 turn 开始时的钩子，留待 v4。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function expand(p) {
  if (typeof p !== 'string' || !p.trim())
    return null;
  let s = p.trim().replace(/^`|`$/g, '').replace(/^"|"$/g, '');
  if (s.startsWith('~/') || s.startsWith('~\\'))
    s = s.replace(/^~/, process.env.USERPROFILE || process.env.HOME || '~');
  return path.normalize(s);
}

/** 单个路径的状态；只读，失败返回 exists:false 但带 error */
export function statPath(p) {
  const abs = expand(p);
  if (!abs)
    return { path: null, exists: false, error: 'bad-path' };
  try {
    const st = fs.statSync(abs, { throwIfNoEntry: false });
    if (!st)
      return { path: abs, exists: false, isFile: false };
    return {
      path: abs,
      exists: true,
      isFile: st.isFile(),
      isDir: st.isDirectory(),
      size: st.size,
      mtimeMs: st.mtimeMs,
    };
  }
  catch (e) {
    return { path: abs, exists: false, error: String(e && e.code || e) };
  }
}

/** 文件内容哈希（可选，用于「改了没」的判断；大文件跳过） */
export function hashPath(p, maxBytes = 2 * 1024 * 1024) {
  const abs = expand(p);
  if (!abs)
    return null;
  try {
    const st = fs.statSync(abs, { throwIfNoEntry: false });
    if (!st || !st.isFile() || st.size > maxBytes)
      return null;
    return crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 16);
  }
  catch {
    return null;
  }
}

/** 默认注入给 promise.js 的 stat 函数 */
export function makeStat() {
  return (p) => statPath(p);
}
