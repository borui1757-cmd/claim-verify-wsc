// incident.mjs —— 从黑盒里把事故"冻结"成可重放的回归用例。
//
// 闭环缺的就是这一段：
//   黑盒（记录） → 聚类（同签名归并） → 冻结（存原始句子 + 期望判定）
//   → 重放（用当前代码再判一次，看是否还复现） → 决定修不修
//
// 依据：Tracely-ai 的 trace-native CI（grade traces → cluster failures →
// freeze into replayable regression tests）、以及 delta debugging 的"最小化失败用例"。
//
// 用法：
//   node tools/incident.mjs              # 扫描黑盒，输出/更新 incidents.jsonl
//   node tools/incident.mjs --replay     # 用当前代码重放每条事故，看是否还复现
import fs from 'node:fs';
import path from 'node:path';
import { extractClaims, verifyClaims } from '../lib/index.js';

const BB = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]
  : 'C:/Users/19156/.dsh/dsh-claim-verify/blackbox';
const OUT = new URL('./incidents.jsonl', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CFG = { portTimeoutMs: 400, moneyTolerance: 0.15 };

const file = path.join(BB, 'events.jsonl');
if (!fs.existsSync(file)) {
  console.log('没有黑盒记录：' + file);
  process.exit(0);
}

const events = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

// 1) 找判 INVALID 的核验事件（真实事故）
const fails = events.filter((e) => e.type === 'verify' && e.payload && e.payload.verdict === 'INVALID');
if (!fails.length) {
  console.log('黑盒里没有 INVALID 判定（' + events.length + ' 条事件）');
  process.exit(0);
}

// 2) 聚类：同一 (kind, reason) 视为同一类事故，只留最早一条
const sigOf = (e) => `${e.payload.kind}|${String(e.payload.reason || '').slice(0, 24)}`;
const clusters = new Map();
for (const e of fails) {
  const sig = sigOf(e);
  if (!clusters.has(sig))
    clusters.set(sig, { sig, first: e, count: 0, raw: e.payload.raw || '' });
  clusters.get(sig).count += 1;
}

console.log(`发现 ${fails.length} 次 INVALID，归并为 ${clusters.size} 类事故\n`);
for (const [sig, c] of [...clusters.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(c.count).padStart(4)}×  ${sig}  ${c.raw ? '「' + c.raw.slice(0, 40) + '…」' : '(无原文)'}`);
}

// 3) 冻结成用例（只保留有原文、可重放的）
const cases = [];
for (const [sig, c] of clusters) {
  if (!c.raw)
    continue;
  cases.push({ sig, kind: c.first.payload.kind, raw: c.raw, expected: 'INVALID', count: c.count, at: c.first.at });
}

fs.writeFileSync(OUT, cases.map((c) => JSON.stringify(c)).join('\n') + (cases.length ? '\n' : ''), 'utf8');
console.log(`\n已冻结 ${cases.length} 条可重放用例 -> ${OUT}`);

// 4) 重放：用当前代码再判一次
if (process.argv.includes('--replay')) {
  console.log('\n重放（当前代码）：');
  let still = 0, fixed = 0, unknown = 0, ignored = 0;
  for (const c of cases) {
    const claims = extractClaims(c.raw).filter((x) => x.kind === c.kind);
    if (!claims.length) {
      // 抽不出来了 = 抽取/过滤层已经把它挡掉（或本来就该忽略），算"已规避"
      ignored += 1;
      console.log(`  ○  已规避  ${c.sig}（当前抽取器不再把它当断言）`);
      continue;
    }
    const res = await verifyClaims(claims, 'incident', CFG);
    const badNow = (res.bad || []).length > 0;
    if (badNow) { still += 1; console.log(`  ✗  仍复现  ${c.sig}`); }
    else { fixed += 1; console.log(`  ✓  已修复  ${c.sig}`); }
  }
  console.log(`\n重放结果：仍复现 ${still} / 已修复 ${fixed} / 无法判定 ${unknown}`);
}
