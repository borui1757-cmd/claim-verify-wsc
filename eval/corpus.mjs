// corpus.mjs —— 真实语料评测：从会话原始记录里抽 assistant 正文，按句跑抽取+核验。
//
// 重要方法论警告（别拿它当真值）：
//   历史文本是**当时**说的，用**现在**的系统状态去核验，对路径/端口/时间/计数是无效的
//   （文件可能已删、服务可能已停、日期已变）。所以这里只统计**覆盖率**与**候选清单**，
//   真值要靠人标（或靠同一轮里的工具结果）。金集（eval/gold.mjs）才有真值。
//
// 用法：node eval/corpus.mjs [样本数]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { extractClaims, verifyClaims } from '../lib/index.js';

const TARGET = Number(process.argv[2] || 300);
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function readSession(file) {
  const buf = fs.readFileSync(file);
  const starts = [];
  let i = buf.indexOf(MAGIC);
  while (i !== -1) { starts.push(i); i = buf.indexOf(MAGIC, i + 4); }
  const out = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try { out.push(zlib.zstdDecompressSync(buf.subarray(starts[k], end))); }
    catch { /* 尾帧截断 */ }
  }
  return Buffer.concat(out).toString('utf8');
}

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.jsonl.zstd')) acc.push(p);
  }
  return acc;
}

// 1) 收集 assistant 正文
const files = walk(path.join(os.homedir(), '.dsh', 'sessions'));
const msgs = [];
for (const f of files) {
  let raw;
  try { raw = readSession(f); }
  catch { continue; }
  const sid = path.basename(path.dirname(f));
  for (const line of raw.split('\n')) {
    if (!line.includes('"assistant/message"')) continue;
    let o;
    try { o = JSON.parse(line); }
    catch { continue; }
    if (o.type !== 'assistant/message') continue;
    const content = o?.data?.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content.filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text).join('\n').trim();
    if (text.length < 40) continue;
    msgs.push({ sid, time: o.time, text });
  }
}
console.log(`会话文件 ${files.length} 个，含正文的 assistant 消息 ${msgs.length} 条`);

// 2) 稳定抽样：按正文哈希取前 N 条。
//    不能用等距抽样——每加一条新会话，全部下标都会平移，前后两轮根本不是同一批样本，
//    指标就没法比较了（2026-11-05 实测：三次跑出三批不同样本）。
function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}
const sample = msgs.map((m) => ({ ...m, h: hash(m.text) }))
  .sort((a, b) => a.h - b.h)
  .slice(0, TARGET);
console.log(`稳定抽样 ${sample.length} 条（按正文哈希排序，可复现）`);

// 3) 按句抽取 + 核验
const SENT = /[。！？!?；;\n]+/;
const rows = [];
const kindCount = {};
let withClaims = 0;
let totalClaims = 0;
let hardBad = 0;
for (const m of sample) {
  for (const s of m.text.split(SENT)) {
    const sentence = s.trim();
    if (sentence.length < 4) continue;
    const claims = extractClaims(sentence);
    if (!claims.length) continue;
    withClaims += 1;
    totalClaims += claims.length;
    for (const c of claims) kindCount[c.kind] = (kindCount[c.kind] || 0) + 1;
    const result = await verifyClaims(claims, m.sid, { portTimeoutMs: 120, moneyTolerance: 0.3 }, {});
    const hard = result.bad.filter((b) => !b.soft);
    hardBad += hard.length;
    rows.push({
      id: rows.length + 1,
      sid: m.sid,
      time: m.time,
      sentence,
      claims: claims.map((c) => ({ kind: c.kind, value: c.value, polarity: c.polarity, conf: c.confidence })),
      bad: hard.map((b) => ({ kind: b.claim.kind, claim: b.claim.value, expect: b.expect })),
      label: '',
    });
  }
}

fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), 'corpus.jsonl'),
  rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

const sentences = rows.length;
console.log(`含可核验断言的句子 ${withClaims} 句，断言 ${totalClaims} 条`);
console.log('按类别:', JSON.stringify(kindCount));
console.log(`硬报（会被追加说明）${hardBad} 条 —— 待人工确认真假`);
console.log(`已写入 eval/corpus.jsonl（${rows.length} 行）；把每行 label 填 true/false 后跑 eval/score.mjs`);
