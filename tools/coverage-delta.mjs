// 新层（一致性 / 证据独立性）在真实语料上到底贡献了多少
import fs from 'node:fs';
import { LABELS } from './corpus-labels.mjs';
import { extractClaims, verifyClaims } from '../lib/index.js';

const FILE = new URL('./corpus-candidates.jsonl', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const rows = fs.readFileSync(FILE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const byId = new Map(LABELS.map((l) => [l.id, l]));

let extracted = 0, contradictions = 0, conflicts = 0;
for (const r of rows) {
  const cs = extractClaims(r.text);
  if (!cs.length) continue;
  extracted += 1;
  const res = await verifyClaims(cs, 'cov', {});
  if ((res.contradictions || []).length) contradictions += 1;
  if ((res.conflicts || []).length) conflicts += 1;
}

const total = rows.length;
console.log(`语料 ${total} 句`);
console.log(`  抽到断言      ${extracted} 句`);
console.log(`  新层命中：一致性 ${contradictions} 句 / 证据冲突 ${conflicts} 句`);
console.log(`  依然零产出    ${total - extracted - contradictions - conflicts} 句`);
