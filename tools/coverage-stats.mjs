// 统计当前真实覆盖率相关的三个可测指标
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'C:/Users/19156/.dsh/dsh-claim-verify';

function readJsonl(name) {
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n')
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const hits = readJsonl('hits.jsonl');
const steps = readJsonl('steps.jsonl');
const cases = readJsonl('cases.jsonl');

console.log('日志规模：');
console.log(`  hits.jsonl  ${hits.length} 条`);
console.log(`  steps.jsonl ${steps.length} 条`);
console.log(`  cases.jsonl ${cases.length} 条`);

// ① 每轮抽到多少断言（按 hits 里 checked 累加）
const withChecked = hits.filter((h) => typeof h.checked === 'number');
const totalChecked = withChecked.reduce((s, h) => s + h.checked, 0);
console.log('\n① 断言吞吐：');
console.log(`  有核验记录的轮次 ${withChecked.length}`);
console.log(`  累计核对断言 ${totalChecked} 条`);
console.log(`  平均每轮 ${(totalChecked / Math.max(1, withChecked.length)).toFixed(2)} 条`);

// ② 有断言 vs 无断言的轮次（区分"没抽到"和"本来就没有"）
const zero = withChecked.filter((h) => h.checked === 0).length;
console.log(`  零断言轮次 ${zero}（${(zero / Math.max(1, withChecked.length) * 100).toFixed(1)}%）`);

// ③ steps 里 soft / reward 分布 = 判定质量
const soft = steps.filter((s) => s.reward === 0).length;
const bad = steps.filter((s) => s.reward === -1).length;
const ok = steps.filter((s) => s.reward === 1).length;
console.log('\n② 判定分布（steps）：');
console.log(`  通过 ${ok} / 不符 ${bad} / 低置信 ${soft}`);
if (ok + bad > 0)
  console.log(`  硬判定里不符占比 ${(bad / (ok + bad) * 100).toFixed(1)}%`);

// ④ 按 kind 分布 —— 看覆盖的是哪几类
const byKind = {};
for (const s of steps) byKind[s.kind] = (byKind[s.kind] || 0) + 1;
console.log('\n③ 断言类型分布：');
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.padEnd(12)} ${v}`);

// ⑤ cases.jsonl 里如果有 claims 字段，能算每轮抽到几条
const withClaims = cases.filter((c) => Array.isArray(c.claims) && c.claims.length);
if (withClaims.length) {
  const tot = withClaims.reduce((s, c) => s + c.claims.length, 0);
  console.log('\n④ cases 里的抽取：');
  console.log(`  含断言的轮次 ${withClaims.length} / ${cases.length}`);
  console.log(`  平均每轮 ${(tot / withClaims.length).toFixed(2)} 条`);
}
