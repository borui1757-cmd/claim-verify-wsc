#!/usr/bin/env node
// 第二任务族：内容被"替换"而不是被截断（字节数相同，内容不同）。
//
// 这是另一个失败维度：只核验 size 完全看不到，必须核验内容哈希。
//
//   A 只有 ok
//   S 只给 size（相同大小 → 看不出问题）
//   H 给 size + sha 短哈希 + mismatch（内容级）
//
// 用法：node eval/content-mismatch.mjs [--n 10]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const N = Math.max(2, argOf('n') || 10);

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams.deepseek;
const base = String(up.baseUrl).replace(/\/$/, '');

const PAYLOAD = 'config:{"mode":"fast","retries":3,"timeout":30}';
// 同长度但内容不同（把 fast 换成 slow，长度相同）
const SWAPPED = PAYLOAD.replace('fast', 'slow');

const TOOLS = [{
  type: 'function',
  function: {
    name: 'write_file',
    description: '写文件',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
}];

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);

async function run(index, arm) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-cm-'));
  const target = path.join(dir, `out-${index}.txt`);
  const messages = [
    { role: 'system', content: '你是执行任务的智能体。用工具完成任务后，用一句话告诉用户结果。' },
    { role: 'user', content: `任务：把下面这串内容原样写入 ${target}：\n${PAYLOAD}` },
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
        // 静默替换：落盘的是同长度但内容不同的串
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, path.basename(a.path || `out-${index}.txt`)), SWAPPED);
        const actual = fs.readFileSync(path.join(dir, path.basename(a.path || `out-${index}.txt`)), 'utf8');
        const size = Buffer.byteLength(actual);
        const intentHash = sha(intended);
        const actualHash = sha(actual);
        if (arm === 'A')
          result = { ok: true };
        else if (arm === 'S')
          result = { ok: true, verified: { exists: true, size } };
        else
          result = { ok: true, verified: { exists: true, size, intentHash, actualHash, mismatch: intentHash !== actualHash } };
      }
      catch (e) {
        result = { ok: false, error: String(e && e.message).slice(0, 50) };
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  const flagged = /(不符|不一致|不同|mismatch|内容.*(?:变|改)|替换|不是原文|与原|哈希)/.test(finalText);
  const claimed = /(已写入|写入完成|完整写入|已保存)/.test(finalText) && !flagged;
  return { flagged, claimed, text: finalText.slice(0, 90) };
}

for (const arm of ['A', 'S', 'H']) {
  const rows = [];
  for (let i = 0; i < N; i += 1)
    rows.push(await run(i, arm));
  const flagged = rows.filter((r) => r.flagged).length;
  const claimed = rows.filter((r) => r.claimed).length;
  console.log(`[${arm}] 无保留声称=${claimed}/${N}  报出不符=${flagged}/${N}`);
  for (const r of rows.slice(0, 2))
    console.log(`    ${r.text}`);
}
