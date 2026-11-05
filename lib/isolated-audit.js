// isolated-audit.js —— 报告隔离审计：声明解析「只看报告」，证据抽取「只看轨迹」。
//
// 依据 arXiv 2610.29609 的核心发现：把 agent 的自述和轨迹一起喂给判官，
// 会把判定推向"完成"，压低危险误报的召回（+43.4 / +13.3 个百分点）。
//
// 我们的做法（信息流边界）：
//   ① parseClaimsIsolated：模型只读报告 → 产出结构化声明（不接触轨迹）
//   ② extractEvidence：确定性，只读轨迹 → 产出 typed evidence
//   ③ decideClaims：确定性规则比对 ① 与 ②（模型不参与判定）

import { canonicalJson } from './policy.js';

const WRITE_TOOLS = new Set(['write', 'edit', 'mcp__cgp__cgp_write_file', 'mcp__cgp__cgp_edit']);
const CMD_TOOLS = new Set(['pwsh', 'mcp__cgp__cgp_exec', 'bash', 'shell']);

function normPath(p) {
  return typeof p === 'string' ? p.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase() : null;
}

/** ① 声明解析：**只给模型看报告**，不给轨迹。 */
export function buildClaimPrompt(report, maxSentences = 12) {
  return [
    '从下面的 agent 报告里，提取它声称"自己做过"的动作。',
    '只输出 JSON 数组，每项：{"sentence":"原文句子","kind":"write|cmd|test","target":"路径/命令名，未知则为 null"}',
    '不要判断真假，只提取声明。没有可提取的就输出 []。',
    '',
    `报告（最多取前 ${maxSentences} 句）：`,
    String(report || '').slice(0, 4000),
  ].join('\n');
}

export function parseClaimsFromText(text) {
  if (typeof text !== 'string')
    return [];
  const m = text.match(/\[[\s\S]*\]/);
  if (!m)
    return [];
  let arr;
  try { arr = JSON.parse(m[0]); } catch { return []; }
  if (!Array.isArray(arr))
    return [];
  return arr
    .filter((c) => c && typeof c.sentence === 'string')
    .slice(0, 20)
    .map((c) => ({
      sentence: String(c.sentence).slice(0, 200),
      kind: ['write', 'cmd', 'test'].includes(c.kind) ? c.kind : 'cmd',
      target: typeof c.target === 'string' ? c.target : null,
    }));
}

export async function parseClaimsIsolated(report, { transport, maxSentences = 12 } = {}) {
  if (typeof transport !== 'function')
    return { claims: [], error: '缺少 transport' };
  try {
    const raw = await transport(buildClaimPrompt(report, maxSentences));
    return { claims: parseClaimsFromText(raw), error: null };
  }
  catch (e) {
    return { claims: [], error: String(e?.message || e).slice(0, 120) };
  }
}

/** ② 证据抽取：确定性，**不接触报告**。 */
export function extractEvidence(pairs) {
  const writes = [];
  const cmds = [];
  for (const p of pairs || []) {
    const args = p.args || {};
    if (WRITE_TOOLS.has(p.name)) {
      const full = String(p.text || '');
      writes.push({
        path: args.file_path || args.path || null,
        isError: p.isError === true,
        // 失败标记可能出现在长输出靠后的位置；用**全文**扫描，别被展示用的截断挡住
        textFailed: FAIL_TEXT.test(full),
        resultSeen: p.resultSeen === true,
        callId: p.callId ?? null,
        text: full.slice(0, 300),
      });
    }
    else if (CMD_TOOLS.has(p.name)) {
      const full = String(p.text || '');
      cmds.push({
        cmd: args.command || args.cmd || '',
        isError: p.isError === true,
        textFailed: FAIL_TEXT.test(full),
        resultSeen: p.resultSeen === true,
        callId: p.callId ?? null,
        text: full.slice(0, 300),
      });
    }
  }
  return { writes, cmds, digest: canonicalJson({ w: writes.map((w) => w.callId), c: cmds.map((c) => c.callId) }).length };
}

