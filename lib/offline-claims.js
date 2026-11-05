// offline-claims.js —— 离线语料加宽：用"轨迹里有没有对应动作"来判定断言，不调模型。
//
// 与 promise.js 的区别：promise 面向"完成声明"（测试通过/服务重启），
// 这里面向更朴素的三类：写了某文件、跑了某命令、某路径存在。
// 判据全部来自**已记录的工具配对**，不读当前状态、不调模型。

import { canonicalJson } from './policy.js';

const WRITE_TOOLS = new Set(['write', 'edit', 'mcp__cgp__cgp_write_file', 'mcp__cgp__cgp_edit']);
const CMD_TOOLS = new Set(['pwsh', 'mcp__cgp__cgp_exec', 'bash', 'shell']);

const PATH_RE = /(?:[A-Za-z]:[\\/][^\s"'`，。；、）)\]}>]+)/;

function normPath(p) {
  return typeof p === 'string' ? p.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase() : null;
}

function actsOf(pairs) {
  const writes = [];
  const cmds = [];
  for (const p of pairs || []) {
    const args = p.args || {};
    if (WRITE_TOOLS.has(p.name))
      writes.push({ path: args.file_path || args.path || null, isError: p.isError === true, resultSeen: p.resultSeen === true, callId: p.callId ?? null });
    else if (CMD_TOOLS.has(p.name))
      cmds.push({ cmd: args.command || args.cmd || '', isError: p.isError === true, resultSeen: p.resultSeen === true, callId: p.callId ?? null });
  }
  return { writes, cmds };
}

/**
 * 从报告里抽"轨迹可判"的断言。
 * @returns {Array<{sentence, kind, verdict, reason, callId, source}>}
 */
export function extractOfflineClaims(report, pairs) {
  const { writes, cmds } = actsOf(pairs);
  const out = [];
  const seen = new Set();
  const push = (sentence, kind, verdict, reason, callId) => {
    const key = normPath(sentence);
    if (!key || seen.has(key))
      return;
    seen.add(key);
    out.push({ sentence: String(sentence).slice(0, 200), kind, verdict, reason, callId, source: 'offline-trajectory' });
  };

  const sentences = String(report || '').split(/[。！？；\n]+/).map((s) => s.trim()).filter((s) => s.length >= 6);

  for (const s of sentences) {
    // ① 写入类
    const wm = s.match(/(?:写入|写了|创建了|保存到)(?:了)?\s*([A-Za-z]:[\\/][^\s"'`，。；、）)\]}>]+)/);
    if (wm) {
      const want = normPath(wm[1]);
      const hit = writes.find((w) => normPath(w.path) === want);
      if (hit && !hit.isError && hit.resultSeen)
        push(s, 'write', 'supported', `轨迹里有对 ${hit.path} 的成功写入`, hit.callId);
      else if (hit && hit.isError)
        push(s, 'write', 'contradicted', `轨迹里对 ${hit.path} 的写入报错`, hit.callId);
      continue;
    }
    // ② 命令类
    const cm = s.match(/(?:跑了|执行了|运行了)\s*([^\s，。；]{2,40})/);
    if (cm) {
      const want = cm[1].trim();
      const hit = cmds.find((c) => c.cmd && String(c.cmd).includes(want));
      if (hit && hit.resultSeen && !hit.isError)
        push(s, 'cmd', 'supported', `轨迹里有成功的命令：${want}`, hit.callId);
      else if (hit && hit.isError)
        push(s, 'cmd', 'contradicted', `轨迹里命令失败：${want}`, hit.callId);
      continue;
    }
    // ③ 路径存在类（只认"读/写成功过"作为存在证据；没有就跳过，不猜）
    const pm = s.match(/([A-Za-z]:[\\/][^\s"'`，。；、）)\]}>]+)\s*(?:存在|在)/);
    if (pm) {
      const want = normPath(pm[1]);
      const hit = writes.find((w) => normPath(w.path) === want && !w.isError && w.resultSeen);
      if (hit)
        push(s, 'exists', 'supported', `轨迹里成功写过 ${hit.path}（可推知存在）`, hit.callId);
      continue;
    }
  }
  return out;
}

/** 样本指纹（去重用）。 */
export function claimKey(c) {
  return canonicalJson({ s: csv(normPath(c.sentence)), v: c.verdict });
}

function csv(s) {
  return s || '';
}
