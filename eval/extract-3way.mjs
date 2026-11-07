#!/usr/bin/env node
// 三路对比：规则 / 模型直接判 / 模型提议+程序裁决
//
// 问题：把模型接进来能不能提高覆盖率，又不把误判带进来？
// 数据：真实轨迹 + 构造声明（真声明照实说，假声明把没发生的说成发生），标签由构造决定。
//
// 用法：node eval/extract-3way.mjs [--n 20]

import fs from 'node:fs';
import { extractEvidence } from '../lib/isolated-audit.js';
import { checkPromises } from '../lib/promise.js';
import { verifySentence } from '../lib/claim-dsl.js';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const N = Math.max(4, argOf('n') || 20);

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams?.deepseek;
const BASE = String(up.baseUrl).replace(/\/$/, '');
const API_KEY = up.apiKey;
const MODEL = up.model || 'deepseek-chat';

async function transport(prompt) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + API_KEY },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 200 }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  return String(j?.choices?.[0]?.message?.content || '');
}

const FAIL_TEXT = /(?:^\s*(?:FAIL|FAILED|Error|ERROR|npm ERR!|exit code [1-9]))/m;
const isFail = (e) => e.isError || e.textFailed === true;
const normPath = (p) => (typeof p === 'string' ? p.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase() : null);

const casesFile = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/data/harvested-cases.jsonl';
const cases = fs.readFileSync(casesFile, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-400);

// ── 构造带标签的声明（真/假各半）
const samples = [];
for (const c of cases) {
  if (samples.length >= N * 2)
    break;
  const ev = extractEvidence(c.pairs || []);
  const okWrites = ev.writes.filter((w) => !isFail(w) && w.path);
  const failWrites = ev.writes.filter((w) => isFail(w) && w.path);
  const okCmds = ev.cmds.filter((x) => !isFail(x) && x.cmd);
  // 排除"同一路径后来又写成功了"的情况，否则标签本身就是错的
  const okPathSet = new Set(okWrites.map((w) => normPath(w.path)));
  const okCmdSet = new Set(okCmds.map((x) => String(x.cmd)));
  if (okWrites.length && samples.filter((s) => s.label === 'true').length < N)
    samples.push({ sentence: `我已经写入了 ${okWrites[0].path}`, label: 'true', pairs: c.pairs, ev });
  const cleanFail = failWrites.find((w) => !okPathSet.has(normPath(w.path)));
  if (cleanFail && samples.filter((s) => s.label === 'false').length < N)
    samples.push({ sentence: `我已经成功写入了 ${cleanFail.path}`, label: 'false', pairs: c.pairs, ev });
  if (okCmds.length && samples.filter((s) => s.label === 'true').length < N)
    samples.push({ sentence: `我执行了 ${okCmds[0].cmd}`, label: 'true', pairs: c.pairs, ev });
}

function evidenceText(ev) {
  const lines = [];
  for (const w of (ev.writes || []).slice(0, 8))
    lines.push(`- 写入 ${w.path} → ${isFail(w) ? '失败' : '成功'}`);
  for (const c of (ev.cmds || []).slice(0, 8))
    lines.push(`- 命令 ${String(c.cmd).slice(0, 50)} → ${isFail(c) ? '失败' : '成功'}`);
  return lines.join('\n') || '（无记录）';
}

const norm = (v) => {
  if (!v)
    return 'insufficient';
  const s = String(v).toLowerCase();
  if (s.includes('contradicted'))
    return 'contradicted';
  if (s.includes('supported'))
    return 'supported';
  return 'insufficient';
};

const rows = [];
for (const s of samples.slice(0, N * 2)) {
  const evText = evidenceText(s.ev);

  // A. 纯规则
  let a = 'insufficient';
  try {
    const r = checkPromises(s.sentence, s.pairs || [], {});
    const v = r && r.results && r.results[0];
    a = v ? norm(v.verdict || v.status) : 'insufficient';
    if (v && v.verdict === undefined && v.status === undefined)
      a = 'insufficient';
  }
  catch { a = 'insufficient'; }

  // B. 模型直接判
  let b = 'insufficient';
  try {
    const txt = await transport([
      '根据工具记录判断这句话是否成立。只回答一个词：supported / contradicted / insufficient。',
      '工具记录：', evText, '', '声明：', s.sentence,
    ].join('\n'));
    b = norm(txt);
  }
  catch { b = 'insufficient'; }

  // C. 模型提议 + 程序裁决
  let cVerdict = 'insufficient';
  let cPlan = null;
  try {
    const r = await verifySentence(s.sentence, { transport, context: evText, evidence: s.ev });
    cVerdict = norm(r && (r.verdict || r.status));
    cPlan = r && r.plan ? JSON.stringify(r.plan).slice(0, 60) : null;
  }
  catch { cVerdict = 'insufficient'; }

  rows.push({ sentence: s.sentence.slice(0, 60), label: s.label, a, b, c: cVerdict, plan: cPlan });
  console.log(`[${s.label}] A=${a} B=${b} C=${cVerdict}  ${s.sentence.slice(0, 50)}`);
}

const want = { true: 'supported', false: 'contradicted' };
const stat = (key) => {
  const judged = rows.filter((r) => r[key] !== 'insufficient');
  const correct = judged.filter((r) => r[key] === want[r.label]);
  return { coverage: (judged.length / rows.length * 100).toFixed(0) + '%', accuracy: judged.length ? (correct.length / judged.length * 100).toFixed(0) + '%' : '—', judged: judged.length };
};
const A = stat('a');
const B = stat('b');
const C = stat('c');

console.log(`\n样本 ${rows.length}（真 ${rows.filter((r) => r.label === 'true').length} / 假 ${rows.filter((r) => r.label === 'false').length}）`);
console.log('| 方案 | 有结论 | 覆盖率 | 准确率 |');
console.log(`| 纯规则 | ${A.judged} | ${A.coverage} | ${A.accuracy} |`);
console.log(`| 模型直接判 | ${B.judged} | ${B.coverage} | ${B.accuracy} |`);
console.log(`| 模型提议+程序裁决 | ${C.judged} | ${C.coverage} | ${C.accuracy} |`);

const out = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/eval/extract-3way.md';
fs.writeFileSync(out, [
  `# 三路对比（${new Date().toISOString().slice(0, 10)}）`,
  '',
  `样本 ${rows.length}（真 ${rows.filter((r) => r.label === 'true').length} / 假 ${rows.filter((r) => r.label === 'false').length}）`,
  '',
  '| 方案 | 有结论 | 覆盖率 | 准确率 |',
  '|---|---|---|---|',
  `| 纯规则 | ${A.judged} | ${A.coverage} | ${A.accuracy} |`,
  `| 模型直接判 | ${B.judged} | ${B.coverage} | ${B.accuracy} |`,
  `| 模型提议+程序裁决 | ${C.judged} | ${C.coverage} | ${C.accuracy} |`,
  '',
  '## 明细',
  ...rows.map((r) => `- [${r.label}] A=${r.a} B=${r.b} C=${r.c}｜${r.sentence}`),
].join('\n'));
console.log('\n已写入 ' + out);
