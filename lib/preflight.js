// preflight.js —— 事前拦截：在动作执行**之前**判断该不该做
//
// 这是"阻止"而不是"检测"：检测是事后算账，拦截是根本不让它发生。
// 宿主给了入口：`ctx.on('agent/pre-step', ({agent}, next) => decision)`，
// 返回 `{ kind: 'reject' }` 就能拦住这一步（action-cards 就是这么用的）。
//
// 但拦截必须极度保守——误拦一次，会话就卡住了。所以这里只判两条**不可逆**的风险：
//   ① 写到允许根之外（越界）
//   ② 覆盖已有文件但内容大幅缩水（疑似截断，通常意味着出错而不是有意改写）
//
// 默认关闭，由 cfg.preflightEnabled 打开。

import fs from 'node:fs';
import path from 'node:path';

/** 受保护的目录片段（永远不允许写入） */
const PROTECTED = [
  /[\\/]\.ssh[\\/]/i,
  /[\\/]\.gnupg[\\/]/i,
  /[\\/]AppData[\\/]Roaming[\\/]Microsoft[\\/]Crypto/i,
  /[\\/]Windows[\\/]System32/i,
];

/**
 * 检查一次写入是否应该被拦截。
 * @param {{path:string, content?:string, allowedRoots?:string[], truncateRatio?:number}} req
 * @returns {{allow:boolean, reason?:string, kind?:string}}
 */
export function preflightWrite(req) {
  const abs = req && req.path ? path.resolve(String(req.path)) : '';
  if (!abs)
    return { allow: true };

  // ① 受保护路径
  if (PROTECTED.some((re) => re.test(abs)))
    return { allow: false, kind: 'protected', reason: `目标在受保护目录：${abs}` };

  // ② 越界（没配 allowedRoots 就不判，避免误伤）
  const roots = Array.isArray(req.allowedRoots) ? req.allowedRoots.filter(Boolean).map((r) => path.resolve(r)) : [];
  if (roots.length && !roots.some((r) => abs === r || abs.startsWith(r + path.sep)))
    return { allow: false, kind: 'out-of-scope', reason: `目标不在允许的根目录内：${abs}` };

  // ③ 疑似截断：覆盖已有文件，且新内容不足旧内容的一半
  try {
    if (fs.existsSync(abs)) {
      const oldSize = fs.statSync(abs).size;
      const newSize = typeof req.content === 'string' ? Buffer.byteLength(req.content, 'utf8') : null;
      const ratio = typeof req.truncateRatio === 'number' ? req.truncateRatio : 0.5;
      if (newSize !== null && oldSize >= 1024 && newSize < oldSize * ratio) {
        return {
          allow: false,
          kind: 'truncation',
          reason: `疑似截断：${abs} 现有 ${oldSize} 字节，新内容只有 ${newSize} 字节。若确实要大幅删减，请分两步（先备份再改）。`,
        };
      }
    }
  }
  catch { /* 读不到就不判 */ }

  return { allow: true };
}

/** 把拦截结果渲染成给模型看的话 */
export function renderPreflight(result, req) {
  if (!result || result.allow)
    return '';
  return `【事前拦截】${result.reason}\n这一步没有执行。请修正后重试（目标：${req && req.path ? path.basename(String(req.path)) : '未知'}）。`;
}
