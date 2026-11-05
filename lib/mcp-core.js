// mcp-core.js —— MCP 服务的协议核心（与传输分离，便于测试）
//
// 暴露两个只读工具：
//   check_path  { path }                          → 文件是否存在
//   check_claim { kind, target, expect?, evidence} → supported / contradicted / insufficient
//
// 协议：JSON-RPC 2.0 over stdio（MCP 2024-11 规范的最小可用子集）

import fs from 'node:fs';
import { runPlan } from './dsl.js';
import { decideClaims } from './isolated-audit.js';

export const PROTOCOL_VERSION = '2024-11-05';

export const TOOLS = [
  {
    name: 'check_path',
    description: '检查本机路径是否存在（只读）',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '绝对路径' } },
      required: ['path'],
    },
  },
  {
    name: 'check_claim',
    description: '核验一条完成声明：给出 kind/target 与可选证据，返回 supported / contradicted / insufficient',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['write', 'port', 'cmd'], description: '声明类型' },
        target: { type: 'string', description: '对象（路径 / 端口 / 命令）' },
        expect: { type: 'boolean', description: '期望是否成立，默认 true' },
        evidence: {
          type: 'object',
          description: '可选：{ writes: [{path, isError}], cmds: [{cmd, isError}] }',
          properties: {
            writes: { type: 'array', items: { type: 'object' } },
            cmds: { type: 'array', items: { type: 'object' } },
          },
        },
      },
      required: ['kind', 'target'],
    },
  },
];

function textResult(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 1) }] };
}

async function callTool(name, args) {
  if (name === 'check_path') {
    const p = String(args?.path || '');
    const exists = fs.existsSync(p);
    return textResult({ path: p, exists, detail: exists ? '存在' : '不存在' });
  }
  if (name === 'check_claim') {
    const kind = String(args?.kind || '');
    const target = String(args?.target || '');
    if (!target)
      return { content: [{ type: 'text', text: '缺少 target' }], isError: true };
    // 有证据 → 走证据判定；无证据 → 走 OS 探测
    if (args?.evidence) {
      const r = decideClaims([{ kind, target }], args.evidence)[0];
      return textResult({ verdict: r.verdict, reason: r.reason });
    }
    if (kind === 'port') {
      const r = await runPlan({ all: [{ prim: 'port', args: { port: Number(target) }, expect: args?.expect !== false }] }, {});
      return textResult({ verdict: r.verdict, detail: r.results?.[0]?.detail });
    }
    if (kind === 'write' || kind === 'path') {
      const r = await runPlan({ all: [{ prim: 'exists', args: { path: target }, expect: args?.expect !== false }] }, {});
      return textResult({ verdict: r.verdict, detail: r.results?.[0]?.detail });
    }
    return textResult({ verdict: 'insufficient', reason: '未知 kind，或缺少 evidence' });
  }
  return { content: [{ type: 'text', text: '未知工具：' + name }], isError: true };
}

/** 处理一条 JSON-RPC 消息；返回响应对象（通知返回 null）。 */
export async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0')
    return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };

  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });

  if (method === 'initialize') {
    return ok({
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'claim-verify-wsc', version: '0.1.0' },
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized')
    return null;
  if (method === 'tools/list')
    return ok({ tools: TOOLS });
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      return ok(await callTool(name, args));
    }
    catch (e) {
      return { jsonrpc: '2.0', id, error: { code: -32603, message: String(e && e.message).slice(0, 200) } };
    }
  }
  if (method === 'ping')
    return ok({});
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } };
}
