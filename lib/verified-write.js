// verified-write.js —— "工具形态的器官"：写入与核验由同一个工具完成。
//
// 背景（论文 §7.6.12）：外部插件改不了宿主的工具结果，所以核验结论只能事后注入。
// 绕开办法：让 agent 通过**我们的**工具写文件——工具结果由我们构造，
// 核验结论就能天然地作为观测的一部分返回，而不是事后的一条消息。
//
// 这不是伪造：写入是真的、核验也是真的，只是同一个工具负责两件事。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * 写入并核验。
 * @param {{path:string, content:string, createDirs?:boolean}} input
 * @returns {{ok:boolean, path:string, bytes:number, sha256?:string, verified:{exists:boolean,size?:number,reason?:string}}}
 */
export function writeVerified({ path: rawPath, content = '', createDirs = false } = {}) {
  const target = path.resolve(String(rawPath || ''));
  const buf = Buffer.from(String(content ?? ''), 'utf8');
  const dir = path.dirname(target);

  // 父目录不存在：不擅自创建（静默失败正是我们要暴露的形态）
  if (!fs.existsSync(dir)) {
    if (!createDirs) {
      return {
        ok: false,
        path: target,
        bytes: 0,
        verified: { exists: false, reason: `父目录不存在：${dir}` },
      };
    }
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch (e) {
      return { ok: false, path: target, bytes: 0, verified: { exists: false, reason: `无法创建目录：${String(e && e.message).slice(0, 80)}` } };
    }
  }

  // 原子写：临时文件 → rename
  const tmp = path.join(dir, `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}`);
  let ok = false;
  let reason = '';
  try {
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, target);
    ok = true;
  }
  catch (e) {
    reason = String(e && e.message).slice(0, 120);
    try { fs.unlinkSync(tmp); } catch { /* 忽略 */ }
  }

  // 写完之后，立刻用操作系统确认"它到底在不在"
  let exists = false;
  let size;
  try {
    const st = fs.statSync(target);
    exists = true;
    size = st.size;
  }
  catch { exists = false; }

  const verified = { exists };
  if (exists)
    verified.size = size;
  if (!exists && reason)
    verified.reason = reason;
  if (ok && !exists)
    verified.reason = '写入返回成功，但目标不存在';

  let digest;
  if (exists) {
    try { digest = sha256(fs.readFileSync(target)); } catch { /* 忽略 */ }
  }

  return { ok: ok && exists, path: target, bytes: exists ? size : 0, ...(digest ? { sha256: digest } : {}), verified };
}

export { sha256 };
