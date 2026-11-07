#!/usr/bin/env node
// 对照：我们的确定性判定 vs "一次批量 LLM 评估"（dsh-completion-supervisor 的做法）
//
// 同一批案例：
//   我们  ：规则判定（零模型调用）
//   对方  ：把整条证据+声明丢给模型，一次批量判三分类
//
// 指标：与构造标签的一致率、模型调用次数、耗时。
//
// 用法：node eval/vs-llm-judge.mjs [--n 30]

import fs from 'node:fs';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const N = Math.max(10, argOf('n') || 30);

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams.deepseek;
const base = String(up.baseUrl).replace(/\/$/, '');

const CASES = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/data/harvested-cases.jsonl';
const cases = fs.readFileSync(CASES, 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// 构造带标签的样本：真声明（有成功写入）与假声明（只有失败写入）
const samples = [];
for (const c of cases) {
  if (samples.length >= N)
    break;
  const pairs = c.pairs || [];
  const okW = pairs.find((p) => /write/i.test(String(p.name || '')) && p.isError !== true && p.resultSeen === true);
  const badW = pairs.find((p) => /write/i.test(String(p.name || '')) && p.isError === true);
  if (okW && !badW && samples.length < N / 2) {
    const path = (okW.args && (okW.args.path || okW.args.file_path)) || 'C:\\x';
    samples.push({ sentence: `我已经写入了 ${path}`, label: 'supported', evidence: String(okW.text || '').slice(0, 800) });
  }
  else if (badW && !okW && samples.length < N) {
    const path = (badW.args && (badW.args.path || badW.args.file_path)) || 'C:\\x';
    samples.push({ sentence: `我已经写入了 ${path}`, label: 'contradicted', evidence: String(badW.text || '').slice(0, 800) });
  }
}

// 我们的判定（规则）：等价于"有失败标记 → contradicted，有成功证据 → supported"
const ourVerdict = (s) => {
  const ev = s.evidence || '';
  if (/(error|failed|no such file|ENOENT|失败|不存在|exit code: [1-9])/i.test(ev) && !/(ok|success|成功)/i.test(ev))
    return 'contradicted';
  if (/(ok|success|成功|written)/i.test(ev))
    return 'supported';
  return 'insufficient';
};

const SYS = `你是核验器。给定"证据"和一句"声明"，判三分类：
supported（证据支持）/ contradicted（证据反驳）/ insufficient（证据没提或无法判断）。
只输出 JSON：{"verdict":"supported|contradicted|insufficient"}`;

async function llmJudgeBatch(batch) {
  const lines = batch.map((s, i) => `#${i} 声明：${s.sentence}\n证据：${s.evidence}`).join('\n\n');
  const t0 = Date.now();
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
    body: JSON.stringify({
      model: up.model,
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: `请对以下 ${batch.length} 条逐一判定，输出 JSON 数组：[{"i":0,"verdict":"..."}]。\n\n${lines}` }],
      temperature: 0, max_tokens: 800,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const j = await r.json();
  const ms = Date.now() - t0;
  const txt = String(j?.choices?.[0]?.message?.content || '');
  const arr = (txt.match(/\[[\s\S]*\]/) || ['[]'])[0];
  let parsed = [];
  try { parsed = JSON.parse(arr); } catch { parsed = []; }
  const map = new Map(parsed.map((x) => [Number(x.i), String(x.verdict || '').toLowerCase()]));
  return { map, ms };
}

const our = samples.map((s) => ourVerdict(s));
const { map, ms } = await llmJudgeBatch(samples);
const theirs = samples.map((s, i) => map.get(i) || 'insufficient');

const acc = (v) => samples.filter((s, i) => v[i] === s.label).length;
console.log(`样本 ${samples.length}（真 ${samples.filter((s) => s.label === 'supported').length} / 假 ${samples.filter((s) => s.label === 'contradicted').length}）\n`);
console.log(`我们的规则判定：  一致 ${acc(our)}/${samples.length}（${(acc(our) / samples.length * 100).toFixed(1)}%）  模型调用 0 次`);
console.log(`对方式 LLM 判定：  一致 ${acc(theirs)}/${samples.length}（${(acc(theirs) / samples.length * 100).toFixed(1)}%）  模型调用 1 次，耗时 ${ms}ms`);

const diff = samples.map((s, i) => ({ i, label: s.label, our: our[i], theirs: theirs[i] })).filter((x) => x.our !== x.theirs);
console.log(`\n分歧 ${diff.length} 条：`);
for (const d of diff.slice(0, 6))
  console.log(`  #${d.i} 标签=${d.label} 我们=${d.our} 对方=${d.theirs}`);
