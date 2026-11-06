// corpus-task.mjs —— 从**任务型**会话里抽句子（有 write/edit/pwsh 实际动手的那种）
//
// 目的：验证覆盖率低是"场景不对"还是"抽取器太弱"。
import fs from 'node:fs';

const SRC = 'C:/Users/19156/.dsh/dsh-claim-verify/cases.jsonl';
const OUT = new URL('./corpus-task-candidates.jsonl', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LIMIT = Number(process.argv[2] || 24);

const lines = fs.readFileSync(SRC, 'utf8').trim().split('\n');
const rows = [];
for (const l of lines) {
  try { rows.push(JSON.parse(l)); } catch { /* 跳过 */ }
}

// 任务型判定：pairs 里有写类或 shell 工具
const isTask = (r) => Array.isArray(r.pairs) && r.pairs.some((p) => /write|edit|pwsh|bash|shell|exec/i.test(String(p && p.name)));

const taskRows = rows.filter((r) => isTask(r) && typeof r.report === 'string' && r.report.length > 150);
const bySession = new Map();
for (const r of taskRows) bySession.set(r.sessionId, (bySession.get(r.sessionId) || 0) + 1);

console.log('任务型会话（按回复条数）：');
for (const [k, v] of [...bySession.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6))
  console.log(`  ${String(v).padStart(4)} 条  ${k}`);

// 只取任务型会话的回复
const pool = taskRows.map((r) => r.report);

function clean(text) {
  return text
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/^\s*\|.*$/gm, '')
    .replace(/^\s*#{1,6}\s.*$/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*(?:[-*+]|\d+[.)、])\s*/gm, '');
}
function sentences(text) {
  return clean(text)
    .split(/(?<=[。！？])|\n+/)
    .map((s) => s.trim().replace(/^[，、：；]+/, ''))
    .filter((s) => /[。！？]$/.test(s))
    .filter((s) => s.length >= 12 && s.length <= 100);
}

const seen = new Set();
const all = [];
for (const r of pool) {
  for (const s of sentences(r)) {
    if (seen.has(s)) continue;
    seen.add(s);
    all.push(s);
  }
}

const step = Math.max(1, Math.floor(all.length / LIMIT));
const sample = all.filter((_, i) => i % step === 0).slice(0, LIMIT);

fs.writeFileSync(OUT, sample.map((s, i) => JSON.stringify({ id: i + 1, text: s })).join('\n') + '\n', 'utf8');
console.log(`\n任务型语料：候选 ${all.length} 句，抽样 ${sample.length} 句 -> ${OUT}\n`);
for (const s of sample) console.log('  ' + s);
