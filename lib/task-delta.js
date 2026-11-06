// task-delta.js —— 逐回合记录"世界到底被改了什么"，形成可校验的 delta 链。
//
// 依据两份实践：
//  1. Canaries, Not Faith（DEV）：快照前/后 diff + **允许清单** + 圈外的"绊线文件"；
//     原文自述短板：读操作不可见、写后恢复不可见 → "当作烟雾报警器，不是黑盒"。
//  2. microsoft/agent-governance-toolkit ADR-0023：**逐回合的 SemanticDelta**
//     {delta_id, turn_id, session_id, changes, parent_hash, delta_hash}，
//     hash 链 `SHA-256(parent_hash || canonical_json(delta))`，篡改可检测。
//
// 我们的用途：给"任务成果奖励"提供**客观终态证据**——
// 不比 model 说了什么，只比世界变了什么。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** 规范化 JSON（键排序），保证同一 delta 哈希稳定 */
function canonical(obj) {
  if (obj === null || typeof obj !== 'object')
    return JSON.stringify(obj);
  if (Array.isArray(obj))
    return '[' + obj.map(canonical).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

function walkFiles(root, ignore) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (ignore && ignore.some((re) => re.test(abs)))
        continue;
      if (e.isDirectory())
        stack.push(abs);
      else if (e.isFile())
        out.push(abs);
    }
  }
  return out;
}

/**
 * 建一个 delta 引擎。
 * @param {{roots: string[], ignore?: RegExp[], hashLimitBytes?: number}} opts
 *   roots：允许监视的根（超出范围的世界变化不算进来——这是"世界范围界定"的答案）
 *   ignore：忽略规则（node_modules、.git 之类）
 *   hashLimitBytes：超过这个大小的文件只记 size/mtime，不算哈希（防拖慢）
 */
export function createDeltaEngine(opts = {}) {
  const roots = (opts.roots || []).map((r) => path.resolve(r));
  const ignore = opts.ignore || [/[\\/]node_modules[\\/]/, /[\\/]\.git[\\/]/];
  const hashLimit = opts.hashLimitBytes ?? 2 * 1024 * 1024;
  const deltas = [];
  let baseline = null;
  let baselineTurn = null;

  function scan() {
    const map = new Map();
    for (const root of roots) {
      for (const abs of walkFiles(root, ignore)) {
        let st;
        try { st = fs.statSync(abs); }
        catch { continue; }
        map.set(abs, { size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      }
    }
    return map;
  }

  function hashOf(abs, size) {
    if (size > hashLimit)
      return null;
    try { return sha256(fs.readFileSync(abs)); }
    catch { return null; }
  }

  return {
    /** 开启一个回合：抓基线 */
    beginTurn(turnId) {
      baseline = scan();
      baselineTurn = turnId;
      return { turnId, files: baseline.size, roots };
    },

    /** 结束回合：算 delta 并入链 */
    endTurn(turnId) {
      const now = scan();
      const changes = [];
      for (const [abs, cur] of now) {
        const prev = baseline && baseline.get(abs);
        if (!prev) {
          changes.push({ path: abs, op: 'create', size: cur.size, hash: hashOf(abs, cur.size) });
        }
        else if (prev.size !== cur.size || prev.mtimeMs !== cur.mtimeMs) {
          changes.push({ path: abs, op: 'modify', size: cur.size, hash: hashOf(abs, cur.size), prevSize: prev.size });
        }
      }
      for (const [abs, prev] of (baseline || new Map())) {
        if (!now.has(abs))
          changes.push({ path: abs, op: 'delete', prevSize: prev.size });
      }
      changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

      const parentHash = deltas.length ? deltas[deltas.length - 1].deltaHash : 'genesis';
      const body = {
        deltaId: 'd' + (deltas.length + 1),
        turnId: turnId ?? baselineTurn,
        at: new Date().toISOString(),
        roots,
        changes,
        parentHash,
      };
      const deltaHash = sha256(parentHash + canonical(body));
      const delta = { ...body, deltaHash };
      deltas.push(delta);
      baseline = now;
      baselineTurn = turnId ?? baselineTurn;
      return delta;
    },

    /** 取整条链 */
    chain() {
      return deltas.slice();
    },

    /** 校验链：任何改动/删除都会被发现 */
    verifyChain() {
      let parent = 'genesis';
      for (let i = 0; i < deltas.length; i++) {
        const d = deltas[i];
        if (d.parentHash !== parent)
          return { ok: false, at: i, reason: 'parent_hash 不匹配' };
        const { deltaHash, ...body } = d;
        if (sha256(parent + canonical(body)) !== deltaHash)
          return { ok: false, at: i, reason: 'delta_hash 不匹配' };
        parent = deltaHash;
      }
      return { ok: true, count: deltas.length };
    },
  };
}
