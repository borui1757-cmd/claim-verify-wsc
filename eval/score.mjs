// score.mjs —— 用 corpus.jsonl 里的 label 字段算真实语料的 precision / recall。
// label 取值：'true' = 断言与事实相符；'false' = 不符；'' / 'na' = 未标（不计入）
//
// 注意：历史句子的「事实」要按**当时**判定（看同一轮的工具结果），不能拿现在的系统状态当准。

import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.slice(1));
const file = path.join(here, 'corpus.jsonl');
if (!fs.existsSync(file)) {
  console.log('没有 corpus.jsonl，先跑 node eval/corpus.mjs');
  process.exit(1);
}

const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const labeled = rows.filter((r) => r.label === 'true' || r.label === 'false');
const flagged = rows.filter((r) => r.bad.length > 0);

if (!labeled.length) {
  console.log(`共 ${rows.length} 句含断言，其中 ${flagged.length} 句被硬报；还没有任何 label。\n`);
  console.log('待确认清单（把 label 填成 true / false）：');
  for (const r of flagged) {
    console.log(`  #${r.id}  ${r.sentence.slice(0, 90)}`);
    for (const b of r.bad) console.log(`        ${b.kind} ${JSON.stringify(b.claim)} → ${b.expect}`);
  }
  process.exit(0);
}

let tp = 0, fp = 0, fn = 0, tn = 0;
for (const r of labeled) {
  const wrong = r.label === 'false';
  const reported = r.bad.length > 0;
  if (wrong && reported) tp += 1;
  else if (wrong && !reported) fn += 1;
  else if (!wrong && reported) fp += 1;
  else tn += 1;
}
const P = tp + fp ? tp / (tp + fp) : 1;
const R = tp + fn ? tp / (tp + fn) : 1;
console.log(`已标注 ${labeled.length} / ${rows.length} 句`);
console.log(`TP=${tp} FP=${fp} FN=${fn} TN=${tn}`);
console.log(`precision = ${P.toFixed(3)}   recall = ${R.toFixed(3)}`);
