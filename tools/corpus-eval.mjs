// corpus-eval.mjs —— 用人工标注算**抽取覆盖率**
//
// 这是唯一能给出"覆盖率 X%"的方式：分母是人工判定的"可核验句"，分子是我们真的抽到的。
import fs from 'node:fs';
import { LABELS } from './corpus-labels.mjs';
import { extractClaims } from '../lib/index.js';

const FILE = new URL('./corpus-candidates.jsonl', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rows = fs.readFileSync(FILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const byId = new Map(LABELS.map((l) => [l.id, l]));

let checkable = 0, extractedFromCheckable = 0, extractedFromOther = 0, textMissed = 0;
const detail = [];

for (const r of rows) {
  const label = byId.get(r.id);
  if (!label)
    continue;
  const cs = extractClaims(r.text);
  const got = cs.length > 0;
  if (label.checkable) {
    checkable += 1;
    if (got) extractedFromCheckable += 1;
    else textMissed += 1;
  }
  else if (got) {
    extractedFromOther += 1;
  }
  detail.push({ id: r.id, checkable: label.checkable, kinds: cs.map((c) => c.kind), text: r.text.slice(0, 40) });
}

const total = rows.length;
const catCount = {};
for (const l of LABELS) catCount[l.cat] = (catCount[l.cat] || 0) + 1;

console.log(`真实语料 ${total} 句（来自最近 30 条回复）\n`);
console.log('句子分类（CACDD 四分类）：');
for (const [k, v] of Object.entries(catCount)) console.log(`  ${k.padEnd(12)} ${v}`);

console.log('\n可核验性：');
console.log(`  人工判定可核验 ${checkable} 句（${(checkable / total * 100).toFixed(1)}%）`);
console.log(`  其中被我们抽到 ${extractedFromCheckable} 句`);
console.log(`  不可核验却被抽到 ${extractedFromOther} 句（误抽）`);

console.log('\n抽取覆盖率：');
const cov = checkable ? extractedFromCheckable / checkable : 0;
console.log(`  ${extractedFromCheckable}/${checkable} = ${(cov * 100).toFixed(1)}%`);

console.log('\n明细（只看有取值的）：');
for (const d of detail.filter((x) => x.kinds.length))
  console.log(`  #${d.id} ${d.kinds.join(',')}  ${d.text}`);
