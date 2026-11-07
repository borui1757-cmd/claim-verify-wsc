// claim-reader-llm.mjs —— 用本机 /v1 端点的模型当 ClaimReader，对比正则的抽取覆盖率。
//
// 为什么只把模型放在这一环：实测正则抽"写入 `路径`"只覆盖 1.6%，这是瓶颈；
// 而判定层必须保持确定性（真值可算，不需要模型判）。
//
// 用法：node eval/claim-reader-llm.mjs [轮次数]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const BASE = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080';
const MODEL = process.env.CLAIM_READER_MODEL || 'free-first';
const N = Number(process.argv[2] || 3);

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
function readSession(file) {
  const buf = fs.readFileSync(file);
  const starts = [];
  let i = buf.indexOf(MAGIC);
  while (i !== -1) { starts.push(i); i = buf.indexOf(MAGIC, i + 4); }
  const out = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try { out.push(zlib.zstdDecompressSync(buf.subarray(starts[k], end))); } catch { /* skip */ }
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

const REGEX_CLAIMS = /(?:已|已经)?(?:写入|创建|新建|保存|修改|更新|删除|启动|重启|完成)(?:了)?/g;

const PROMPT = `你是断言抽取器。给你一段 AI 助手的最终报告，请只抽出「它声称已经执行了某个动作」的断言。

严格只输出 JSON，不要解释，不要 markdown 代码块。格式：
[{"verb":"write|modify|delete|start|restart|run|test","target":"对象（文件路径/服务名/命令），没有就写 null","quote":"报告里的原句片段（<= 30 字）"}]

规则：
1. 只抽「已执行」类（已完成、已写入、已启动、测试通过、已修改 N 处）
2. 计划、建议、疑问、假设一律不要
3. 没有对象的断言 target 写 null，不要瞎猜
4. 抽不到就输出 []

报告如下：
---
`;

async function askModel(report) {
  const r = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: PROMPT + report.slice(0, 6000) + '\n---' }],
      max_tokens: 800,
      temperature: 0,
      stream: false,
    }),
  });
  if (!r.ok)
    throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content ?? '';
  const m = text.match(/\[[\s\S]*\]/);
  if (!m)
    return { claims: [], raw: text.slice(0, 200) };
  try {
    const arr = JSON.parse(m[0]);
    return { claims: Array.isArray(arr) ? arr : [], raw: null };
  }
  catch {
    return { claims: [], raw: text.slice(0, 200), parseError: true };
  }
}

// ── 收集带报告的轮次 ──────────────────────────────────────────────
const files = walk(path.join(os.homedir(), '.dsh', 'sessions')).slice(0, 12);
const samples = [];
for (const f of files) {
  let raw;
  try { raw = readSession(f); } catch { continue; }
  const sid = path.basename(path.dirname(f));
  for (const line of raw.split('\n')) {
    if (!line.includes('"assistant/message"') || samples.length >= N)
      continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const content = o.data?.message?.content;
    if (!Array.isArray(content))
      continue;
    const text = content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n').trim();
    if (text.length < 200)
      continue;
    samples.push({ sid, turn: o.data?.turn, text });
  }
  if (samples.length >= N)
    break;
}

console.log(`模型：${MODEL}   端点：${BASE}/v1   样本：${samples.length} 轮\n`);

let totalRegex = 0;
let totalLlm = 0;
let totalLlmWithTarget = 0;
for (const s of samples) {
  const regexCount = (s.text.match(REGEX_CLAIMS) || []).length;
  const t0 = Date.now();
  let out;
  try { out = await askModel(s.text); }
  catch (e) { console.log(`[${s.sid.slice(-8)} turn ${s.turn}] 调用失败：${e.message}`); continue; }
  const ms = Date.now() - t0;
  const withTarget = out.claims.filter((c) => c && c.target).length;
  totalRegex += regexCount;
  totalLlm += out.claims.length;
  totalLlmWithTarget += withTarget;

  console.log(`[${s.sid.slice(-8)} turn ${s.turn}] 报告 ${s.text.length} 字   用时 ${ms}ms`);
  console.log(`   正则命中 ${regexCount} 处 | 模型抽出 ${out.claims.length} 条，其中带对象 ${withTarget} 条`);
  for (const c of out.claims.slice(0, 4))
    console.log(`     - ${c.verb}(${c.target ?? 'null'})  「${(c.quote || '').slice(0, 30)}」`);
  if (out.raw)
    console.log(`     ! 解析失败，原始输出：${out.raw}`);
}

console.log(`\n合计：正则 ${totalRegex} 处 vs 模型 ${totalLlm} 条（带对象 ${totalLlmWithTarget} 条）`);
