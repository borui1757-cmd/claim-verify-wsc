// liar-bench.mjs —— 骑士与无赖基准：用**构造保证的真值**测谎话检测器
//
// 为什么需要：我们一直没有"计分牌"——96 条样本是自己挑的，无法对外比较。
// 逻辑题（Knights and Knaves）给了一个办法：**真值由构造保证**，
// 于是能算出召回率/误报率，而不是"看起来还行"。
//
// 做法：
//   ① 造一个已知状态的世界（文件内容/行数、端口是否监听，都由我们控制）
//   ② 生成"真话句"和"假话句"，每句带真值标签
//   ③ 跑完整链路（抽取 → 核验）
//   ④ 统计：召回（假话被抓）、误报（真话被冤）、未抽到（根本没进链路）
//
// 用法：node tools/liar-bench.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { extractClaims, verifyClaims } from '../lib/index.js';

const CFG = { portTimeoutMs: 400, moneyTolerance: 0.15 };

/** 真实探测端口（独立于我们的核验器，避免循环论证） */
function probePort(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const fin = (v) => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(timeoutMs);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error', () => fin(false));
    try { s.connect(port, '127.0.0.1'); } catch { fin(false); }
  });
}

// ── ① 造世界 ──
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-liar-'));
const a = path.join(dir, 'a.txt');
const b = path.join(dir, 'b.md');
fs.writeFileSync(a, 'line1\nline2\nline3\n');   // 3 行
fs.writeFileSync(b, '# title\n');                // 1 行
const aLines = 3;
const aSize = fs.statSync(a).size;
const missing = path.join(dir, 'never-existed.txt');

// 端口真值：3210 历史上在监听，59999 一般空闲——但以**真实探测**为准
const PORT_UP = 3210;
const PORT_DOWN = 59999;
const upListening = await probePort(PORT_UP);
const downListening = await probePort(PORT_DOWN);

// ── ② 句子（真值标签由构造决定）──
const S = [];
const add = (text, truthful, kind) => S.push({ text, truthful, kind });

// path
add(`文件 \`${a}\` 存在。`, true, 'path');
add(`文件 \`${missing}\` 存在。`, false, 'path');

// lines
add(`文件 \`${a}\` 有 ${aLines} 行。`, true, 'lines');
add(`文件 \`${a}\` 有 ${aLines + 5} 行。`, false, 'lines');
add(`文件 \`${b}\` 有 1 行。`, true, 'lines');
add(`文件 \`${b}\` 有 9 行。`, false, 'lines');

// math
add('12 × 12 = 144。', true, 'math');
add('12 × 12 = 143。', false, 'math');
add('7 × 8 = 56。', true, 'math');
add('7 × 8 = 54。', false, 'math');

// port（按真实探测结果生成真/假句）
add(`127.0.0.1:${PORT_UP} 正在监听。`, upListening, 'port');
add(`127.0.0.1:${PORT_UP} 没有在监听。`, !upListening, 'port');
add(`127.0.0.1:${PORT_DOWN} 正在监听。`, downListening, 'port');
add(`127.0.0.1:${PORT_DOWN} 没有在监听。`, !downListening, 'port');

// ── ③ 跑链路 ──
let TP = 0, FN = 0, FP = 0, TN = 0, UNPARSED = 0, UNPARSED_FALSE = 0;
const rows = [];

for (const s of S) {
  const claims = extractClaims(s.text);
  if (!claims.length) {
    UNPARSED += 1;
    if (!s.truthful) UNPARSED_FALSE += 1;
    rows.push({ ...s, verdict: '未抽到' });
    continue;
  }
  const res = await verifyClaims(claims, 'liar', CFG);
  const flagged = (res.bad || []).length > 0;
  let verdict;
  if (s.truthful && flagged) { FP += 1; verdict = '误报'; }
  else if (!s.truthful && flagged) { TP += 1; verdict = '抓到'; }
  else if (s.truthful && !flagged) { TN += 1; verdict = '正确放过'; }
  else { FN += 1; verdict = '漏报'; }
  rows.push({ ...s, verdict });
}

// ── ④ 统计 ──
const totalFalse = S.filter((s) => !s.truthful).length;
const totalTrue = S.filter((s) => s.truthful).length;
const recall = totalFalse ? TP / totalFalse : 0;
const fpr = totalTrue ? FP / totalTrue : 0;

console.log(`骑士与无赖基准（${S.length} 句：真 ${totalTrue} / 假 ${totalFalse}）\n`);
console.log('  真值环境：a.txt 3 行、端口 ' + PORT_UP + (upListening ? ' 在听' : ' 未听')
  + '、' + PORT_DOWN + (downListening ? ' 在听' : ' 未听'));

for (const r of rows) {
  const tag = r.truthful ? '真' : '假';
  console.log(`  [${tag}] ${r.verdict.padEnd(4)} ${r.text.slice(0, 52)}`);
}

console.log('\n  指标：');
console.log(`    抓到谎言   ${TP}/${totalFalse}  （召回 ${(recall * 100).toFixed(1)}%）`);
console.log(`    冤判真话   ${FP}/${totalTrue}  （误报 ${(fpr * 100).toFixed(1)}%）`);
console.log(`    漏报       ${FN}`);
console.log(`    未抽到     ${UNPARSED}（其中假话 ${UNPARSED_FALSE}，等于白白漏掉）`);

fs.rmSync(dir, { recursive: true, force: true });

// 门槛：低于这个就说明回归了（当前基线：召回 100%、误报 0%）
const MIN_RECALL = 0.9;
const MAX_FPR = 0.1;
const ok = recall >= MIN_RECALL && fpr <= MAX_FPR;
console.log('\n  门槛：召回 ≥ ' + (MIN_RECALL * 100) + '%、误报 ≤ ' + (MAX_FPR * 100) + '% → ' + (ok ? '✅ 通过' : '❌ 未达标'));
process.exit(ok ? 0 : 1);
