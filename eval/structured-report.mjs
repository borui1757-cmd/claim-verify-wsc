#!/usr/bin/env node
// 结构化声明能否提升动作覆盖率？
//
//   A 自由文本报告：按子串匹配统计动作覆盖率
//   B 结构化声明（report_claims 工具）：按声明条数统计
//
// 任务：写两个文件；每种方式各 8 次。
//
// 用法：node eval/structured-report.mjs [--n 8]

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

const WRITE = { type: 'function', function: { name: 'write_file', description: '写文件', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } };
const REPORT = {
  type: 'function',
  function: {
    name: 'report_claims',
    description: '以结构化方式报告你实际完成的动作（每条一个声明）',
    parameters: {
      type: 'object',
      properties: {
        claims: {
          type: 'array',
          items: {
            type: 'object',
            properties: { kind: { type: 'string', enum: ['write', 'cmd'] }, target: { type: 'string' } },
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
  return { msg: j?.choices?.[0]?.message || {}, usage: j?.usage || {} };
}

async function run(index, arm) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-sr-'));
  const files = Array.from({ length: 10 }, (_, k) => `f${k}-${index}.txt`);
  const tools = arm === 'B' ? [WRITE, REPORT] : [WRITE];
  const sys = arm === 'B'
    ? '你是执行任务的智能体。做完后用 report_claims 报告你实际完成了哪些动作（每个文件一条）。'
    : '你是执行任务的智能体。做完后用一句话告诉用户结果。';
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: `任务：在工作目录依次写入 10 个文件 ${files.join(', ')}，每个文件内容写它自己的文件名。` },
  ];
  let rounds = 0;
  let tokens = 0;
  let done = 0;
  let declared = 0;
  let finalText = '';
  while (rounds < 6) {
    rounds += 1;
    const { msg, usage } = await chat(messages, tools);
    tokens += (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
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
        if (c.function.name === 'write_file') {
          fs.writeFileSync(path.join(dir, path.basename(a.path || files[0])), String(a.content ?? ''));
          done += 1;
          result = { ok: true };
        }
        else if (c.function.name === 'report_claims') {
          const list = Array.isArray(a.claims) ? a.claims : [];
          declared = list.length;
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
  // A 臂：按子串匹配统计报告覆盖率
  let covered = 0;
  if (arm === 'A') {
    const text = finalText.toLowerCase();
    for (const f of files)
      if (text.includes(f.toLowerCase()))
        covered += 1;
  }
  else {
    covered = Math.min(declared, done);
  }
  const ok = files.every((f) => fs.existsSync(path.join(dir, f)));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  return { rounds, tokens, done, covered, declared, ok, finalText: finalText.slice(0, 40) };
}

const out = { A: [], B: [] };
for (let i = 0; i < N; i += 1) {
  for (const arm of ['A', 'B'])
    out[arm].push(await run(i, arm));
}

const rate = (rows) => {
  const acts = rows.reduce((a, r) => a + r.done, 0);
  const cov = rows.reduce((a, r) => a + r.covered, 0);
  return (acts ? (cov / acts * 100).toFixed(1) : '0') + '%';
};

console.log(`样本 ${N} × 2 臂\n`);
for (const arm of ['A', 'B']) {
  console.log(`[${arm}]`);
  for (const r of out[arm])
    console.log(`  动作=${r.done} 覆盖=${r.covered} 声明=${r.declared} 文件齐=${r.ok}`);
  console.log(`  覆盖率=${rate(out[arm])}\n`);
}

const md = [
  `# 结构化声明对覆盖率的影响（${N} 次/臂）`,
  '',
  '| 臂 | 报告方式 | 动作覆盖率 |',
  '|---|---|---|',
  `| A | 自由文本 | ${rate(out.A)} |`,
  `| B | report_claims 结构化 | ${rate(out.B)} |`,
];
fs.writeFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/eval/structured-report.md', md.join('\n'));
console.log('已写入 eval/structured-report.md');
