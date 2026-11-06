// commit-tool.js —— 把「承诺」做成一个**工具**，而不是让模型写 ```claims 代码块。
//
// 为什么必须用工具：schema 由工具参数强制，模型没法把格式写歪；
// 而"在散文里输出 JSON 再解析"是公认的反模式（见 output-structured-via-forced-tool）。
// 参考 ARC (NeurIPS 2026)：每步要求 agent 做出可被观测证伪的预测；
// CLAIMRECEIPT (NeurIPS 2026)：判定三态 PASS / INVALID / INCONCLUSIVE。
//
// 这个工具的价值不只是"记一笔"：它把判定结果**当场返回给模型**，模型还有机会改口。

// dsh-tools 可选：宿主里用工具调用，脱离宿主（CLI/测试）时返回 null。
let defineTool = null;
try {
  ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
}
catch {
  defineTool = null;
}

export const COMMIT_TOOL_AVAILABLE = typeof defineTool === 'function';

/** 支持的断言类型（与 verifyClaims / verifyHostClaim 对齐） */
export const COMMIT_KINDS = [
  'path', 'port', 'pid', 'filecount', 'size', 'lines', 'hash',
  'pkgversion', 'service', 'mem', 'disk',
];

/** 声明方式 → 极性 */
export const COMMIT_EXPECTS = ['exists', 'not_exists', 'listening', 'not_listening', 'running', 'stopped'];

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    total: { type: 'integer', required: true },
    pass: { type: 'integer', required: true },
    invalid: { type: 'integer', required: true },
    inconclusive: { type: 'integer', required: true },
  },
};

const RESULT_SCHEMA = {
  type: 'array',
  required: true,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', required: true },
      verdict: { type: 'string', required: true },
      detail: { type: 'string' },
    },
  },
};

/** 把工具参数里的字符串 value 还原成断言需要的形式 */
export function normalizeCommitValue(kind, raw) {
  const s = typeof raw === 'string' ? raw.trim() : raw;
  if (kind === 'port' || kind === 'pid')
    return Number(s);
  if (kind === 'filecount') {
    if (s && typeof s === 'object')
      return s;
    try { return JSON.parse(s); }
    catch { return null; }
  }
  return s;
}

export function makeCommitClaimsTool(deps = {}) {
  if (!COMMIT_TOOL_AVAILABLE)
    return null;
  const { verifyClaims, verifyHostClaim, verifyCommitments, summarize, cfg, onResult } = deps;
  if (typeof verifyClaims !== 'function' || typeof verifyCommitments !== 'function')
    return null;

  return defineTool({
    name: 'commit_claims',
    description: [
      '声明这批动作的可核验结果，由核验器当场对着系统真值核对，并返回三态：',
      'PASS（与真值一致）/ INVALID（不符）/ INCONCLUSIVE（取不到真值）。',
      '只声明你做过的、可被系统验证的事，不要写计划或观点。它不改任何文件。',
    ].join(''),
    parameters: {
      claims: {
        type: 'array',
        required: true,
        description: '要声明的断言列表。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: COMMIT_KINDS, description: '断言类型' },
            value: { type: 'string', required: true, description: '目标：路径 / 端口号 / filecount 的 {"dir","n"} JSON' },
            expect: { type: 'string', required: true, enum: COMMIT_EXPECTS, description: '你声明它应该处于什么状态' },
            evidence: { type: 'string', description: '支撑这条断言的工具调用（可选，仅记录）' },
          },
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { summary: SUMMARY_SCHEMA, results: RESULT_SCHEMA } },
      render: (_args, value) => {
        const s = value?.summary || {};
        const bad = (value?.results || []).filter((r) => r.verdict === 'INVALID');
        const head = `承诺核对：${s.total || 0} 条 —— ${s.pass || 0} 通过 / ${s.invalid || 0} 不符 / ${s.inconclusive || 0} 无法判定`;
        const lines = bad.length
          ? bad.map((r) => `  ✗ ${r.kind}：${r.detail || '与真值不符'}`).join('\n')
          : '';
        return [{ type: 'text', text: lines ? head + '\n' + lines : head }];
      },
    },
    async execute(args) {
      const raw = Array.isArray(args?.claims) ? args.claims : [];
      const items = [];
      for (const c of raw) {
        if (!c || typeof c !== 'object')
          continue;
        const kind = String(c.kind || '').trim();
        if (!COMMIT_KINDS.includes(kind))
          continue;
        const value = normalizeCommitValue(kind, c.value);
        if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value)))
          continue;
        const expect = String(c.expect || 'exists').trim();
        items.push({
          kind,
          value,
          expect,
          polarity: /^(not_|stopped|absent)/.test(expect) ? 'neg' : 'pos',
          evidence: typeof c.evidence === 'string' ? c.evidence.slice(0, 120) : null,
        });
      }
      const summary = await verifyCommitments(items, { verifyClaims, verifyHostClaim, cfg });
      const results = summary.results.map((r) => ({
        kind: r.kind,
        verdict: r.verdict,
        detail: String(r.detail || ''),
      }));
      if (typeof onResult === 'function') {
        try { onResult({ summary: { total: summary.total, pass: summary.pass, invalid: summary.invalid, inconclusive: summary.inconclusive }, results }); }
        catch { /* 记录失败不影响返回 */ }
      }
      return {
        summary: { total: summary.total, pass: summary.pass, invalid: summary.invalid, inconclusive: summary.inconclusive },
        results,
      };
    },
  });
}
