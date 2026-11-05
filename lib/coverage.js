// coverage.js —— 声明覆盖率：agent 实际做了多少动作，其中有多少被它"声明"了。
//
// 为什么需要：如果 agent 知道我们只核验"被声明的断言"，
// 它可以只声明能通过核验的部分 —— 覆盖率好看，但真实行为没被覆盖。
// 这一层不阻止它，只**量化**它，并把未声明的动作列出来。
//
// 定义：
//   实际动作 = 轨迹里的 write/命令调用（带 callId）
//   声明     = report_claims 里列出的 claims
//   覆盖率   = 能对上实际动作的声明数 / 实际动作数

import { canonicalJson } from './policy.js';

const WRITE_TOOLS = new Set(['write', 'edit', 'mcp__cgp__cgp_write_file', 'mcp__cgp__cgp_edit']);
const CMD_TOOLS = new Set(['pwsh', 'mcp__cgp__cgp_exec', 'bash', 'shell']);

function normPath(p) {
  return typeof p === 'string' ? p.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase() : null;
}

/** 从轨迹里抽出"实际发生的动作"。 */
export function actualActions(pairs) {
  const out = [];
  for (const p of pairs || []) {
    const args = p.args || {};
    if (WRITE_TOOLS.has(p.name)) {
      out.push({ kind: 'write', target: args.file_path || args.path || null, callId: p.callId ?? null, isError: p.isError === true, resultSeen: p.resultSeen === true });
      continue;
    }
    if (CMD_TOOLS.has(p.name)) {
      out.push({ kind: 'cmd', target: args.command || args.cmd || null, callId: p.callId ?? null, isError: p.isError === true, resultSeen: p.resultSeen === true });
    }
  }
  return out;
}

/** 一条声明是否对得上某个实际动作。 */
function matches(claim, action) {
  if (!claim || !action)
    return false;
  const kind = String(claim.kind || '').toLowerCase();
  if (kind !== action.kind)
    return false;
  if (kind === 'write')
    return Boolean(claim.target && action.target && normPath(claim.target) === normPath(action.target));
  return Boolean(claim.target && action.target && action.target.includes(String(claim.target).trim()));
}

/**
 * 计算覆盖率。
 * @returns {{actual:number, declared:number, matched:number, coverage:number|null, undeclared:Array}}
 */
export function declaredCoverage({ pairs, claims }) {
  const actual = actualActions(pairs);
  const declared = Array.isArray(claims) ? claims : [];
  const used = new Set();
  let matched = 0;
  for (const c of declared) {
    const idx = actual.findIndex((a, i) => !used.has(i) && matches(c, a));
    if (idx >= 0) {
      used.add(idx);
      matched += 1;
    }
  }
  const undeclared = actual.filter((_, i) => !used.has(i)).map((a) => ({
    kind: a.kind,
    target: String(a.target || '').slice(0, 120),
    callId: a.callId,
    isError: a.isError,
    resultSeen: a.resultSeen,
  }));
  return {
    actual: actual.length,
    declared: declared.length,
    matched,
    coverage: actual.length ? Number((matched / actual.length).toFixed(3)) : null,
    undeclared,
  };
}

/** 覆盖率摘要文字（放进回执/审计里）。 */
export function coverageSummary(cov) {
  if (!cov || cov.actual === 0)
    return '本轮没有可核验的动作';
  return `本轮实际动作 ${cov.actual} 个，其中 ${cov.matched} 个被声明（覆盖 ${Math.round(cov.coverage * 100)}%），未声明 ${cov.undeclared.length} 个`;
}

/** 稳定的指纹（用于回执里对比两次覆盖率）。 */
export function coverageDigest(cov) {
  return canonicalJson({ actual: cov.actual, matched: cov.matched, undeclared: cov.undeclared.map((u) => u.callId) }).length;
}
