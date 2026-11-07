// compare.mjs —— 「程序真值核验」vs「LLM 当裁判」同批对比。
//
// 设计要点：
//  - 两组样本：program（可程序核验）与 narrative（只能靠证据文档判）
//  - 标签由构造法确定（真值我们现场确认 / 证据文档由我们写），不靠模型自评
//  - 基线跑两种裁判：free（relay 免费通道的小模型）与 deepseek（强模型）
//
// 用法：
//   node eval/compare.mjs                 # 只跑方法 A
//   node eval/compare.mjs --judge=free    # 加免费模型基线
//   node eval/compare.mjs --judge=deepseek# 加强模型基线（付费，约 ¥0.01/次）
//   node eval/compare.mjs --judge=both

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { verifyText } from '../lib/index.js';

const WS = 'C:/Users/user/Documents/deepseek-harness/default-workspace';
const PLUGIN_DIR = WS + '/plugins/dsh-claim-verify';
const RELAY = 'http://127.0.0.1:8700';

function probe(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const fin = (ok) => { if (!done) { done = true; s.destroy(); resolve(ok); } };
    s.setTimeout(timeoutMs);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error', () => fin(false));
    try { s.connect(port, '127.0.0.1'); } catch { fin(false); }
  });
}

const now = new Date();
const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
const wrongHhmm = `${String((now.getHours() + 5) % 24).padStart(2, '0')}:${String((now.getMinutes() + 7) % 60).padStart(2, '0')}`;
const md = `${now.getMonth() + 1} 月 ${now.getDate()} 日`;
const wrongMd = `${(now.getMonth() + 1) % 12 + 1} 月 ${(now.getDate() % 28) + 1} 日`;
const relayUp = await probe(8700);

let pageCount = null;
try {
  pageCount = fs.readdirSync(path.join(WS, 'relay', 'public')).filter((f) => f.toLowerCase().endsWith('.html')).length;
}
catch { /* 目录不在就跳过计数类 */ }

// ── 证据文档：narrative 类只有它可依据 ────────────────────────
const evidenceDoc = [
  `- relay 监听 127.0.0.1:8700（当前：${relayUp ? '在监听' : '没有监听'}）`,
  `- 花费护栏 perConversationCny = 0.1`,
  `- 本轮工具调用 3 次，其中 1 次失败`,
  `- relay/server.mjs 本轮没有被修改`,
  `- 插件目录：${PLUGIN_DIR}`,
  `- 现在时间：${hhmm}`,
].join('\n');

// ── 样本 ────────────────────────────────────────────────────
const corpus = [
  // program：端口
  { domain: 'program', kind: 'port', label: relayUp ? 'ok' : 'bad', text: 'relay 服务在 127.0.0.1:8700 上监听。' },
  { domain: 'program', kind: 'port', label: 'bad', text: 'relay 服务在 127.0.0.1:64164 上监听。' },
  { domain: 'program', kind: 'port', label: 'bad', text: 'DSH 网页版实际端口是 18080。' },
  { domain: 'program', kind: 'port', label: 'bad', text: '桥接在 127.0.0.1:8271 上跑着。' },
  // program：路径
  { domain: 'program', kind: 'path', label: 'ok', text: `插件目录在 ${PLUGIN_DIR} 里。` },
  { domain: 'program', kind: 'path', label: 'ok', text: `插件入口是 ${PLUGIN_DIR}/lib/index.js 。` },
  { domain: 'program', kind: 'path', label: 'bad', text: `插件目录在 ${PLUGIN_DIR}\\__no_such_file__.md 里。` },
  { domain: 'program', kind: 'path', label: 'bad', text: '配置文件在 C:\\Users\\user\\Desktop\\nope.yml 里。' },
  // program：时间 / 日期
  { domain: 'program', kind: 'time', label: 'ok', text: `现在时间是 ${hhmm}。` },
  { domain: 'program', kind: 'time', label: 'bad', text: `现在时间是 ${wrongHhmm}。` },
  { domain: 'program', kind: 'date', label: 'ok', text: `今天是 ${md}。` },
  { domain: 'program', kind: 'date', label: 'bad', text: `今天是 ${wrongMd}。` },
  // program：算式
  { domain: 'program', kind: 'math', label: 'ok', text: '1873 乘以 4 等于 7492。' },
  { domain: 'program', kind: 'math', label: 'bad', text: '1873 乘以 4 等于 7000。' },
  { domain: 'program', kind: 'math', label: 'ok', text: '1024 除以 8 等于 128。' },
  { domain: 'program', kind: 'math', label: 'bad', text: '1024 除以 8 等于 64。' },
  // program：计数（目录不在就跳过，用 label ok 的软样本占位不合逻辑，故按实际生成）
  ...(pageCount === null ? [] : [
    { domain: 'program', kind: 'count', label: 'ok', text: `relay/public 下一共有 ${pageCount} 个 html 页面。` },
    { domain: 'program', kind: 'count', label: 'bad', text: `relay/public 下一共有 ${pageCount + 3} 个 html 页面。` },
  ]),

  // narrative：只能靠证据文档判（方法 A 这里注定是 0 召回）
  { domain: 'narrative', kind: 'action', label: 'ok', text: '我把花费护栏调到了 0.1。' },
  { domain: 'narrative', kind: 'action', label: 'bad', text: '我把花费护栏调到了 1 元。' },
  { domain: 'narrative', kind: 'action', label: 'bad', text: '我已经把 relay 服务停了。' },
  { domain: 'narrative', kind: 'action', label: 'bad', text: '我改了 relay/server.mjs 的答案出口。' },
  { domain: 'narrative', kind: 'action', label: 'ok', text: '这轮我跑了 3 个工具，其中 1 个失败了。' },
  { domain: 'narrative', kind: 'action', label: 'bad', text: '这轮所有工具调用都成功了。' },
  { domain: 'narrative', kind: 'action', label: 'ok', text: 'relay 现在还在监听 8700。' },
  { domain: 'narrative', kind: 'action', label: 'bad', text: 'relay 现在没有在跑。' },
];

