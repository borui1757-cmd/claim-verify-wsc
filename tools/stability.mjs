// 重复执行稳定性（Trust Layer 属性④）
//
// 依据 A Trust Layer for Agent Evaluation (arXiv 2610.07274)：
// 它报告的四个属性里，④ 是"结果是否在重复执行下稳定"，
// 实测 **18–46% 的任务在五次运行中无法稳定在同一分数区间**。
//
// 注意和 metamorphic 的区别：
//   metamorphic  = 同一断言**换文本写法**，判定必须不变（测抽取稳定性）
//   stability    = 同一断言**重跑多次**，世界不变，判定必须不变（测判定稳定性）
//
// 用法：node tools/stability.mjs [次数]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { extractClaims, verifyClaims } from '../lib/index.js';

const ROUNDS = Number(process.argv[2] || 5);
const CFG = { portTimeoutMs: 400, moneyTolerance: 0.15 };

function probePort(port) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (v) => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(400);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    s.connect(port, '127.0.0.1');
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-stab-'));
const real = path.join(tmp, 'stable.txt');
fs.writeFileSync(real, 'x'.repeat(32));
const ghost = path.join(tmp, 'ghost.txt');

// 世界在这几轮里保持不变：断言的真值也就固定
const cases = [
  { name: 'path 存在', kind: 'path', text: `配置文件写进了 \`${real}\`，共 32 字节。` },
  { name: 'path 不存在', kind: 'path', text: `这个路径不存在：\`${ghost}\`。` },
  { name: 'port 未监听', kind: 'port', text: `127.0.0.1:59077 没有服务在监听。` },
  { name: 'math 正确', kind: 'math', text: '算式 12 乘以 12 等于 144。' },
  { name: 'math 错误', kind: 'math', text: '算式 12 乘以 12 等于 145。' },
];

const results = [];
for (const c of cases) {
  const verdicts = [];
  for (let i = 0; i < ROUNDS; i++) {
    const claims = extractClaims(c.text);
    if (!claims.length) { verdicts.push('missing'); continue; }
    const res = await verifyClaims(claims, 'stability', CFG, { probePort });
    verdicts.push((res.bad || []).length ? 'bad' : 'ok');
  }
  const uniq = [...new Set(verdicts)];
  results.push({ ...c, verdicts, stable: uniq.length === 1 });
}

const total = results.length;
const unstable = results.filter((r) => !r.stable);
const pct = (n, d) => (d ? (n / d * 100).toFixed(1) + '%' : 'n/a');

console.log(`重复执行稳定性（每例跑 ${ROUNDS} 次，世界保持不变）\n`);
for (const r of results) {
  console.log((r.stable ? '稳定  ' : '不稳定') + '  ' + r.name.padEnd(12) + ' → ' + r.verdicts.join(' / '));
}
console.log('');
console.log(`稳定 ${total - unstable.length}/${total} = ${pct(total - unstable.length, total)}`);
console.log(`不稳定 ${unstable.length}/${total} = ${pct(unstable.length, total)}`);

if (unstable.length) {
  console.log('\n不稳定明细（这些类型应降为 soft 或标 INCONCLUSIVE）：');
  for (const r of unstable) console.log('  - ' + r.name + '：' + r.verdicts.join(' / '));
}

// ── 阶段 2：世界在跑动中变化，判定**必须跟着变** ──────────────────────
// 稳定不等于正确：如果世界从"存在"变成"不存在"，验证器还一直说 ok，那是漏判。
console.log('\n漂移敏感性（运行到第 3 轮时删掉文件，判定应当翻转）\n');
const changing = path.join(tmp, 'changing.txt');
fs.writeFileSync(changing, 'y'.repeat(16));
const text = `配置文件写进了 \`${changing}\`，共 16 字节。`;

const seq = [];
for (let i = 1; i <= ROUNDS; i++) {
  if (i === 3)
    fs.rmSync(changing, { force: true });
  const claims = extractClaims(text);
  const res = claims.length ? await verifyClaims(claims, 'stability', CFG, { probePort }) : { bad: [] };
  seq.push((res.bad || []).length ? 'bad' : 'ok');
}
const flipped = seq.includes('ok') && seq.includes('bad');
console.log('  判定序列：' + seq.join(' / '));
console.log('  ' + (flipped ? '✅ 检出漂移（先 ok 后 bad）' : '❌ 未检出漂移——这是漏判'));


try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
process.exit(0);
