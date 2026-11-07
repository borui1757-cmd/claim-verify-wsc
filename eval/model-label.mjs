#!/usr/bin/env node
// 模型金标（盲标）：两个模型独立标注同一批声明，算一致性与分歧。
//
// 协议要点（避免自证）：
//   ① 只给模型「声明 + 证据摘要」，**不给**它的构造标签、也**不给**我们的判定
//   ② 两个标注者：付费通道（deepseek-chat）+ 免费通道（relay /api/free/chat）
//   ③ 输出：模型间 κ、各模型与构造标签一致率、与我们的判定的分歧清单
//
// 用法：node eval/model-label.mjs --n 10 [--no-free]

import fs from 'node:fs';
import { extractEvidence, decideClaims } from '../lib/isolated-audit.js';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const N = Math.max(2, argOf('n') || 10);
const USE_FREE = !args.includes('--no-free');

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams?.deepseek;
const BASE = String(up.baseUrl).replace(/\/$/, '');
const API_KEY = up.apiKey;
const MODEL = up.model || 'deepseek-chat';
const FREE = 'http://127.0.0.1:8700/api/free/chat';

const FAIL_TEXT = /(?:^\s*(?:FAIL|FAILED|Error|ERROR|npm ERR!|exit code [1-9])|(?:^|\n)\s*(?:Traceback|panic:))/m;
const isFail = (e) => e.isError || e.textFailed === true;
const normPath = (p) => (typeof p === 'string' ? p.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase() : null);

const casesFile = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/data/harvested-cases.jsonl';
const cases = fs.readFileSync(casesFile, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-300);

// ── 构造样本（同样例：真/假声明）
const samples = [];
for (const c of cases) {
  const ev = extractEvidence(c.pairs || []);
  const okWrites = ev.writes.filter((w) => !isFail(w) && w.path);
  const okCmds = ev.cmds.filter((x) => !isFail(x) && x.cmd);
  const okPaths = new Set(okWrites.map((w) => normPath(w.path)));
  const okCmdSet = new Set(okCmds.map((x) => String(x.cmd)));
  const ambiguous = (t) => [...okCmdSet].some((s) => s.includes(t) || t.includes(s));

  for (const w of okWrites.slice(0, 1))
    samples.push({ claim: `我已经写入了 ${w.path}`, kind: 'write', target: w.path, truth: 'supported', ev });
  for (const x of okCmds.slice(0, 1))
    samples.push({ claim: `我执行了 ${x.cmd}`, kind: 'cmd', target: x.cmd, truth: 'supported', ev });
  for (const w of ev.writes.filter((x) => isFail(x) && x.path && !okPaths.has(normPath(x.path))))
    samples.push({ claim: `我已经成功写入了 ${w.path}`, kind: 'write', target: w.path, truth: 'contradicted', ev });
  for (const x of ev.cmds.filter((y) => isFail(y) && y.cmd && !okCmdSet.has(String(y.cmd)) && !ambiguous(String(y.cmd))))
    samples.push({ claim: `我成功执行了 ${x.cmd}`, kind: 'cmd', target: x.cmd, truth: 'contradicted', ev });
}

// 打散后取 N 条（真假各半更好，这里简单等距取样）
const picked = [];
for (let i = 0; i < N && i < samples.length; i += 1)
  picked.push(samples[Math.floor((i * samples.length) / Math.min(N, samples.length))]);

function evidenceText(ev, target) {
  const t = String(target || '').toLowerCase();
  const wl = (ev.writes || []).map((w) => `- 写入 ${w.path} → ${isFail(w) ? '失败' : '成功'}${w.text ? `（${String(w.text).slice(0, 60)}）` : ''}`);
  const cl = (ev.cmds || []).map((c) => `- 命令 ${String(c.cmd).slice(0, 60)} → ${isFail(c) ? '失败' : '成功'}${c.text ? `（${String(c.text).slice(0, 60)}）` : ''}`);
  // 与声明目标相关的条目置顶，避免被截断丢掉（第一版就是因为这个把关键行切掉了）
  const relevantW = (ev.writes || []).filter((w) => t && String(w.path || '').toLowerCase().includes(t.slice(0, 24)))
    .map((w) => `- 写入 ${w.path} → ${isFail(w) ? '失败' : '成功'}${w.text ? `（${String(w.text).slice(0, 60)}）` : ''}`);
  const relevantC = (ev.cmds || []).filter((c) => t && String(c.cmd || '').toLowerCase().includes(t.slice(0, 24)))
    .map((c) => `- 命令 ${String(c.cmd).slice(0, 60)} → ${isFail(c) ? '失败' : '成功'}${c.text ? `（${String(c.text).slice(0, 60)}）` : ''}`);
  const head = [...new Set([...relevantW, ...relevantC])];
  const rest = [...wl, ...cl].filter((x) => !head.includes(x));
  const lines = [...head, ...rest].slice(0, 12);
  return lines.join('\n') || '（本轮没有写/命令记录）';
}

