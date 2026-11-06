// corpus-build.mjs —— 从真实回复里抽句子，做成待标注语料
//
// 为什么从 cases.jsonl 取：那里存着每条回复的原文（report 字段），是真语料，
// 不是我们编的模板。标注规范借 CACDD 的两条：
//   ① 句子四分类：fact / opinion / instruction / other
//   ② 原子断言四原则：不可分 / 语义完整 / 可验证 / 上下文独立
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'C:/Users/19156/.dsh/dsh-claim-verify/cases.jsonl';
const OUT = new URL('./corpus-candidates.jsonl', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const lines = fs.readFileSync(SRC, 'utf8').trim().split('\n');
const reports = [];
for (const l of lines) {
  try {
    const j = JSON.parse(l);
    if (typeof j.report === 'string' && j.report.length > 150)
      reports.push(j.report);
  }
  catch { /* 跳过坏行 */ }
}

// 取最近 30 条回复
const recent = reports.slice(-30);

/** 去掉代码块/表格/标题/列表符号，只留正文 */
function clean(text) {
  return text
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/^\s*\|.*$/gm, '')
    .replace(/^\s*#{1,6}\s.*$/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*(?:[-*+]|\d+[.)、])\s*/gm, '');
}

/** 只保留**完整句子**（以句末标点结尾），剔除列表碎片 */
function sentences(text) {
  return clean(text)
    .split(/(?<=[。！？])|\n+/)
    .map((s) => s.trim().replace(/^[，、：；]+/, ''))
    .filter((s) => /[。！？]$/.test(s))
    .filter((s) => s.length >= 12 && s.length <= 100);
}

const seen = new Set();
const out = [];
for (const r of recent) {
  for (const s of sentences(r)) {
    if (seen.has(s))
      continue;
    seen.add(s);
    out.push(s);
  }
}

// 均匀抽样 30 句，便于人工标注
const step = Math.max(1, Math.floor(out.length / 30));
const sample = out.filter((_, i) => i % step === 0).slice(0, 30);

fs.writeFileSync(OUT, sample.map((s, i) => JSON.stringify({ id: i + 1, text: s })).join('\n') + '\n', 'utf8');
console.log(`候选句 ${out.length} 句，抽样 ${sample.length} 句 -> ${OUT}\n`);
for (const s of sample) console.log('  ' + s);
