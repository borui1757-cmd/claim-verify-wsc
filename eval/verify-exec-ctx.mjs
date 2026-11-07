#!/usr/bin/env node
// 变体：给模型运行时上下文（进程名 / 监听端口 / 目录片段）后再做转化。
// 问题：转化率是否从 0% 上升？
//
// 用法：node eval/verify-exec-ctx.mjs [--n 12]

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PRIMS, runPlan } from '../lib/dsl.js';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const N = Math.max(4, argOf('n') || 12);

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams?.deepseek;
const BASE = String(up.baseUrl).replace(/\/$/, '');
const KEY = up.apiKey;
const MODEL = up.model || 'deepseek-chat';

// ── 运行时上下文（从外部 JSON 读取，避免脚本内 spawn 被沙箱拦截）
const CTX_FILE = (() => {
  const i = args.indexOf('--ctx');
  return i >= 0 && i + 1 < args.length ? args[i + 1] : 'C:/Users/19156/Desktop/_ctx.json';
})();
const ctx = fs.existsSync(CTX_FILE)
  ? JSON.parse(fs.readFileSync(CTX_FILE, 'utf8').replace(/^\uFEFF/, ''))
  : { processes: [], listeningPorts: [] };
if (!ctx.processes?.length && !ctx.listeningPorts?.length) {
  console.error(`上下文为空：${CTX_FILE} 不存在或没有数据。`);
  process.exit(2);
}
console.log(`上下文：进程 ${ctx.processes.length} 个，监听端口 ${ctx.listeningPorts.length} 个\n`);

const CASES = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/data/harvested-cases.jsonl';
const cases = fs.readFileSync(CASES, 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const CLAIM_RE = /(已完成|已实现|已修复|已优化|完成|成功|提升|改善|稳定|健壮|更快|更好|没问题|正常|进程|端口)/;
const sentences = [];
const seen = new Set();
for (const c of cases) {
  for (const s of String(c.report || '').split(/[。！？\n]+/)) {
    const t = s.trim();
    if (t.length < 8 || t.length > 120 || !CLAIM_RE.test(t) || seen.has(t))
      continue;
    seen.add(t);
    sentences.push(t);
    if (sentences.length >= N * 4)
      break;
  }
  if (sentences.length >= N * 4)
    break;
}
const step = Math.max(1, Math.floor(sentences.length / N));
const picked = sentences.filter((_, i) => i % step === 0).slice(0, N);

const SYS = [
  '你有本机运行时上下文。把用户给的一句话转成"可被下列原语检查"的断言。',
  '原语与参数：port{port}, exists{path}, proc_alive{pid}, http_status{url,status}, dir_count{dir,ext,count}。',
  '规则：args 的每个值都必须是你在上下文中真实看到的对象；看不到就输出 {"assertions":[]}。',
  '只输出 JSON：{"assertions":[{"prim":"...","args":{...}}]}',
].join('\n');

async function convert(sentence) {
  const user = [
    `可用进程（部分）：${ctx.processes.join(', ') || '（无）'}`,
    `监听端口：${ctx.listeningPorts.join(', ') || '（无）'}`,
    '',
    `句子：${sentence}`,
  ].join('\n');
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: SYS }, { role: 'user', content: user }], temperature: 0, max_tokens: 240 }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  const txt = String(j?.choices?.[0]?.message?.content || '');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m)
    return [];
  try {
    const o = JSON.parse(m[0]);
    return Array.isArray(o.assertions) ? o.assertions : [];
  }
  catch { return []; }
}

const valid = (a) => {
  const p = PRIMS[a?.prim];
  if (!p || !a.args) return '未知原语或缺 args';
  for (const [k, fn] of Object.entries(p.params || {})) {
    if (!(k in a.args)) return `缺参数 ${k}`;
    try { if (!fn(a.args[k])) return `参数 ${k} 非法`; } catch { return `参数 ${k} 非法`; }
  }
  return null;
};

const rows = [];
for (const s of picked) {
  const assertions = await convert(s);
  const detail = [];
  for (const a of assertions) {
    const err = valid(a);
    if (err) { detail.push({ prim: a?.prim, ok: false, why: err }); continue; }
    let ran = false;
    try {
      const r = await runPlan({ all: [{ prim: a.prim, args: a.args, expect: true }] }, {});
      ran = r.verdict === 'supported' || r.verdict === 'contradicted';
    }
    catch { ran = false; }
    detail.push({ prim: a.prim, ok: ran, why: ran ? '' : '执行失败' });
  }
  rows.push({ sentence: s, n: assertions.length, detail });
}

const total = rows.length;
const proposed = rows.reduce((a, r) => a + r.n, 0);
const executed = rows.reduce((a, r) => a + r.detail.filter((d) => d.ok).length, 0);
const withExec = rows.filter((r) => r.detail.some((d) => d.ok)).length;

console.log(`抽样 ${total} 句\n`);
for (const r of rows) {
  const good = r.detail.filter((d) => d.ok).length;
  console.log(`${good > 0 ? '✅' : '⚠️ '} ${r.sentence.slice(0, 40)}`);
  for (const d of r.detail)
    console.log(`      ${d.ok ? '执行成功' : '失败'} ${d.prim} ${d.why}`);
}
console.log(`\n提出断言 ${proposed}；可执行 ${executed}；有可执行断言的句子 ${withExec}/${total}`);

const md = [
  `# 带运行时上下文的转化（抽样 ${total} 句）`,
  '',
  `上下文：进程 ${ctx.processes.length} 个、监听端口 ${ctx.listeningPorts.length} 个`,
  '',
  `| 指标 | 数值 |`,
  `|---|---|`,
  `| 提出断言 | ${proposed} |`,
  `| 可执行 | ${executed} |`,
  `| 有可执行断言的句子 | ${withExec}/${total}（${(withExec / total * 100).toFixed(1)}%） |`,
  '',
  '## 逐句',
  ...rows.map((r) => `\n**${r.sentence.slice(0, 50)}**\n${r.detail.map((d) => `- ${d.ok ? '✅' : '❌'} ${d.prim} ${d.why}`).join('\n') || '- （未给出断言）'}`),
];
fs.writeFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/eval/verify-exec-ctx.md', md.join('\n'));
console.log('\n已写入 eval/verify-exec-ctx.md');
