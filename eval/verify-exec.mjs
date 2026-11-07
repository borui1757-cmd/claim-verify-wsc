#!/usr/bin/env node
// 转化后能否真的执行：从"模型说可转化"到"脚本能编译并跑起来"。
//
// 两级：
//   L1 可编译：原语存在 + 参数合法（我们的 PRIMS 校验）
//   L2 可执行：runPlan 不抛错并返回布尔
//
// 用法：node eval/verify-exec.mjs [--n 20]

import fs from 'node:fs';
import { PRIMS, runPlan } from '../lib/dsl.js';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const N = Math.max(5, argOf('n') || 20);

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams?.deepseek;
const BASE = String(up.baseUrl).replace(/\/$/, '');
const KEY = up.apiKey;
const MODEL = up.model || 'deepseek-chat';

const CASES = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/data/harvested-cases.jsonl';
const cases = fs.readFileSync(CASES, 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const CLAIM_RE = /(已完成|已实现|已修复|已优化|完成|成功|提升|改善|稳定|健壮|更快|更好|没问题|正常)/;
const sentences = [];
const seen = new Set();
for (const c of cases) {
  for (const s of String(c.report || '').split(/[。！？\n]+/)) {
    const t = s.trim();
    if (t.length < 8 || t.length > 120 || !CLAIM_RE.test(t) || seen.has(t))
      continue;
    seen.add(t);
    sentences.push(t);
    if (sentences.length >= N * 3)
      break;
  }
  if (sentences.length >= N * 3)
    break;
}
const step = Math.max(1, Math.floor(sentences.length / N));
const picked = sentences.filter((_, i) => i % step === 0).slice(0, N);

const SYS = `把这句话转成"可被下列原语检查"的断言。原语与参数严格如下：
port{port}, exists{path}, file_contains{path,text}, proc_alive{pid}, math_eq{expr,value},
reachable{host,port}, git_head{dir,sha}, git_clean{dir}, http_status{url,status},
dir_count{dir,ext,count}, time_near{hhmm,toleranceMin}
只输出 JSON：{"assertions":[{"prim":"原语名","args":{...}}]}
若无法转成上述任何一种，输出 {"assertions":[]}。
args 的值必须具体（真实路径/端口/URL/pid）。不要省略参数，不要编造对象名。`;

async function convert(sentence) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: sentence }],
      temperature: 0, max_tokens: 260,
    }),
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
  if (!p || !a.args)
    return '未知原语或缺 args';
  for (const [k, fn] of Object.entries(p.params || {})) {
    if (!(k in a.args))
      return `缺参数 ${k}`;
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
const compiled = rows.reduce((a, r) => a + r.detail.filter((d) => d.why !== '未知原语或缺 args' && !/缺参数|非法/.test(d.why)).length, 0);
const executed = rows.reduce((a, r) => a + r.detail.filter((d) => d.ok).length, 0);
const sentencesWithExec = rows.filter((r) => r.detail.some((d) => d.ok)).length;

console.log(`抽样 ${total} 句\n`);
for (const r of rows) {
  const good = r.detail.filter((d) => d.ok).length;
  console.log(`${good > 0 ? '✅' : '⚠️ '} ${r.sentence.slice(0, 40)}`);
  for (const d of r.detail)
    console.log(`      ${d.ok ? '执行成功' : '失败'} ${d.prim} ${d.why}`);
}
console.log(`\n提出断言 ${proposed} 条；可编译 ${compiled}；可执行 ${executed}`);
console.log(`有至少一条可执行断言的句子：${sentencesWithExec}/${total}（${(sentencesWithExec / total * 100).toFixed(1)}%）`);

const md = [
  `# 转化后执行率（抽样 ${total} 句）`,
  '',
  `| 指标 | 数值 |`,
  `|---|---|`,
  `| 提出断言 | ${proposed} 条 |`,
  `| 可编译（原语与参数合法） | ${compiled} |`,
  `| 可执行（runPlan 返回判定） | ${executed} |`,
  `| 有至少一条可执行断言的句子 | ${sentencesWithExec}/${total}（${(sentencesWithExec / total * 100).toFixed(1)}%） |`,
  '',
  '## 逐句',
  ...rows.map((r) => `\n**${r.sentence.slice(0, 50)}**\n${r.detail.map((d) => `- ${d.ok ? '✅' : '❌'} ${d.prim} ${d.why}`).join('\n') || '- （模型未给出断言）'}`),
];
fs.writeFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/eval/verify-exec.md', md.join('\n'));
console.log('\n已写入 eval/verify-exec.md');
