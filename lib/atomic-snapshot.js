// atomic-snapshot.js —— 一次读取，算出所有属性，避免 TOCTOU。
//
// 背景：现在 lines / size / hash 三类断言各自调用一次文件读取。
// 三个独立读取之间文件可能变（TOCTOU：time-of-check to time-of-use）：
//   - 行数和大小来自不同时刻的快照，可能自相矛盾
//   - 更糟的是"验证通过的那份字节"和"你声称的那份字节"可能不是同一份
//
// 业界做法（见 in-toto/witness 的 provenance、以及"bind verification to the bytes it verified"
// 这类修复）：**验证必须绑定到它实际读到的字节**。所以这里把一次读取的结果封成对象，
// 后续所有属性都从这份不可变快照里取。

import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * 读一次文件，返回不可变快照。
 * 不存在的文件返回 {exists:false}，不抛错（核验路径不该因为文件不在而炸）。
 */
export function readOnce(abs) {
  let buf;
  try {
    buf = fs.readFileSync(abs);
  }
  catch {
    return { exists: false, path: abs };
  }
  const text = buf.toString('utf8');
  return {
    exists: true,
    path: abs,
    size: buf.length,
    hash: crypto.createHash('sha256').update(buf).digest('hex'),
    // 与 host.countLines 口径保持一致：末尾换行不多算一行
    lines: text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0),
    at: new Date().toISOString(),
  };
}

/** 批量读取（同一批断言共用一个快照，保证彼此一致）。 */
export function readMany(paths) {
  const map = new Map();
  for (const p of paths || []) {
    if (typeof p !== 'string' || !p)
      continue;
    if (!map.has(p))
      map.set(p, readOnce(p));
  }
  return map;
}

/** 从快照取真值；没读到返回 null（调用方按 unknown 处理，绝不猜）。 */
export function truthOf(snapshotMap, abs) {
  const s = snapshotMap && snapshotMap.get ? snapshotMap.get(abs) : null;
  if (!s || !s.exists)
    return null;
  return { size: s.size, hash: s.hash, lines: s.lines };
}
