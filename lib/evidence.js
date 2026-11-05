// evidence.js —— 把工具轨迹压成「实际发生了什么」的证据表。
//
// ★ 隔离约束（v0.3 的核心）★
//   本文件的任何函数都**不允许**接收 agent 的报告文本。函数签名里没有 reportText，
//   也不 import 任何与 claim/断言抽取相关的模块 —— 用类型和依赖把"报告污染"挡在门外。
//   依据：arXiv 2610.29609 证明，把自我报告放进判定会让危险误报召回率掉 13–43 个百分点。
//
// 工具→动作映射（2026-11-05 从本机真实会话实测，见 eval/arg-probe.mjs）：
//   write                      file_path + content         → 写文件
//   edit                       file_path + old/new_string  → 改文件
//   mcp__cgp__cgp_write_file    path + content              → 写文件
//   mcp__cgp__cgp_edit          path + oldString/newString  → 改文件
//   pwsh                       command                     → 执行命令
//   mcp__cgp__cgp_exec          cmd                         → 执行命令

/** 写/改文件的工具，以及从哪个参数取路径 */
export const WRITE_TOOLS = {
  write: { pathKey: 'file_path', verb: 'write' },
  edit: { pathKey: 'file_path', verb: 'modify' },
  'mcp__cgp__cgp_write_file': { pathKey: 'path', verb: 'write' },
  'mcp__cgp__cgp_edit': { pathKey: 'path', verb: 'modify' },
};

/** 执行命令的工具，以及从哪个参数取命令文本 */
export const CMD_TOOLS = {
  pwsh: 'command',
  'mcp__cgp__cgp_exec': 'cmd',
};

function normPath(p) {
  if (typeof p !== 'string')
    return null;
  let s = p.trim().replace(/^"|"$/g, '');
  if (s.startsWith('~/'))
    s = s.replace(/^~/, process.env.USERPROFILE || process.env.HOME || '~');
  return s.replace(/\//g, '\\').toLowerCase();
}

/**
 * 构建证据表。**签名里没有报告文本**——这是有意的。
 *
 * @param {Array} pairs     trace.pairs() 的产物
 * @param {boolean} truncated 轨迹是否被截断（截断时判定必须降级为 review）
 * @returns {{
 *   writes: Array<{path:string, tool:string, verb:string, ok:boolean, isError:boolean, seq:number|null}>,
 *   commands: Array<{cmd:string, tool:string, ok:boolean, isError:boolean, seq:number|null}>,
 *   counts: {calls:number, failed:number, writes:number, commands:number},
 *   truncated: boolean
 * }}
 */
export function buildEvidence(pairs, truncated = false) {
  const writes = [];
  const commands = [];

  for (const p of pairs || []) {
    const ok = !p.isError;
    const wt = WRITE_TOOLS[p.name];
    if (wt) {
      const raw = p.args?.[wt.pathKey];
      const path = normPath(raw);
      if (path) {
        writes.push({
          path,
          raw,
          tool: p.name,
          verb: wt.verb,
          ok,
          isError: Boolean(p.isError),
          resultSeen: Boolean(p.resultSeen),
          errorName: p.errorName,
          seq: p.callSeq ?? null,
        });
      }
      continue;
    }
    const ck = CMD_TOOLS[p.name];
    if (ck) {
      const cmd = p.args?.[ck];
      if (typeof cmd === 'string' && cmd.trim()) {
        commands.push({
          cmd: cmd.slice(0, 400),
          tool: p.name,
          ok,
          isError: Boolean(p.isError),
          resultSeen: Boolean(p.resultSeen),
          errorName: p.errorName,
          seq: p.callSeq ?? null,
        });
      }
    }
  }

  const failed = (pairs || []).filter((p) => p.isError).length;

  return {
    writes,
    commands,
    counts: {
      calls: (pairs || []).length,
      failed,
      writes: writes.length,
      commands: commands.length,
    },
    truncated: Boolean(truncated),
  };
}

/**
 * 快速检索：某个路径在本轮轨迹里有没有被写过/改过。
 * 只做精确路径匹配（大小写与斜杠已归一）；不做模糊匹配，避免误判。
 */
export function findWrite(evidence, path) {
  const key = normPath(path);
  if (!key)
    return null;
  return (evidence?.writes || []).find((w) => w.path === key) || null;
}

/** 本轮有没有跑过命令（任一成功/失败） */
export function commandsOf(evidence) {
  return evidence?.commands || [];
}
