// mirror-box.js —— 把「半个镜像箱子」升级成**可复位 + 可交叉校验**的箱子。
//
// 为什么需要它：
//   1. 我们的真值取自**活的操作系统**，而活系统会变（文件被删、端口被占、目录被清）。
//      今天的标定就踩过："state 里记了目录，但目录下文件没登记 → 重建后真值错了"。
//   2. 文献（arXiv 2609.22967）把 "sim-to-real gulf" 列为复现性三大挑战：
//      沙箱里的结论不能直接当真环境结论。
//
// 所以本模块只做三件事，**绝不替代真值判定**：
//   ① 快照：把箱子当前状态（存在性/大小/哈希/行数）记下来
//   ② 复位：按快照恢复（补文件、删多余、改内容）
//   ③ 交叉校验：拿快照当"历史真值"，和活系统现在的状态比，
//      不一致就报 DRIFT —— 这类断言应标 INCONCLUSIVE（环境不稳定），而不是 PASS/INVALID。
//
// 设计约束：只用 node 内置模块；所有路径限制在 box.root 内（防越界写）。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/** 在系统临时目录下建一个独立的箱子根。 */
export function createBox(prefix = 'cv-mirror-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { root };
}

/** 断言路径必须落在箱子内，防止快照/复位越界写到用户目录。 */
function safeJoin(box, rel) {
  const abs = path.resolve(box.root, rel);
  const rootAbs = path.resolve(box.root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep))
    throw new Error('mirror-box: 路径越界 ' + rel);
  return abs;
}

export function writeFile(box, rel, content) {
  const abs = safeJoin(box, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function hashOf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function walk(box, dir = box.root, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory())
      walk(box, abs, out);
    else if (e.isFile())
      out.push(path.relative(box.root, abs).split(path.sep).join('/'));
  }
  return out;
}

/** 快照：记录箱子内每个文件的大小 / 哈希 / 行数。 */
export function snapshot(box) {
  const entries = [];
  for (const rel of walk(box).sort()) {
    const abs = safeJoin(box, rel);
    const buf = fs.readFileSync(abs);
    const text = buf.toString('utf8');
    entries.push({
      rel,
      size: buf.length,
      hash: hashOf(buf),
      lines: text.length ? text.split('\n').length : 0,
      // 存下内容（base64）：复位才能**真正还原**，否则只能用占位内容补齐大小，
      // hash 永远对不上、漂移永远消不掉（第一版就踩了这个坑）。
      content: buf.toString('base64'),
    });
  }
  return { at: new Date().toISOString(), root: box.root, entries };
}

/** 按快照复位：补缺失、改内容、删多余。返回做了什么。 */
export function restore(box, snap) {
  const restored = [];
  const removed = [];
  const want = new Map((snap.entries || []).map((e) => [e.rel, e]));
  // 补/改
  for (const [rel, e] of want) {
    const abs = safeJoin(box, rel);
    let ok = false;
    try {
      const buf = fs.readFileSync(abs);
      ok = hashOf(buf) === e.hash;
    }
    catch { ok = false; }
    if (ok)
      continue;
    // 有内容就按内容还原（hash 才能对上），没有内容才退回占位补齐
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const body = typeof e.content === 'string' ? Buffer.from(e.content, 'base64') : Buffer.from('x'.repeat(e.size));
    fs.writeFileSync(abs, body);
    restored.push(rel);
  }
  // 删多余
  for (const rel of walk(box)) {
    if (want.has(rel))
      continue;
    fs.rmSync(safeJoin(box, rel), { force: true });
    removed.push(rel);
  }
  return { restored, removed };
}

/**
 * 交叉校验：快照（历史真值）vs 活系统（现在真值）。
 * 返回每个文件是否有漂移；drifted 为 true 的断言应判 INCONCLUSIVE。
 */
export function compareWithLive(box, snap) {
  const want = new Map((snap.entries || []).map((e) => [e.rel, e]));
  const live = new Set(walk(box));
  const drift = [];
  for (const [rel, e] of want) {
    if (!live.has(rel)) { drift.push({ rel, kind: 'missing', at: 'snapshot', detail: '快照有、现在没了' }); continue; }
    const buf = fs.readFileSync(safeJoin(box, rel));
    if (buf.length !== e.size) { drift.push({ rel, kind: 'size', at: 'snapshot', detail: `${e.size} → ${buf.length}` }); continue; }
    if (hashOf(buf) !== e.hash) { drift.push({ rel, kind: 'hash', at: 'snapshot', detail: '内容变了但大小相同' }); continue; }
  }
  for (const rel of live) {
    if (!want.has(rel))
      drift.push({ rel, kind: 'extra', at: 'live', detail: '现在多出来的文件' });
  }
  return { drifted: drift.length > 0, drift, checked: want.size };
}

/** 清理箱子 */
export function destroyBox(box) {
  try { fs.rmSync(box.root, { recursive: true, force: true }); } catch { /* 忽略 */ }
  return true;
}
