#!/usr/bin/env node
// claim-verify MCP 服务（stdio，JSON-RPC 2.0，按行分隔）
//
// 用法（任何 MCP 客户端）：
//   command: node
//   args: ["bin/mcp-server.mjs"]
//
// 手动试：
//   echo {"jsonrpc":"2.0","id":1,"method":"tools/list"} | node bin/mcp-server.mjs

import readline from 'node:readline';
import { handleMessage } from '../lib/mcp-core.js';

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  const t = line.trim();
  if (!t)
    return;
  let msg;
  try {
    msg = JSON.parse(t);
  }
  catch {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
    return;
  }
  const res = await handleMessage(msg);
  if (res)
    process.stdout.write(JSON.stringify(res) + '\n');
});
