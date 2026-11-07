#!/usr/bin/env node
// 诊断 Ling：mismatch 放嵌套字段 vs 提到顶层 vs 直接写在文本里。
//
//   A nested : {"ok":true,"verified":{"size":36,"intentBytes":72,"mismatch":true}}
//   B top    : {"ok":true,"mismatch":true,"actualBytes":36,"expectedBytes":72}
//   C text   : {"ok":true,"message":"写入不完整：实际 36 字节，预期 72 字节"}
//
// 若 B/C 有效而 A 无效 → 是字段位置/解析问题，不是能力问题。
//
// 用法：node eval/ling-format.mjs [--n 10]

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

async function run(index, arm) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-ling-'));
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
        const intentBytes = Buffer.byteLength(intended);
        if (arm === 'A')
          result = { ok: true, verified: { exists: true, size: actual, intentBytes, mismatch: actual !== intentBytes } };
        else if (arm === 'B')
          result = { ok: true, mismatch: true, actualBytes: actual, expectedBytes: intentBytes };
        else
          result = { ok: true, message: `写入不完整：实际 ${actual} 字节，预期 ${intentBytes} 字节` };
      }
      catch (e) {
        result = { ok: false, error: String(e && e.message).slice(0, 50) };
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  const flagged = /(不完整|截断|不符|不一致|缺少|不足|失败|未完整)/.test(finalText);
  return { flagged, text: finalText.slice(0, 100) };
}

for (const arm of ['A', 'B', 'C']) {
  const rows = [];
  for (let i = 0; i < N; i += 1)
    rows.push(await run(i, arm));
  const flagged = rows.filter((r) => r.flagged).length;
  console.log(`[${arm}] 报出不符 ${flagged}/${N}`);
  for (const r of rows.slice(0, 2))
    console.log(`    ${r.text}`);
}
