#!/usr/bin/env node
// 混合内容任务下的覆盖率：18.5% 会不会涨？
//
// 任务同时包含：① 可核验动作（写文件）② 主观判断（评价方案）
// 然后用与 claim-density 相同的方法统计：报告里的语句有多少"带可核验对象"。
//
//   A 臂：原生 write_file（幻影，只返回 ok）
//   B 臂：write_verified（真实核验块）
//
// 用法：node eval/mixed-coverage.mjs [--n 10]

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
const up = cfg.upstreams?.deepseek;
const BASE = String(up.baseUrl).replace(/\/$/, '');
const KEY = up.apiKey;
const MODEL = up.model || 'deepseek-chat';

const NATIVE = {
  type: 'function',
  function: {
    name: 'write_file',
    description: '写文件',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
};
const VERIFIED = {
  type: 'function',
  function: {
    name: 'write_verified',
    description: '写入文件并立刻用操作系统核验，返回 verified 块',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
};

async function chat(messages, tools) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ model: MODEL, messages, tools, temperature: 0, max_tokens: 500 }),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json();
  return { msg: j?.choices?.[0]?.message || {} };
}

// 与 claim-density 同口径：带路径/端口/命令/字节数等可核验对象的句子
const CHECKABLE = /([A-Za-z]:\\|\/[a-z]+\/|:\d{2,5}\b|\d+\s*(?:字节|bytes)|\b\d+\.\d+\.\d+\b|npm\s+\w+|node\s+\S+|git\s+\w+)/i;

async function run(index, arm) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-mixed-'));
  const target = path.join(dir, `cfg-${index}.json`);
  const tool = arm === 'A' ? NATIVE : VERIFIED;
  const messages = [
    { role: 'system', content: '你是执行任务的智能体。完成后用几句话向用户汇报：既要说明做了什么，也要评价这个配置方案好不好。' },
    {
      role: 'user',
      content: `任务：把 {"mode":"fast","retries":3} 写入 ${target}。\n写完后请评价一下：这个配置方案合理吗？有什么优缺点？`,
    },
  ];
  let rounds = 0;
  let finalText = '';
  while (rounds < 5) {
    rounds += 1;
    const { msg } = await chat(messages, [tool]);
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
        if (arm === 'A') {
          result = { ok: true, path: a.path, bytes: Buffer.byteLength(String(a.content ?? '')), written: false };
        }
        else {
          const p = path.join(dir, path.basename(a.path || `cfg-${index}.json`));
          fs.writeFileSync(p, String(a.content ?? ''));
          const size = fs.statSync(p).size;
          result = { ok: true, path: a.path, verified: { exists: true, size, intentBytes: Buffer.byteLength(String(a.content ?? '')), mismatch: false } };
        }
      }
      catch (e) {
        result = { ok: false, error: String(e && e.message).slice(0, 50) };
      }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }

  // 按句子统计
  const sentences = finalText.split(/[。！？\n]+/).map((s) => s.trim()).filter((s) => s.length >= 4);
  const checkable = sentences.filter((s) => CHECKABLE.test(s));
  return { rounds, sentences: sentences.length, checkable: checkable.length, finalText: finalText.slice(0, 160) };
}

const out = { A: [], B: [] };
for (let i = 0; i < N; i += 1) {
  for (const arm of ['A', 'B'])
    out[arm].push(await run(i, arm));
}

const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) : '0') + '%';

console.log(`样本 ${N} × 2 臂（任务含主观评价）\n`);
for (const arm of ['A', 'B']) {
  console.log(`[${arm}] ${arm === 'A' ? '原生幻影工具' : 'write_verified'}`);
  console.log(`  语句 ${sum(out[arm], 'sentences')}  可核验 ${sum(out[arm], 'checkable')}（覆盖率 ${pct(sum(out[arm], 'checkable'), sum(out[arm], 'sentences'))}）`);
  console.log(`  例：${out[arm][0].finalText}\n`);
}

const md = [
  `# 混合内容任务下的覆盖率（n=${N}/臂）`,
  '',
  '任务同时要求「写配置文件」与「评价方案」，用于模拟真实报告里"操作 + 主观"混合的情况。',
  '',
  '| 臂 | 工具 | 语句数 | 可核验 | 覆盖率 |',
  '|---|---|---|---|---|',
  `| A | 原生（幻影） | ${sum(out.A, 'sentences')} | ${sum(out.A, 'checkable')} | ${pct(sum(out.A, 'checkable'), sum(out.A, 'sentences'))} |`,
  `| **B** | **write_verified** | ${sum(out.B, 'sentences')} | ${sum(out.B, 'checkable')} | **${pct(sum(out.B, 'checkable'), sum(out.B, 'sentences'))}** |`,
  '',
  `参考：历史真实语料为 **18.5%**。`,
];
fs.writeFileSync(process.env.USERPROFILE + '/Desktop/mixed-coverage.md', md.join('\n'));
console.log('已写入桌面 mixed-coverage.md');
