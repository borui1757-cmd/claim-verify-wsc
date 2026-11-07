#!/usr/bin/env node
// 验证当初那个"60 多"：句子级 NLI 路线能把覆盖率提到多少？
//
// 做法（当初设想的第 2 层）：
//   证据文档 = 这一轮所有 tool/result 文本（trace）
//   句子     = 报告里每一句
//   判定     = 模型判 支持/反驳/没提（三分类）
//   覆盖率   = 可判定（支持或反驳）/ 全部句
//
// 对照：规则路线（14 类正则）在同一批句子上的覆盖率。
//
// 用法：node eval/nli-coverage.mjs [--n 40]

import fs from 'node:fs';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const N = Math.max(10, argOf('n') || 40);

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams.deepseek;
const base = String(up.baseUrl).replace(/\/$/, '');

const CASES = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/data/harvested-cases.jsonl';
const cases = fs.readFileSync(CASES, 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// 抽句子（带证据的会话）
const picked = [];
for (const c of cases) {
  const pairs = c.pairs || [];
  const evidenceText = pairs.map((p) => String(p.text || '')).join('\n');
  if (evidenceText.length < 20)
    continue;
  const sents = String(c.report || '').split(/[。！？\n]+/).map((s) => s.trim()).filter((s) => s.length >= 6);
  for (const s of sents) {
    if (picked.length >= N)
      break;
    picked.push({ sentence: s, evidence: evidenceText.slice(0, 1500) });
  }
  if (picked.length >= N)
    break;
}

const SYS = `你是核验器。给定"证据文档"和一句"声明"，判断：
- supported：证据明确支持该声明
- contradicted：证据明确反驳该声明
- insufficient：证据里没提到，或无法判断
只输出一个词：supported / contradicted / insufficient。`;

async function judge(s) {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
    body: JSON.stringify({
      model: up.model,
      messages: [
        { role: 'system', content: SYS },
        { role: 'user', content: `证据文档：\n${s.evidence}\n\n声明：${s.sentence}` },
      ],
      temperature: 0, max_tokens: 10,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  const txt = String(j?.choices?.[0]?.message?.content || '').toLowerCase();
  if (txt.includes('contradict')) return 'contradicted';
  if (txt.includes('support')) return 'supported';
  return 'insufficient';
}

// 规则路线：14 类断言的可核验标志（简化：路径/端口/进程/命令/字节数）
const RULE = /([A-Za-z]:\\|\/[a-z]+\/|:\d{2,5}\b|\d+\s*(?:字节|bytes)|\b\d+\.\d+\.\d+\b|npm\s+\w+|node\s+\S+|git\s+\w+|exit code)/i;

const rows = [];
for (const s of picked) {
  const verdict = await judge(s);
  rows.push({ ...s, verdict, byRule: RULE.test(s.sentence) });
}

const total = rows.length;
const decidable = rows.filter((r) => r.verdict !== 'insufficient').length;
const byRule = rows.filter((r) => r.byRule).length;
const hybrid = rows.filter((r) => r.byRule || r.verdict !== 'insufficient').length;
const both = rows.filter((r) => r.byRule && r.verdict !== 'insufficient').length;
const pct = (x) => (total ? (x / total * 100).toFixed(1) : '0') + '%';

console.log(`抽样 ${total} 句\n`);
const dist = {};
for (const r of rows)
  dist[r.verdict] = (dist[r.verdict] || 0) + 1;
console.log('三分类分布：', JSON.stringify(dist));
console.log(`规则路线可判定：${byRule}/${total}（${pct(byRule)}）`);
console.log(`NLI 路线可判定：${decidable}/${total}（${pct(decidable)}）`);
console.log(`两者重叠：${both}/${total}`);
console.log(`**混合（并集）**：${hybrid}/${total}（${pct(hybrid)}）`);
console.log('\n样例：');
for (const r of rows.slice(0, 6))
  console.log(`  [${r.verdict}] rule=${r.byRule ? 'Y' : 'N'} ${r.sentence.slice(0, 60)}`);

const md = [
  `# NLI 路线 vs 规则路线：覆盖率（n=${total}）`,
  '',
  `| 路线 | 可判定 | 覆盖率 |`,
  `|---|---|---|`,
  `| 规则（14 类标志） | ${byRule}/${total} | ${pct(byRule)} |`,
  `| NLI（三分类） | ${decidable}/${total} | ${pct(decidable)} |`,
  `| **混合（并集）** | ${hybrid}/${total} | **${pct(hybrid)}** |`,
  '',
  `两者重叠 ${both}/${total}（NLI 独有 ${decidable - both}，规则独有 ${byRule - both}）`,
  '',
  `三分类分布：${JSON.stringify(dist)}`,
  '',
  '当初的估计是"接入 NLI 可到 60%+"，本表是实测。',
];
fs.writeFileSync(process.env.USERPROFILE + '/Desktop/nli-coverage.md', md.join('\n'));
console.log('\n已写入桌面 nli-coverage.md');
