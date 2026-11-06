// review-queue.mjs —— 待审队列：把 T2 攒起来一次看，T3 单独列出
//
// 依据 Planoly 的核心结论：**二十个弹窗不如一页清单**。
//   T1 不打扰
//   T2 放行但记账 → 在这里批量看
//   T3 停下等人 → 在这里单独列出（这些是"没执行"的动作）
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'C:/Users/19156/.dsh/dsh-claim-verify';
const Q = path.join(DIR, 'review-queue.jsonl');
const T = path.join(DIR, 'tier.jsonl');

const argOf = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : null;
};

function readJsonl(p) {
  if (!fs.existsSync(p))
    return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const clear = process.argv.includes('--clear');
const q = readJsonl(Q);
const t = readJsonl(T);

if (clear) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const [p, rows] of [[Q, q], [T, t]]) {
    if (!rows.length)
      continue;
    fs.copyFileSync(p, p + '.bak-' + stamp);
    fs.writeFileSync(p, '', 'utf8');
  }
  console.log(`已归档：T2 ${q.length} 条、T3 ${t.length} 条`);
  process.exit(0);
}

const since = argOf('--since');
const cutoff = since ? new Date(since).getTime() : 0;
const qf = q.filter((x) => new Date(x.at).getTime() >= cutoff);
const tf = t.filter((x) => new Date(x.at).getTime() >= cutoff);

console.log(`待审队列（${since ? 'since ' + since : '全部'}）\n`);

// ── T3：没执行的，等人拍板 ──
console.log(`T3 · 已拦下、等你决定：${tf.length} 条`);
for (const r of tf.slice(-15)) {
  console.log(`  [${new Date(r.at).toLocaleString('zh-CN')}] ${r.tool}  ${r.kind}`);
  if (r.reason)
    console.log(`      原因：${r.reason}`);
}
if (!tf.length)
  console.log('  （没有）');

// ── T2：执行了，但需要你攒着看一眼 ──
console.log(`\nT2 · 已放行、建议批量复查：${qf.length} 条`);
const byKind = {};
for (const r of qf) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
if (qf.length) {
  console.log('  分类：' + Object.entries(byKind).map(([k, v]) => `${k}×${v}`).join('  '));
  for (const r of qf.slice(-10)) {
    console.log(`  [${new Date(r.at).toLocaleString('zh-CN')}] ${r.tool}  ${r.reason || ''}`);
  }
  if (qf.length > 10)
    console.log(`  …还有 ${qf.length - 10} 条（用 --since 缩小范围）`);
}
else {
  console.log('  （没有）');
}

console.log('\n提示：--clear 归档并清空；--since 2026-11-07T00:00:00 只看之后');
