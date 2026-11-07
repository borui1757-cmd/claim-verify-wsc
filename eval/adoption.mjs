#!/usr/bin/env node
// 绕过覆盖率上限的前提：模型真的走核验工具吗？
//
// 同时提供两个写工具：
//   write_file      原生风格——永远返回 {"ok":true}，但实际不落盘（幻影）
//   write_verified  我们的工具——真实写入 + verified 块
//
// 任务：写 3 个文件。统计：
//   ① 有多少次写入走了 verified 通道（采纳率）
//   ② 最终报告里有多少条声称有 verified 背书（覆盖率）
//
// 用法：node eval/adoption.mjs [--n 8]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const N = Math.max(2, argOf('n') || 8);

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams?.deepseek;
const BASE = String(up.baseUrl).replace(/\/$/, '');
const KEY = up.apiKey;
const MODEL = up.model || 'deepseek-chat';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '写文件（原生工具）',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_verified',
      description: '写入文件并立刻用操作系统核验，返回 verified 块（真实字节数）',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    },
  },
];

async function chat(messages) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, temperature: 0, max_tokens: 400 }),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json();
  return { msg: j?.choices?.[0]?.message || {} };
}

async function run(index) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-adopt-'));
  const files = [1, 2, 3].map((k) => `${path.join(dir, `f${k}.txt`)}`);
  const contents = ['one', 'two', 'three'];
  const messages = [
    { role: 'system', content: '你是执行任务的智能体。用工具完成任务后，用一句话告诉用户结果。' },
    { role: 'user', content: `任务：写入三个文件：\n${files.map((f, i) => `- ${f} 内容为 "${contents[i]}"`).join('\n')}` },
  ];
  let rounds = 0;
  let finalText = '';
  let native = 0;
  let verified = 0;
  const verifiedPaths = new Set();

  while (rounds < 6) {
    rounds += 1;
    const { msg } = await chat(messages);
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
        const base = path.basename(String(a.path || ''));
        if (c.function.name === 'write_file') {
          native += 1;
          // 幻影：不落盘，但返回 ok
          result = { ok: true, path: a.path, bytes: Buffer.byteLength(String(a.content ?? '')), written: false };
        }
        else {
          verified += 1;
          fs.writeFileSync(path.join(dir, base), String(a.content ?? ''));
          const actual = fs.statSync(path.join(dir, base)).size;
          verifiedPaths.add(base);
          result = { ok: true, path: a.path, bytes: actual, verified: { exists: true, size: actual } };
        }
      }
      catch (e) {
        result = { ok: false, error: String(e && e.message).slice(0, 60) };
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }

  // 真正落盘的文件数（fs 真值）
  const onDisk = files.filter((f) => fs.existsSync(f)).length;
  // 报告里提到且被 verified 背书的文件数
  const backed = [...verifiedPaths].filter((b) => finalText.includes(b)).length;
  const claimsOk = /(已写入|已完成|写好了|已创建|写入成功)/.test(finalText);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  return { rounds, native, verified, onDisk, backed, claimsOk, finalText: finalText.slice(0, 100) };
}

const rows = [];
for (let i = 0; i < N; i += 1)
  rows.push(await run(i));

const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
const totalWrites = sum('native') + sum('verified');
const adopt = totalWrites ? (sum('verified') / totalWrites * 100).toFixed(1) : '0';
const fullyVerified = rows.filter((r) => r.native === 0).length;

console.log(`样本 ${N}\n`);
for (const r of rows)
  console.log(`  native=${r.native} verified=${r.verified} 落盘=${r.onDisk}/3 背书=${r.backed} 声称成功=${r.claimsOk} "${r.finalText}"`);

console.log(`\n写入总次数 ${totalWrites}；走 verified 的 ${sum('verified')} 次（采纳率 ${adopt}%）`);
console.log(`完全没用原生工具的样本：${fullyVerified}/${N}`);
console.log(`平均真实落盘文件：${(sum('onDisk') / N).toFixed(1)}/3`);

const md = [
  `# 核验工具的采纳率（${N} 次）`,
  '',
  '同时提供原生 `write_file`（幻影）与 `write_verified`（真实核验），观察模型选哪个。',
  '',
  `| 指标 | 数值 |`,
  `|---|---|`,
  `| 写入总次数 | ${totalWrites} |`,
  `| 走 verified | ${sum('verified')}（**采纳率 ${adopt}%**） |`,
  `| 走原生（幻影） | ${sum('native')} |`,
  `| 完全没用原生的样本 | ${fullyVerified}/${N} |`,
  `| 平均真实落盘 | ${(sum('onDisk') / N).toFixed(1)}/3 |`,
];
fs.writeFileSync(process.env.USERPROFILE + '/Desktop/adoption.md', md.join('\n'));
console.log('\n已写入桌面 adoption.md');
