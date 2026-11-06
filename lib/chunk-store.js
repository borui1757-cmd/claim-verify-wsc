// chunk-store.js —— 内容定义分块（content-defined chunking），让时间线能"存完整历史"而不爆盘。
//
// 类比：Git / restic / borg 的 CDC（content-defined chunking）。
//   普通去重只按"整文件哈希"，改一个字节 = 整份新内容。
//   CDC 用**滚动哈希找边界**，插入一个字节只影响附近 1–2 个块，
//   于是"每次小改动"的存储成本从 O(文件大小) 降到 O(改动大小)。
//
// 为什么需要：timeline-box 现在是全量存 blob，一个 1MB 文件改 10 次就 10MB。
//
// 实现：简化版 FastCDC（最小/平均/最大块长 + 掩码找边界），只依赖 node 内置。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// buzhash：定长窗口的滚动哈希（XOR + 旋转），插入字节后边界能**重新同步**。
// 第一版用的是"累积式"哈希（h = h<<1 + byte），它对位置敏感——
// 中间插一个字节会让后面所有边界平移，结果整份文件全都变块、去重率 0。
// 这是 CDC 的经典坑：必须用**窗口**哈希，而不是累积哈希。
const WINDOW = 64;
const TABLE = (() => {
  // 确定性伪随机表，保证同一份内容在任何机器上切出同样的块
  let s = 0x9e3779b9;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    t[i] = s;
  }
  return t;
})();

const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

/**
 * 把 buffer 切成内容定义的块。
 * 边界由**内容**决定（不是固定位置），所以插入/删除只影响局部。
 */
export function chunkBuffer(buf, opts = {}) {
  const avg = opts.avg || 2048;
  const min = opts.min || Math.floor(avg / 4);
  const max = opts.max || avg * 4;
  const mask = avg - 1;

  const chunks = [];
  let start = 0;
  let h = 0;
  const ring = new Uint8Array(WINDOW);

  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    const out = ring[i % WINDOW];
    ring[i % WINDOW] = b;
    // 滚出旧字节、滚入新字节
    h = (rotl(h, 1) ^ TABLE[b] ^ rotl(TABLE[out], WINDOW % 32)) >>> 0;

    const len = i - start + 1;
    if (len < min)
      continue;
    if (((h & mask) === 0) || len >= max) {
      chunks.push(buf.subarray(start, i + 1));
      start = i + 1;
      h = 0;
      ring.fill(0);
    }
  }
  if (start < buf.length)
    chunks.push(buf.subarray(start));
  return chunks;
}

/** 内容寻址的块存储：同一块只存一次。 */
export function createChunkStore(root) {
  const dir = path.join(root, 'chunks');
  fs.mkdirSync(dir, { recursive: true });

  function chunkPath(h) {
    return path.join(dir, h.slice(0, 2), h);
  }

  return {
    /** 存一个 buffer，返回 {hash, chunks:[{hash,size}], bytesStored} */
    put(buf) {
      const pieces = chunkBuffer(buf);
      const refs = [];
      let stored = 0;
      for (const piece of pieces) {
        const h = sha256(piece);
        const p = chunkPath(h);
        if (!fs.existsSync(p)) {
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, piece);
          stored += piece.length;
        }
        refs.push({ hash: h, size: piece.length });
      }
      // 文件哈希用它所有块的哈希组合算出（确定性）
      const hash = sha256(refs.map((r) => r.hash).join(','));
      return { hash, chunks: refs, bytesStored: stored, totalBytes: buf.length };
    },

    /** 按块引用还原内容 */
    get(refs) {
      const parts = [];
      for (const r of refs || []) {
        const p = chunkPath(r.hash);
        if (!fs.existsSync(p))
          return null;
        parts.push(fs.readFileSync(p));
      }
      return Buffer.concat(parts);
    },

    /** 统计：块数量与占用字节 */
    stats() {
      let files = 0;
      let bytes = 0;
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory())
            walk(p);
          else {
            files += 1;
            bytes += fs.statSync(p).size;
          }
        }
      };
      walk(dir);
      return { chunks: files, bytes };
    },
  };
}
