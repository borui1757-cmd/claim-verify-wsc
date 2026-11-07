// 真实案例演示：把"现在是 2:40 多"这句没核实的声明喂给核验器。
// 展示两种情况：宽松容差（±10 分钟）与严格容差（±2 分钟）。
import { runPlan } from '../lib/dsl.js';

const claim = '现在是 2:40 多';
console.log('声明：' + claim);
console.log('系统真值：' + new Date().toTimeString().slice(0, 8) + '\n');

for (const tol of [10, 2]) {
  const plan = { all: [{ prim: 'time_near', args: { hhmm: '02:40', toleranceMin: tol }, expect: true }] };
  const r = await runPlan(plan, {});
  console.log(`容差 ±${tol} 分钟 → ${r.verdict.padEnd(12)} ${r.results?.[0]?.detail || ''}`);
}

console.log('\n结论：同一句话，容差决定它是"支持"还是"反驳"——');
console.log('     而"把估计当事实说"这件事，判据再严也只能事后抓，不能事前拦。');
