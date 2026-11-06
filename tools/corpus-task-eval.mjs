// 任务型语料的覆盖率评估
import fs from 'node:fs';
import { LABELS } from './corpus-task-labels.mjs';
import { extractClaims } from '../lib/index.js';

const FILE = new URL('./corpus-task-candidates.jsonl', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rows = fs.readFileSync(FILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const byId = new Map(LABELS.map((l) => [l.id, l]));

let checkable = 0, got = 0, wrong = 0;
const catCount = {};
for (const r of rows) {
  const label = byId.get(r.id);
  if (!label) continue;
  catCount[label.cat] = (catCount[label.cat] || 0) + 1;
  const cs = extractClaims(r.text);
  if (label.checkable) {
    checkable += 1;
    if (cs.length) got += 1;
    else console.log(`  [漏] #${r.id} (${label.kind}) ${r.text.slice(0, 50)}`);
  }
  else if (cs.length) {
    wrong += 1;
    console.log(`  [误抽] #${r.id} ${cs.map((c) => c.kind).join(',')} ${r.text.slice(0, 50)}`);
  }
}

console.log(`\n任务型语料 ${rows.length} 句`);
console.log('分类:', JSON.stringify(catCount));
console.log(`可核验 ${checkable} 句（${(checkable / rows.length * 100).toFixed(1)}%）`);
console.log(`抽到 ${got} 句，误抽 ${wrong} 句`);
console.log(`覆盖率 = ${got}/${checkable} = ${(checkable ? got / checkable * 100 : 0).toFixed(1)}%`);
