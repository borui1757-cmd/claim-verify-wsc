#!/usr/bin/env node
// 路线对比：动作都走核验工具，只改报告方式。
//
//   A：write_verified + 自由文本报告
//   B：write_verified + 结构化 report_claims
//
// 测：报告里"带对象且能被核验"的声称占比（覆盖率）。
//
// 用法：node eval/route-ab.mjs [--n 8]

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

const WRITE = {
  type: 'function',
  function: {
    name: 'write_verified',
    description: '写入文件并立刻用操作系统核验，返回 verified 块',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
};
const REPORT = {
  type: 'function',
  function: {
    name: 'report_claims',
    description: '以结构化方式报告你实际完成的动作（每条一个声明，必须含对象）',
    parameters: {
      type: 'object',
      properties: {
        claims: {
          type: 'array',
          items: {
            type: 'object',
            properties: { kind: { type: 'string', enum: ['write'] }, target: { type: 'string' } },
            required: ['kind', 'target'],
          },
        },
      },
      required: ['claims'],
    },
  },
};

async function chat(messages, tools) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ model: MODEL, messages, tools, temperature: 0, max_tokens: 400 }),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json();
  return { msg: j?.choices?.[0]?.message || {} };
}

async function run(index, arm) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-route-'));
  const files = [1, 2, 3].map((k) => path.join(dir, `r${k}-${index}.txt`));
  const contents = ['alpha', 'bravo', 'charlie'];
  const tools = arm === 'B' ? [WRITE, REPORT] : [WRITE];
  const sys = arm === 'B'
    ? '你是执行任务的智能体。做完后用 report_claims 报告你实际完成的每一个写入（每条含具体路径）。'
    : '你是执行任务的智能体。用工具完成任务后，用一句话告诉用户结果。';
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: `任务：写入三个文件：\n${files.map((f, i) => `- ${f} 内容为 "${contents[i]}"`).join('\n')}` },
  ];
  let rounds = 0;
  let finalText = '';
  let declared = [];
  const verifiedPaths = new Set();
  while (rounds < 6) {
    rounds += 1;
    const { msg } = await chat(messages, tools);
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
        if (c.function.name === 'write_verified') {
          const base = path.basename(String(a.path || ''));
          fs.writeFileSync(path.join(dir, base), String(a.content ?? ''));
          const size = fs.statSync(path.join(dir, base)).size;
          verifiedPaths.add(base);
          result = { ok: true, path: a.path, verified: { exists: true, size } };
        }
        else if (c.function.name === 'report_claims') {
          const list = Array.isArray(a.claims) ? a.claims : [];
          declared = list.map((x) => String(x.target || ''));
          result = { ok: true, accepted: list.length };
        }
        else {
          result = { ok: false, error: 'unknown' };
        }
      }
      catch (e) {
        result = { ok: false, error: String(e && e.message).slice(0, 40) };
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }
  const onDisk = files.filter((f) => fs.existsSync(f)).length;
  // 覆盖率：有多少条"带对象的声称"能被核验
  let withObject = 0;
  if (arm === 'B') {
    withObject = declared.filter((t) => t && /[\\/]/.test(t)).length;
  }
  else {
    for (const f of files)
      if (finalText.includes(path.basename(f)))
        withObject += 1;
  }
  const backed = [...verifiedPaths].filter((b) => (arm === 'B' ? declared.some((t) => t.includes(b)) : finalText.includes(b))).length;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  return { rounds, onDisk, withObject, backed, finalText: finalText.slice(0, 100), declared: declared.length };
}

const out = { A: [], B: [] };
for (let i = 0; i < N; i += 1) {
  for (const arm of ['A', 'B'])
    out[arm].push(await run(i, arm));
}

const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
const actions = N * 3;

for (const arm of ['A', 'B']) {
  console.log(`[${arm}] ${arm === 'A' ? '自由文本报告' : '结构化声明'}`);
  console.log(`  带对象的声称=${sum(out[arm], 'withObject')}/${actions}  有 verified 背书=${sum(out[arm], 'backed')}/${actions}  真实落盘=${sum(out[arm], 'onDisk')}/${actions}`);
  for (const r of out[arm].slice(0, 2))
    console.log(`    例：${r.finalText}`);
  console.log('');
}

const md = [
  `# 路线对比：动作都走核验工具，只改报告方式（n=${N}）`,
  '',
  '| 臂 | 报告方式 | 带对象的声称 | verified 背书 |',
  '|---|---|---|---|',
  `| A | 自由文本 | ${sum(out.A, 'withObject')}/${actions} | ${sum(out.A, 'backed')}/${actions} |`,
  `| **B** | **结构化声明** | **${sum(out.B, 'withObject')}/${actions}** | **${sum(out.B, 'backed')}/${actions}** |`,
];
fs.writeFileSync(process.env.USERPROFILE + '/Desktop/route-ab.md', md.join('\n'));
console.log('已写入桌面 route-ab.md');