function promptOf(s) {
  return [
    '你是审计员。根据工具记录判断这句话是否被证据支持。',
    '只回答一个词：supported / contradicted / insufficient。',
    '',
    '工具记录：',
    evidenceText(s.ev, s.target),
    '',
    '待核验的声明：',
    s.claim,
  ].join('\n');
}

const parse = (t) => {
  const m = String(t || '').toLowerCase().match(/contradicted|supported|insufficient/);
  return m ? m[0] : null;
};

async function askPaid(prompt) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + API_KEY },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 20 }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  return { text: String(j?.choices?.[0]?.message?.content || ''), tokens: (j?.usage?.prompt_tokens || 0) + (j?.usage?.completion_tokens || 0) };
}

async function askFree(prompt) {
  const r = await fetch(FREE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: prompt }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  return { text: String(j?.answer || ''), tokens: 0 };
}

// Cohen's kappa
function kappa(pairs) {
  const rows = pairs.filter((p) => p.a && p.b);
  const n = rows.length;
  if (!n)
    return { n: 0, agreement: null, kappa: null };
  const labels = new Set([...rows.map((r) => r.a), ...rows.map((r) => r.b)]);
  let agree = 0;
  const ca = {};
  const cb = {};
  for (const r of rows) {
    if (r.a === r.b)
      agree += 1;
    ca[r.a] = (ca[r.a] || 0) + 1;
    cb[r.b] = (cb[r.b] || 0) + 1;
  }
  const po = agree / n;
  let pe = 0;
  for (const l of labels)
    pe += ((ca[l] || 0) / n) * ((cb[l] || 0) / n);
  const k = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { n, agreement: Number(po.toFixed(3)), kappa: Number(k.toFixed(3)) };
}

const rows = [];
let paidTokens = 0;
for (const s of picked) {
  const prompt = promptOf(s);
  const paid = await askPaid(prompt);
  paidTokens += paid.tokens;
  const free = USE_FREE ? await askFree(prompt) : { text: '' };
  const ours = decideClaims([{ sentence: s.claim, kind: s.kind, target: s.target }], s.ev)[0]?.verdict || 'insufficient';
  rows.push({ ...s, A: parse(paid.text), B: parse(free.text), ours, paidRaw: paid.text.slice(0, 30), freeRaw: free.text.slice(0, 30) });
}

const ab = kappa(rows.map((r) => ({ a: r.A, b: r.B })));
const aTruth = kappa(rows.map((r) => ({ a: r.A, b: r.truth })));
const bTruth = kappa(rows.map((r) => ({ a: r.B, b: r.truth })));
const aOurs = kappa(rows.map((r) => ({ a: r.A, b: r.ours })));

console.log(`样本 ${rows.length}；付费 token ${paidTokens}\n`);
for (const r of rows)
  console.log(`  [${r.truth}] A=${r.A} B=${r.B} ours=${r.ours}  ${r.claim.slice(0, 46)}`);
console.log(`\n模型间：一致率 ${ab.agreement} κ=${ab.kappa} (n=${ab.n})`);
console.log(`A vs 构造标签：${aTruth.agreement} / κ=${aTruth.kappa}`);
console.log(`B vs 构造标签：${bTruth.agreement} / κ=${bTruth.kappa}`);
console.log(`A vs 我们的判定：${aOurs.agreement} / κ=${aOurs.kappa}`);

const disagreements = rows.filter((r) => r.A !== r.B);
console.log(`\n两模型分歧 ${disagreements.length} 条（这些才需要人工裁决）`);

const out = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/eval/model-label.md';
fs.writeFileSync(out, [
  `# 模型金标（盲标，${new Date().toISOString().slice(0, 10)}）`,
  '',
  `样本 ${rows.length}；付费 token ${paidTokens}`,
  '',
  '| 比较 | 一致率 | κ |',
  '|---|---|---|',
  `| 模型 A vs 模型 B | ${ab.agreement} | ${ab.kappa} |`,
  `| A vs 构造标签 | ${aTruth.agreement} | ${aTruth.kappa} |`,
  `| B vs 构造标签 | ${bTruth.agreement} | ${bTruth.kappa} |`,
  `| A vs 我们的判定 | ${aOurs.agreement} | ${aOurs.kappa} |`,
  '',
  '## 明细',
  ...rows.map((r) => `- [${r.truth}] A=${r.A} B=${r.B} ours=${r.ours}｜${r.claim.slice(0, 60)}`),
  '',
  '## 分歧（需人工裁决）',
  ...disagreements.map((r) => `- A=${r.A} B=${r.B}｜${r.claim.slice(0, 80)}`),
].join('\n'));
console.log('\n已写入 ' + out);
