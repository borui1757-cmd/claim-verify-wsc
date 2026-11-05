// report-tool.js —— 把「结构化声明」做成一个工具，而不是让模型写代码块。
//
// 为什么用工具：schema 由工具参数强制（模型没法把格式写歪），且所有支持 tool calling 的
// 模型都能用；比在提示词里约定 ```claims 块稳得多。
//
// 这个工具的价值不只是"记一笔"：它把判定结果**当场返回给模型**，模型还有机会改口。

import { judgeDeclaredClaims } from './receipt.js';

// dsh-tools 是可选的：在 DSH 宿主里用工具调用，脱离 DSH（CLI/测试）时降级为空实现。
let defineTool = null;
try {
  ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
}
catch {
  defineTool = null;
}

export const REPORT_TOOL_AVAILABLE = typeof defineTool === 'function';

export const CLAIM_KINDS = ['write', 'cmd', 'port', 'path', 'time', 'date', 'math', 'count'];

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    total: { type: 'integer', required: true },
    supported: { type: 'integer', required: true },
    contradicted: { type: 'integer', required: true },
    insufficient: { type: 'integer', required: true },
  },
};

const RESULT_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', required: true },
      target: { type: 'string', required: true },
      verdict: { type: 'string', required: true, enum: ['supported', 'contradicted', 'insufficient'] },
      reason: { type: 'string', required: true },
      evidenceTool: { type: 'string' },
    },
  },
};

/**
 * 造一个 report_claims 工具。
 * @param {{getPairs:(sessionId:string)=>Array}} deps getPairs 返回该会话的工具轨迹配对
 */
export function makeReportClaimsTool(deps = {}) {
  if (!REPORT_TOOL_AVAILABLE)
    return null;
  const getPairs = typeof deps.getPairs === 'function' ? deps.getPairs : () => [];
  return defineTool({
    name: 'report_claims',
    description: [
      '声明你这轮实际做了什么（写/改了哪些文件、跑了哪些命令），由核验器对着工具轨迹逐条核对。',
      '返回 supported（有成功调用）/ contradicted（调用报错）/ insufficient（没有对应调用）。',
      '交付前调用一次；它不会改任何文件，只做核对。',
    ].join(''),
    parameters: {
      claims: {
        type: 'array',
        required: true,
        description: '你要声称的动作列表。kind=write 时 target 是文件路径；kind=cmd 时 target 是命令文本。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: CLAIM_KINDS, description: 'write | cmd | 其它（其它第一期只返回 insufficient）' },
            target: { type: 'string', required: true, description: '文件路径或命令文本' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: SUMMARY_SCHEMA,
          results: RESULT_SCHEMA,
        },
      },
      // 注意：render 必须放在 output 里（defineTool 读 options.output.render），
      // 放顶层会变成 userRender is not a function。
      render: (_args, value) => {
        const s = value?.summary || {};
        return [{
          type: 'text',
          text: `声明核对：${s.total || 0} 条 —— ${s.supported || 0} 支持 / ${s.contradicted || 0} 反驳 / ${s.insufficient || 0} 无证据`,
        }];
      },
    },
    execute(args, exec) {
      const sessionId = (exec && exec.agent && exec.agent.session && exec.agent.session.id) || null;
      const pairs = getPairs(sessionId);
      const judged = judgeDeclaredClaims(Array.isArray(args?.claims) ? args.claims : [], pairs);
      const results = judged.map((r) => ({
        kind: String(r.claim?.kind ?? ''),
        target: String(r.claim?.target ?? ''),
        verdict: r.verdict,
        reason: String(r.reason || ''),
        ...(r.evidence?.tool ? { evidenceTool: r.evidence.tool } : {}),
      }));
      const summary = {
        total: results.length,
        supported: results.filter((r) => r.verdict === 'supported').length,
        contradicted: results.filter((r) => r.verdict === 'contradicted').length,
        insufficient: results.filter((r) => r.verdict === 'insufficient').length,
      };
      return Promise.resolve({ summary, results });
    },
  });
}
