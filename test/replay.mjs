// replay.mjs —— 拿 hits.jsonl 里存下的真实回复片段回放抽取层，看误报有没有掉。
// hits.jsonl 只记「判过不符」的轮次，所以这就是误报语料。
// 用法：node test/replay.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractClaims } from '../lib/index.js';

const home = process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh');
const file = path.join(home, 'dsh-claim-verify', 'hits.jsonl');

if (!fs.existsSync(file)) {
  console.log('没有 hits.jsonl，跳过');
  process.exit(0);
}

const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
  try {
    return JSON.parse(l);
  }
  catch {
    return null;
  }
}).filter(Boolean);

let withClaims = 0;
const kinds = {};
for (const r of rows) {
  const claims = extractClaims(r.text || '');
  if (claims.length)
    withClaims += 1;
  for (const c of claims)
    kinds[c.kind] = (kinds[c.kind] || 0) + 1;
  console.log(`[${claims.length ? 'CLAIM' : '  -  '}] 旧: ${(r.bad || []).map((b) => `${b.kind}:${b.claim}`).join(', ') || '(none)'}`);
  for (const c of claims)
    console.log(`        新: ${c.kind} ${typeof c.value === 'object' ? JSON.stringify(c.value) : c.value}  polar=${c.polarity} conf=${c.confidence}`);
}

console.log(`\n共 ${rows.length} 条历史误报样本，其中 ${withClaims} 条仍会抽出断言`);
console.log('按类统计：', JSON.stringify(kinds));