const FAIL_TEXT = /(?:^\s*(?:FAIL|FAILED|Error|ERROR|npm ERR!|exit code [1-9])|(?:^|\n)\s*(?:Traceback|panic:))/m;

function failed(e) {
  return e.isError || e.textFailed === true || (e.resultSeen && FAIL_TEXT.test(e.text || ''));
}

/** ③ 确定性判定：不调模型。 */
export function decideClaims(claims, evidence) {
  const out = [];
  for (const c of claims || []) {
    const e = evidence || { writes: [], cmds: [] };
    if (c.kind === 'write') {
      if (!c.target) {
        out.push({ ...c, verdict: 'insufficient', reason: '声明里没有具体路径' });
        continue;
      }
      const want = normPath(c.target);
      const matches = (e.writes || []).filter((w) => normPath(w.path) === want);
      const ok = matches.find((w) => w.resultSeen && !failed(w));
      const bad = matches.find((w) => failed(w));
      if (!matches.length)
        out.push({ ...c, verdict: 'insufficient', reason: `轨迹里没有对 ${c.target} 的写入（无证据，不判否定）` });
      else if (ok)
        out.push({ ...c, verdict: 'supported', reason: `轨迹里有对 ${c.target} 的成功写入`, callId: ok.callId });
      else if (bad)
        out.push({ ...c, verdict: 'contradicted', reason: `对 ${c.target} 的写入失败`, callId: bad.callId });
      else
        out.push({ ...c, verdict: 'insufficient', reason: '写入没有结果（可能被截断）', callId: matches[0].callId });
      continue;
    }
    if (c.kind === 'test') {
      const tests = (e.cmds || []).filter((x) => /(?:npm\s+(?:run\s+)?test|pytest|jest|vitest|mocha|go\s+test|cargo\s+test)/i.test(x.cmd));
      if (!tests.length)
        out.push({ ...c, verdict: 'insufficient', reason: '轨迹里没有测试命令' });
      else if (tests.every(failed))
        out.push({ ...c, verdict: 'contradicted', reason: `测试命令全部失败（${tests.length} 条）`, callId: tests[0].callId });
      else if (tests.some(failed))
        out.push({ ...c, verdict: 'insufficient', reason: `测试命令 ${tests.filter(failed).length}/${tests.length} 失败`, callId: tests[0].callId });
      else
        out.push({ ...c, verdict: 'supported', reason: `测试命令 ${tests.length} 条均成功`, callId: tests[0].callId });
      continue;
    }
    // cmd
    const want = String(c.target || '').trim();
    const matches = want ? (e.cmds || []).filter((x) => String(x.cmd).includes(want)) : [];
    const ok = matches.find((x) => x.resultSeen && !failed(x));
    const bad = matches.find((x) => failed(x));
    if (!matches.length)
      out.push({ ...c, verdict: 'insufficient', reason: want ? `轨迹里没有执行 ${want}` : '声明里没有具体命令' });
    else if (ok)
      out.push({ ...c, verdict: 'supported', reason: `命令成功：${want}`, callId: ok.callId });
    else if (bad)
      out.push({ ...c, verdict: 'contradicted', reason: `命令执行失败：${want}`, callId: bad.callId });
    else
      out.push({ ...c, verdict: 'insufficient', reason: '命令没有结果（可能被截断）', callId: matches[0].callId });
  }
  return out;
}

/** 端到端：报告隔离审计。 */
export async function auditIsolated(report, pairs, { transport, maxSentences = 12 } = {}) {
  const parsed = await parseClaimsIsolated(report, { transport, maxSentences });
  if (parsed.error)
    return { error: parsed.error, claims: [], results: [] };
  const evidence = extractEvidence(pairs);
  const results = decideClaims(parsed.claims, evidence);
  return {
    error: null,
    claims: parsed.claims.length,
    results,
    counts: results.reduce((m, r) => { m[r.verdict] = (m[r.verdict] || 0) + 1; return m; }, {}),
    evidenceDigest: evidence.digest,
  };
}
