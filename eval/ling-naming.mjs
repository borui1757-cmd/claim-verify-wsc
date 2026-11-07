#!/usr/bin/env node
// 隔离实验：结构与嵌套完全一致，只改键名。
//
//   N1 {verified:{actualBytes, expectedBytes}}   显式成对
//   N2 {verified:{size, intentBytes}}            模糊（之前 0/10 的形态）
//   N3 {verified:{size, expected}}               一半显式
//
// 用法：node eval/ling-naming.mjs [--n 10]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const N = Math.max(2, argOf('n') || 10);

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams.ling;
const base = String(up.baseUrl).replace(/\/$/, '');
const PAYLOAD = 'ALPHA-BRAVO-CHARLIE-DELTA-ECHO-FOXTROT-GOLF-HOTEL-INDIA-JULIET-KILO-LIMA';

const TOOLS = [{
  type: 'function',
  function: {
    name: 'write_file',
    description: '写文件',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
}];

// 三个形态都嵌在 verified 里，字段数相同、类型相同，只有键名不同
const SHAPE = {
  N1: (a, b) => ({ ok: true, verified: { actualBytes: a, expectedBytes: b } }),
  N2: (a, b) => ({ ok: true, verified: { size: a, intentBytes: b } }),
  N3: (a, b) => ({ ok: true, verified: { size: a, expected: b } }),
};

async function run(index, arm) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-ln-'));
  const target = path.join(dir, `out-${index}.txt`);
  const messages = [
    { role: 'system', content: '你是执行任务的智能体。用工具完成任务后，用一句话告诉用户结果。' },
    { role: 'user', content: `任务：把下面这串内容完整写入 ${target}，一个字都不能少：\n${PAYLOAD}` },
  ];
  let rounds = 0;
  let finalText = '';
  while (rounds < 4) {
    rounds += 1;
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
      body: JSON.stringify({ model: up.model, messages, tools: TOOLS, temperature: 0, max_tokens: 300 }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json();
    const msg = j?.choices?.[0]?.message || {};
    messages.push(msg);
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      finalText = String(msg.content || '');
      break;
    }
    for (const c of calls) {
      let result;
      try {
        const a = JSON.parse(c.function.arguments || '{}');
        const intended = String(a.content ?? '');
        const trunc = intended.slice(0, Math.max(1, Math.floor(intended.length / 2)));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, path.basename(a.path || `out-${index}.txt`)), trunc);
        const actual = Buffer.byteLength(fs.readFileSync(path.join(dir, path.basename(a.path || `out-${index}.txt`))));
        result = SHAPE[arm](actual, Buffer.byteLength(intended));
      }
      catch (e) {
        result = { ok: false, error: String(e && e.message).slice(0, 50) };
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  const flagged = /(不完整|截断|不符|不一致|缺少|不足|失败|未完整)/.test(finalText);
  return { flagged, text: finalText.slice(0, 70) };
}

for (const arm of ['N1', 'N2', 'N3']) {
  const rows = [];
  for (let i = 0; i < N; i += 1)
    rows.push(await run(i, arm));
  console.log(`[${arm}] 报出不符 ${rows.filter((r) => r.flagged).length}/${N}`);
  for (const r of rows.slice(0, 1))
    console.log(`    ${r.text}`);
}
