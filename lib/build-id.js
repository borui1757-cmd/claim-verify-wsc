// build-id.js —— 源码指纹：保证日志行能追溯到"哪一版代码写下的"
//
// 借鉴（思想，非代码）：dsh-completion-supervisor 的 build_id —— 当运行中的插件比源码旧时，
// 日志里的行会自相矛盾，而没有任何字段能解释这一点。
//
// 哈希范围：lib/ 下所有 .js 文件（按文件名排序，逐个拼内容），取前 12 位。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} [dir] 要哈希的目录，默认为本文件所在的 lib/
 * @returns {string} 12 位十六进制
 */
export function computeBuildId(dir = HERE) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  }
  catch {
    return 'unknown';
  }
  const h = crypto.createHash('sha256');
  for (const f of names) {
    try {
      h.update(f);
      h.update(fs.readFileSync(path.join(dir, f)));
    }
    catch { /* 单个文件读不到就跳过，不阻断 */ }
  }
  return h.digest('hex').slice(0, 12);
}

export const BUILD_ID = computeBuildId();
