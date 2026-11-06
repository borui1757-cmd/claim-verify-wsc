// 自动精度审计：把历史 hits.jsonl 的每条"不一致"文本重新过一遍当前抽取器。
// 抽不出来 = 当初是抽取层误报（现在修掉了）；还抽得出来 = 当初确实是断言。
// 无需人工标注，可随时复跑。
//
// 用法：node tools/precision-replay.mjs [hits.jsonl 路径]
import fs from 'node:fs';
import path from 'node:path';
import { extractClaims } from '../lib/index.js';

const file = process.argv[2] || 'C:/Users/19156/.dsh/dsh-claim-verify/hits.jsonl';
if (!fs.existsSync(file)) {
  console.log('找不到 hits.jsonl:', file);
  process.exit(1);
}

const rows = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim())
    continue;
  let e;
  try {
    e = JSON.parse(line);
  }
  catch {
    continue;
  }
  if (!e || !Array.isArray(e.bad) || e.bad.length === 0)
    continue;
  rows.push(e);
}

const keyOf = (kind, value) => kind + '|' + JSON.stringify(value);
const stats = { total: 0, stillAsserted: 0, noLongerAsserted: 0 };
const byKind = {};
const byDay = {};

for (const e of rows) {
  const day = String(e.at || '').slice(0, 10);
  byDay[day] = byDay[day] || { total: 0, gone: 0, kept: 0 };
  const text = typeof e.text === 'string' ? e.text : '';
  let fresh = [];
  try {
    fresh = extractClaims(text);
  }
  catch {
    fresh = [];
  }
  const freshKeys = new Set(fresh.map((c) => keyOf(c.kind, c.value)));

  for (const b of e.bad) {
    const k = keyOf(b.kind, b.claim);
    const kept = freshKeys.has(k);
    stats.total += 1;
    if (kept)
      stats.stillAsserted += 1;
    else
      stats.noLongerAsserted += 1;
    byKind[b.kind] = byKind[b.kind] || { total: 0, gone: 0, kept: 0 };
    byKind[b.kind].total += 1;
    byKind[b.kind][kept ? 'kept' : 'gone'] += 1;
    byDay[day].total += 1;
    byDay[day][kept ? 'kept' : 'gone'] += 1;
  }
}

const pct = (n, d) => (d ? (n / d * 100).toFixed(1) + '%' : '-');
console.log('审计样本：' + rows.length + ' 条记录，' + stats.total + ' 条"不一致"断言\n');
console.log('已修掉（新抽取器不再抽出）: ' + stats.noLongerAsserted + '  ' + pct(stats.noLongerAsserted, stats.total));
console.log('仍被抽出（当初确实是断言）: ' + stats.stillAsserted + '  ' + pct(stats.stillAsserted, stats.total));

console.log('\n按类型：');
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1].total - a[1].total))
  console.log(`  ${k.padEnd(8)} 共 ${String(v.total).padStart(4)}  修掉 ${String(v.gone).padStart(4)} (${pct(v.gone, v.total)})`);

console.log('\n按日期：');
for (const [d, v] of Object.entries(byDay).sort())
  console.log(`  ${d}  共 ${String(v.total).padStart(4)}  修掉 ${String(v.gone).padStart(4)} (${pct(v.gone, v.total)})`);

// ── 去重口径（2026-11-06 加）──
// 同一条断言会在多轮里被反复记录，按记录数算比例会被重复计数带偏。
// 真实精度必须按**唯一断言**（kind + value）统计。
const uniq = new Map();
for (const e of rows) {
  const text = typeof e.text === 'string' ? e.text : '';
  let fresh = [];
  try {
    fresh = extractClaims(text);
  }
  catch {
    fresh = [];
  }
  const freshKeys = new Set(fresh.map((c) => keyOf(c.kind, c.value)));
  for (const b of e.bad) {
    const k = keyOf(b.kind, b.claim);
    const cur = uniq.get(k) || { kind: b.kind, claim: b.claim, n: 0, kept: false };
    cur.n += 1;
    cur.kept = cur.kept || freshKeys.has(k);
    uniq.set(k, cur);
  }
}
const uArr = [...uniq.values()];
const uGone = uArr.filter((u) => !u.kept).length;
console.log('\n去重后：唯一断言 ' + uArr.length + ' 条 —— 修掉 ' + uGone + ' (' + pct(uGone, uArr.length) + ')');
console.log('重复最多的 8 条（n = 被记录次数）：');
for (const u of uArr.sort((a, b) => b.n - a.n).slice(0, 8))
  console.log(`  ${String(u.n).padStart(4)}×  ${u.kind.padEnd(8)} ${JSON.stringify(u.claim).slice(0, 60)}  ${u.kept ? '[仍抽出]' : '[已修掉]'}`);
