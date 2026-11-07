#!/usr/bin/env node
// 可行性测试：那 81.5% 不可核验的声明，有多少能被转化成可测形式？
//
// 做法：从真实报告抽 50 句声明，问模型"能否转化成可测断言"，统计转化率。
// 判据：转化的定义是——至少给出一条能落到操作系统原语上的断言。
//
// 用法：node eval/verifiability.mjs [--n 50]

import fs from 'node:fs';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const N = Math.max(10, argOf('n') || 50);

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams?.deepseek;
const BASE = String(up.baseUrl).replace(/\/$/, '');
const KEY = up.apiKey;
const MODEL = up.model || 'deepseek-chat';

const CASES = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/data/harvested-cases.jsonl';
const cases = fs.readFileSync(CASES, 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// 抽句子：含完成/评价语义的短句
const CLAIM_RE = /(已完成|已实现|已修复|已优化|完成|成功|提升|改善|稳定|健壮|优雅|更快|更好|没问题|正常)/;
const sentences = [];
const seen = new Set();
for (const c of cases) {
  for (const s of String(c.report || '').split(/[。！？\n]+/)) {
    const t = s.trim();
    if (t.length < 8 || t.length > 120)
      continue;
    if (!CLAIM_RE.test(t))
      continue;
    if (seen.has(t))
      continue;
    seen.add(t);
    sentences.push(t);
    if (sentences.length >= N * 3)
      break;
  }
  if (sentences.length >= N * 3)
    break;
}

// 均匀抽样
const step = Math.max(1, Math.floor(sentences.length / N));
const picked = sentences.filter((_, i) => i % step === 0).slice(0, N);

const SYS = `你是核验工程师。判断一句话能否转化为"可被操作系统原语检查"的断言。
可用原语：文件存在/内容包含/目录计数/文件大小、端口监听、进程存活、git 状态、HTTP 状态码、时间、算式。
只输出 JSON：{"measurable": true/false, "assertions": [{"prim": "原语名", "target": "对象"}], "why": "一句话原因"}
若这句话是主观评价且无任何可测代理，measurable=false 且 assertions 为空。
不要解释，不要多余文字。`;

async function convert(sentence) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: sentence }],
      temperature: 0,
      max_tokens: 200,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  const txt = String(j?.choices?.[0]?.message?.content || '');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m)
    return { measurable: false, assertions: [], why: '解析失败' };
  try {
    const o = JSON.parse(m[0]);
    return { measurable: Boolean(o.measurable) && Array.isArray(o.assertions) && o.assertions.length > 0, assertions: o.assertions || [], why: String(o.why || '').slice(0, 60) };
  }
  catch {
    return { measurable: false, assertions: [], why: 'JSON 解析失败' };
  }
}

const results = [];
for (const s of picked) {
  const r = await convert(s);
  results.push({ sentence: s, ...r });
}

const ok = results.filter((r) => r.measurable);
const rate = picked.length ? (ok.length / picked.length * 100).toFixed(1) : '0';
const prims = {};
for (const r of ok)
  for (const a of r.assertions)
    prims[a.prim] = (prims[a.prim] || 0) + 1;

console.log(`抽样 ${picked.length} 句\n`);
for (const r of results)
  console.log(`${r.measurable ? '✅' : '⚠️ '} ${r.sentence.slice(0, 46)}  ${r.measurable ? '→ ' + r.assertions.map((a) => `${a.prim}(${String(a.target).slice(0, 24)})`).join(', ') : '（' + r.why + '）'}`);
console.log(`\n可转化 ${ok.length}/${picked.length}（${rate}%）`);
console.log('原语分布：' + Object.entries(prims).map(([k, v]) => `${k}×${v}`).join('  '));

const md = [
  `# 可核验性转化可行性（抽样 ${picked.length} 句）`,
  '',
  `**可转化 ${ok.length}/${picked.length}（${rate}%）**`,
  '',
  '| 句子 | 能否转化 | 转化结果 / 原因 |',
  '|---|---|---|',
  ...results.map((r) => `| ${r.sentence.replace(/\|/g, '\\|').slice(0, 40)} | ${r.measurable ? '✅' : '⚠️'} | ${r.measurable ? r.assertions.map((a) => `${a.prim}(${String(a.target).slice(0, 20)})`).join('<br>') : r.why} |`),
  '',
  '原语分布：' + Object.entries(prims).map(([k, v]) => `${k}×${v}`).join('，'),
];
fs.writeFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/eval/verifiability.md', md.join('\n'));
console.log('\n已写入 eval/verifiability.md');
