#!/usr/bin/env node
// 外部世界模型账本：查看/统计/查询
//
//   node bin/worldmodel.mjs            统计
//   node bin/worldmodel.mjs --tail 20  最后 20 条
//   node bin/worldmodel.mjs --find <target>
//   node bin/worldmodel.mjs --rate     按周统计反驳率（长期效果）

import { readLedger, ledgerStats, lookupFact } from '../lib/worldmodel.js';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes('--tail')) {
  const n = Math.max(1, Number(argOf('tail') || 20));
  const rows = readLedger().slice(-n);
  for (const r of rows)
    console.log(`${new Date(r.at).toISOString().slice(0, 19)}  ${r.kind.padEnd(6)} ${r.verdict.padEnd(12)} ${r.target}`);
  process.exit(0);
}

if (args.includes('--find')) {
  const target = argOf('find');
  const hit = lookupFact({ kind: args.includes('--kind') ? argOf('kind') : 'file', target });
  console.log(hit ? JSON.stringify(hit, null, 1) : '账本里没有该对象');
  process.exit(0);
}

if (args.includes('--rate')) {
  const rows = readLedger();
  if (!rows.length) {
    console.log('账本为空');
    process.exit(0);
  }
  const week = 7 * 24 * 3600 * 1000;
  const t0 = rows[0].at;
  const buckets = new Map();
  for (const r of rows) {
    const w = Math.floor((r.at - t0) / week) + 1;
    const b = buckets.get(w) || { total: 0, contradicted: 0 };
    b.total += 1;
    if (r.verdict === 'contradicted')
      b.contradicted += 1;
    buckets.set(w, b);
  }
  console.log('周次  判定数  反驳数  反驳率');
  for (const [w, b] of [...buckets.entries()].sort((a, b2) => a[0] - b2[0]))
    console.log(`第${w}周  ${String(b.total).padStart(5)}  ${String(b.contradicted).padStart(5)}  ${(b.contradicted / b.total * 100).toFixed(1)}%`);
  process.exit(0);
}

const s = ledgerStats();
console.log(`账本条目 ${s.total}`);
if (s.total) {
  console.log('时间范围：' + new Date(s.first).toISOString().slice(0, 10) + ' → ' + new Date(s.last).toISOString().slice(0, 10));
  console.log('按类型：' + Object.entries(s.byKind).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('按判定：' + Object.entries(s.byVerdict).map(([k, v]) => `${k}=${v}`).join('  '));
}