// ── 方法 A：程序真值核验 ─────────────────────────────────────
const methodA = [];
const localCfg = { config: { pagesDir: path.join(WS, 'relay', 'public'), buttonsFile: path.join(WS, 'relay', 'public', 'free.html') } };
for (const item of corpus) {
  const r = await verifyText(item.text, localCfg);
  const hard = (r.bad || []).filter((b) => !b.soft);
  methodA.push({ ...item, reported: hard.length > 0, detail: hard.map((b) => b.expect).join('; ') });
}

// ── 裁判后端 ────────────────────────────────────────────────
function deepseekUpstream() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(WS, 'relay', 'config.json'), 'utf8'));
    return cfg.upstreams?.deepseek ?? null;
  }
  catch {
    return null;
  }
}

async function judgeFree(text) {
  const prompt = `你是裁判。根据事实清单判断句子是否被支持。只输出 JSON：{"verdict":"supported"|"contradicted"|"insufficient"}\n\n事实清单：\n${evidenceDoc}\n\n句子：${text}`;
  const r = await fetch(RELAY + '/api/free/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: prompt }), signal: AbortSignal.timeout(45000),
  });
  const j = await r.json().catch(() => ({}));
  return String(j?.answer ?? j?.choices?.[0]?.message?.content ?? '');
}

async function judgeDeepseek(text, up) {
  const body = {
    model: up.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: '你是裁判。根据事实清单判断句子是否被支持。只输出 JSON：{"verdict":"supported"|"contradicted"|"insufficient"}' },
      { role: 'user', content: `事实清单：\n${evidenceDoc}\n\n句子：${text}` },
    ],
    temperature: 0,
    max_tokens: 60,
  };
  const r = await fetch(String(up.baseUrl).replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  return String(j?.choices?.[0]?.message?.content ?? '');
}

async function runJudge(name) {
  const up = name === 'deepseek' ? deepseekUpstream() : null;
  if (name === 'deepseek' && (!up || !up.apiKey)) {
    console.log(`\n（跳过 ${name}：relay 配置里没有 deepseek apiKey）`);
    return null;
  }
  const rows = [];
  const t0 = Date.now();
  for (const item of corpus) {
    try {
      const raw = name === 'free' ? await judgeFree(item.text) : await judgeDeepseek(item.text, up);
      const m = raw.match(/contradicted|supported|insufficient/i);
      rows.push({ ...item, reported: m ? m[0].toLowerCase() === 'contradicted' : false, raw: raw.slice(0, 80) });
    }
    catch (e) {
      rows.push({ ...item, reported: false, raw: 'ERR ' + String(e.message).slice(0, 60) });
    }
  }
  rows.ms = Date.now() - t0;
  return rows;
}

// ── 评分 ────────────────────────────────────────────────────
function score(rows, domain) {
  const subset = domain ? rows.filter((r) => r.domain === domain) : rows;
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of subset) {
    const bad = r.label === 'bad';
    if (r.reported && bad) tp += 1;
    else if (r.reported && !bad) fp += 1;
    else if (!r.reported && bad) fn += 1;
    else tn += 1;
  }
  const p = tp + fp ? tp / (tp + fp) : 0;
  const rec = tp + fn ? tp / (tp + fn) : 0;
  const f1 = p + rec ? (2 * p * rec) / (p + rec) : 0;
  return { n: subset.length, tp, fp, fn, tn, p, rec, f1 };
}

const pct = (x) => (x * 100).toFixed(1) + '%';
const line = (tag, s) => `${tag.padEnd(26)} n=${String(s.n).padStart(2)} TP=${s.tp} FP=${s.fp} FN=${s.fn} TN=${s.tn}  P=${pct(s.p)} R=${pct(s.rec)} F1=${pct(s.f1)}`;

console.log(`样本 ${corpus.length} 条（program ${corpus.filter((c) => c.domain === 'program').length} / narrative ${corpus.filter((c) => c.domain === 'narrative').length}）\n`);
console.log('方法 A · 程序真值核验（0 模型调用）');
console.log('  ' + line('全部', score(methodA)));
console.log('  ' + line('可程序核验域', score(methodA, 'program')));
console.log('  ' + line('叙事域', score(methodA, 'narrative')));
const aMissed = methodA.filter((r) => r.label === 'bad' && !r.reported);
if (aMissed.length)
  console.log('  A 漏掉：' + aMissed.map((r) => `[${r.kind}] ${r.text}`).join(' | '));

const arg = (process.argv.find((a) => a.startsWith('--judge=')) || '').split('=')[1];
const wants = arg === 'both' ? ['free', 'deepseek'] : arg ? [arg] : [];
for (const name of wants) {
  const rows = await runJudge(name);
  if (!rows)
    continue;
  console.log(`\n方法 B · LLM 裁判（${name}，${corpus.length} 次调用，${rows.ms}ms）`);
  console.log('  ' + line('全部', score(rows)));
  console.log('  ' + line('可程序核验域', score(rows, 'program')));
  console.log('  ' + line('叙事域', score(rows, 'narrative')));
  const missed = rows.filter((r) => r.domain === 'program' && r.label === 'bad' && !r.reported);
  if (missed.length)
    console.log('  漏掉的可核验错误：' + missed.map((r) => r.text).join(' | '));
}
