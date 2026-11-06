// timeline-box.js —— 四维镜像箱子：不只是"现在什么样"，而是"每个时刻什么样"。
//
// 动机（来自今天的全部误报）：
//   「我写入了 X」这句话的真实含义是"**在某个时刻 X 存在过**"，
//   而我们的核验一直把它读成"**现在** X 存在" —— 这就是时点差的根源。
//
// 三维箱子（mirror-box）：存当前状态。
// 四维箱子（本文件）    ：存**时间线**，因此能回答"在 t 时刻为不为真"。
//
// 能做到完整四维的只有文件（内容可存、可回放）；
// 端口/服务/内存**无法倒带**，只能从此刻起采样 —— 这是 bounded verification 的物理边界。
//
// 设计：
//   - 内容寻址存储（blob 按 sha256 存，天然去重）
//   - 版本记录：{t, entries: {path -> {hash, size}}}，按时间有序
//   - 查询：stateAt(t) / existedBetween(path, t0, t1)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function createTimelineBox(root) {
  const blobs = path.join(root, 'blobs');
  fs.mkdirSync(blobs, { recursive: true });
  /** 时间线：按 t 升序 */
  const versions = [];
  /** path -> 出现过的版本（用于"曾经存在过"查询） */
  const history = new Map();

  function storeBlob(buf) {
    const h = sha256(buf);
    const p = path.join(blobs, h.slice(0, 2), h);
    if (!fs.existsSync(p)) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, buf);
    }
    return h;
  }

  return {
    /** 记录当前状态（一次"曝光"）：只对给定路径集合采样 */
    record(at, paths) {
      const entries = {};
      for (const abs of paths || []) {
        let buf;
        try { buf = fs.readFileSync(abs); }
        catch { continue; }
        const hash = storeBlob(buf);
        entries[abs] = { hash, size: buf.length };
        const list = history.get(abs) || [];
        list.push({ at, hash, size: buf.length });
        history.set(abs, list);
      }
      const rec = { at, entries };
      // 保持按时间有序（允许乱序插入）
      versions.push(rec);
      versions.sort((a, b) => a.at - b.at);
      return { at, count: Object.keys(entries).length, total: versions.length };
    },

    /** t 时刻的状态：取 <= t 的最近一次记录 */
    stateAt(t) {
      let chosen = null;
      for (const v of versions) {
        if (v.at <= t)
          chosen = v;
        else break;
      }
      return chosen ? { at: chosen.at, entries: { ...chosen.entries } } : null;
    },

    /** 某条路径在 [t0, t1] 内是否**曾经**存在过；返回首次出现的时刻 */
    existedBetween(abs, t0, t1) {
      const list = history.get(abs) || [];
      const hit = list.filter((h) => h.at >= t0 && h.at <= t1);
      return hit.length ? { existed: true, at: hit[0].at, hash: hit[0].hash, size: hit[0].size } : { existed: false };
    },

    /** 该路径的全部历史（世界线） */
    worldline(abs) {
      return (history.get(abs) || []).slice().sort((a, b) => a.at - b.at);
    },

    /** 某路径在 t 时刻的版本（用于"当时那份字节"） */
    versionAt(abs, t) {
      const list = (history.get(abs) || []).filter((h) => h.at <= t).sort((a, b) => b.at - a.at);
      return list.length ? list[0] : null;
    },

    stats() {
      return { versions: versions.length, paths: history.size };
    },

    /** 测试/演示用：清空时间线（不删 blob） */
    _reset() {
      versions.length = 0;
      history.clear();
    },
  };
}
