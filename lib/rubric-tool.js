// rubric-tool.js —— 把「任务级验收」做成工具（task_accept）。
//
// 为什么必须做成工具而不是只在库里：schema 强制结构，模型没法把字段写歪；
// 而且**验收结果当场返回**，模型立刻知道"这次交付能不能收"。
//
// 证据从哪来：rubric 里每条 evidence 直接写成断言（kind/value/expect），
// 交给现有核验器去问 OS —— 这就是"可追溯"的落地：验收标准 → 具体断言 → 系统真值。
//
// 结构依据：工业界 Rubric 验收（required_evidence 程序化预检 + role 决定阻断权）；
// 粒度依据：arXiv 2510.03253 指出步骤级太细、轨迹级太粗，中间需要"验收项"这一层。

let defineTool = null;
try {
  ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
}
catch {
  defineTool = null;
}

export const TASK_TOOL_AVAILABLE = typeof defineTool === 'function';

export const EVIDENCE_KIND_ENUM = [
  'path', 'port', 'pid', 'filecount', 'size', 'lines', 'hash',
  'pkgversion', 'service', 'mem', 'disk',
];

export const EXPECT_ENUM = ['exists', 'not_exists', 'listening', 'not_listening', 'running', 'stopped'];

export const ROLE_ENUM = ['acceptance', 'theory', 'reflection'];

const VERDICT_ENUM = ['PASS', 'INVALID', 'INCONCLUSIVE'];

const RESULT_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    role: { type: 'string', required: true },
    status: { type: 'string', required: true },
    detail: { type: 'string' },
  },
};

/** 把工具参数里的一条 rubric 展开成"断言列表 + 元信息" */
export function expandRubric(raw) {
  const id = String(raw && raw.id || '').trim();
  const criterion = String(raw && raw.criterion || '').trim();
  const role = ROLE_ENUM.includes(raw && raw.role) ? raw.role : 'acceptance';
  const weight = Number.isFinite(Number(raw && raw.weight)) ? Number(raw.weight) : 1;

  const evidence = Array.isArray(raw && raw.evidence) ? raw.evidence : [];
  const claims = [];
  const kinds = [];
  for (const e of evidence) {
    const kind = String(e && e.kind || '').trim();
    if (!EVIDENCE_KIND_ENUM.includes(kind))
      continue;
    const expect = String(e && e.expect || 'exists').trim();
    let value = e && e.value;
    if (kind === 'port' || kind === 'pid')
      value = Number(String(value).trim());
    else if (kind === 'filecount') {
      try { value = typeof value === 'string' ? JSON.parse(value) : value; }
      catch { value = null; }
    }
    if (value === null || value === undefined)
      continue;
    claims.push({ kind, value, expect, polarity: /^(not_|stopped|absent)/.test(expect) ? 'neg' : 'pos', ctx: `验收项 ${id}` });
    kinds.push(kind);
  }

  return { id, criterion, role, weight, claims, kinds: [...new Set(kinds)] };
}

export function makeTaskAcceptTool(deps = {}) {
  if (!TASK_TOOL_AVAILABLE)
    return null;
  const { verifyClaims, cfg, onResult } = deps;
  if (typeof verifyClaims !== 'function')
    return null;

  return defineTool({
    name: 'task_accept',
    description: [
      '任务级验收：给出一组可检查的验收标准，当场用系统真值逐条核对，返回 PASS / INVALID / INCONCLUSIVE。',
      '每条标准带 role（acceptance 能阻断交付；theory/reflection 只记录）与 evidence（具体断言，如 path 存在、port 监听）。',
      '与 commit_claims 的区别：commit_claims 问"我这句话对不对"，task_accept 问"这次交付能不能收"。不修改任何文件。',
    ].join(''),
    parameters: {
      rubrics: {
        type: 'array',
        required: true,
        description: '验收标准列表',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: '验收项标识' },
            criterion: { type: 'string', required: true, description: '要检查什么' },
            role: { type: 'string', enum: ROLE_ENUM, description: 'acceptance 能阻断交付；theory/reflection 只记录' },
            weight: { type: 'number', description: '权重，默认 1' },
            evidence: {
              type: 'array',
              description: '支撑这条标准的断言（交给核验器去问系统）',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, enum: EVIDENCE_KIND_ENUM },
                  value: { type: 'string', required: true },
                  expect: { type: 'string', enum: EXPECT_ENUM },
                },
              },
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          verdict: { type: 'string', required: true, enum: VERDICT_ENUM },
          score: { type: 'integer', required: true },
          results: { type: 'array', required: true, items: RESULT_ITEM },
        },
      },
      render: (_args, value) => {
        const head = `任务验收：${value?.verdict || 'INCONCLUSIVE'}（评分 ${value?.score ?? 0}）`;
        const rows = (value?.results || []).map((r) => `  [${r.role}] ${r.id} ${r.status}${r.detail ? '  ' + r.detail : ''}`);
        return [{ type: 'text', text: [head, ...rows].join('\n') }];
      },
    },
    async execute(args) {
      const raw = Array.isArray(args?.rubrics) ? args.rubrics : [];
      const expanded = raw.map(expandRubric).filter((r) => r.id);
      if (!expanded.length)
        return { verdict: 'INCONCLUSIVE', score: 0, results: [] };

      // 1) 一次性把所有证据断言交给核验器
      const allClaims = [];
      for (const r of expanded) {
        for (const c of r.claims)
          allClaims.push({ ...c, __rubric: r.id });
      }
      const res = allClaims.length
        ? await verifyClaims(allClaims, 'task-accept', cfg, {})
        : { bad: [], checked: 0 };
      const badKeys = new Set();
      for (const b of (res.bad || [])) {
        const k = b.claim && (b.claim.__rubric + '|' + b.claim.kind + '|' + JSON.stringify(b.claim.value));
        if (k)
          badKeys.add(k);
      }

      // 2) 证据齐不齐（预检）+ 判定
      const available = [...new Set(expanded.flatMap((r) => r.kinds))];
      // evaluateTask 传进来的 rubric 是**规范化后的**（只有 required_evidence），
      // 所以判定器要用 id 回查展开后的 claims —— 直接用 r.claims 会拿不到。
      const byId = new Map(expanded.map((r) => [r.id, r]));
      const judge = (r) => {
        const own = byId.get(r.id);
        if (!own || !own.claims.length)
          return null; // 没有证据 → 交给 evaluateTask 标 INCONCLUSIVE
        const bads = own.claims.filter((c) => badKeys.has(own.id + '|' + c.kind + '|' + JSON.stringify(c.value)));
        if (bads.length)
          return { ok: false, detail: '证据不符：' + bads.map((c) => c.kind).join(',') };
        return { ok: true, detail: '证据成立' };
      };

      // 3) 用 rubric.js 统一聚合（角色分桶 + 权重评分）
      const { evaluateTask, summarizeTask } = await import('./rubric.js');
      const out = await evaluateTask({
        rubrics: expanded.map((r) => ({
          id: r.id,
          criterion: r.criterion,
          role: r.role,
          weight: r.weight,
          required_evidence: r.kinds,
        })),
        available,
        judge,
      });

      const results = out.results.map((r) => ({ id: r.id, role: r.role, status: r.status, detail: String(r.detail || '') }));
      if (typeof onResult === 'function') {
        try {
          onResult({
            verdict: out.verdict,
            score: out.score,
            summary: summarizeTask(out),
            results,
            forced: out.forced,
            gaps: out.gaps,
          });
        }
        catch { /* 记录失败不影响返回 */ }
      }
      return { verdict: out.verdict, score: out.score, results };
    },
  });
}
