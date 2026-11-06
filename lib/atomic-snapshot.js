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

/**
 * 快照是否已过期：重读一次，哈希和快照不一致就是变了。
 * 用于解决「同一批断言里文件被改写多次」——不能拿入口那份快照一直用下去。
 */
export function isStale(entry, abs) {
  if (!entry || !entry.exists)
    return true;
  const now = readOnce(abs);
  if (!now.exists)
    return true;
  return now.hash !== entry.hash;
}

/**
 * 双采样：活状态（端口/服务）没有"字节"可绑定，只能探两次。
 * 两次不一致说明状态正在变，应判 INCONCLUSIVE 而不是 PASS/INVALID。
 * @param {() => Promise<boolean>} probe 单次探测
 * @param {number} gapMs 两次之间的间隔
 */
export async function doubleSample(probe, gapMs = 120) {
  const a = await probe();
  if (a)
    return { value: true, stable: true, samples: [true] };
  // 只有"没探测到"才值得再采一次：这是最容易误判成 INVALID 的方向
  await new Promise((r) => setTimeout(r, gapMs));
  const b = await probe();
  if (b === a)
    return { value: a, stable: true, samples: [a, b] };
  return { value: null, stable: false, samples: [a, b] };
}
