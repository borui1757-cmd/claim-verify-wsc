// 第 2 步（续）：跑标定集，ρ₀ / ρ₁ / 召回 / 诱饵误抽。
//
// 关键设计：**真值由 runner 自己从系统独立取**（fs.existsSync / TCP 探测），
// 不依赖生成时写下的 truth 字段，也不复用插件内部的判定代码。
// 这样测的是「抽取 + 极性 + 断言识别」，而不是"插件和自己比"。
//
// 用法：node tools/gen-calibration.mjs && node tools/run-calibration.mjs
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { extractClaims, verifyClaims } from '../lib/index.js';

const SET = new URL('./calibration-set.jsonl', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const STATE = new URL('./calibration-state.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CFG = { portTimeoutMs: 600, moneyTolerance: 0.15 };

function probePort(port) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (v) => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(600);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    s.connect(port, '127.0.0.1');
  });
}

if (!fs.existsSync(SET)) { console.log('缺少标定集，先跑 node tools/gen-calibration.mjs'); process.exit(1); }

// 重建 grounding：文件可能存在被上轮清理过，这里按 state 重建
let state = null;
if (fs.existsSync(STATE)) {
  state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  for (const f of state.files || []) {
    try {
      fs.mkdirSync(path.dirname(f.path), { recursive: true });
      if (!fs.existsSync(f.path)) fs.writeFileSync(f.path, 'x'.repeat(f.size));
    }
    catch { /* 重建失败就让该条按"不存在"参与统计 */ }
  }
}

const cases = fs.readFileSync(SET, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const keyOf = (kind, value) => kind + '|' + JSON.stringify(typeof value === 'string' ? value.trim() : value);

let TP = 0, TN = 0, FP = 0, FN = 0, missed = 0, decoy = 0, decoyHit = 0;
const notes = [];
// 2026-11-06：顺手吐一份**平衡的** per-step 训练样本（PRM 需要正样本，hits.jsonl 只有负的）
const calibSteps = [];

for (const c of cases) {
  let claims = [];
  try { claims = extractClaims(c.text); } catch { claims = []; }
  const mine = claims.filter((x) => x.kind === c.kind);

  if (c.decoy) {
    decoy += 1;
    if (mine.length) { decoyHit += 1; notes.push(`诱饵被误抽: ${c.text.slice(0, 60)}`); }
    continue;
  }
  if (mine.length === 0) { missed += 1; notes.push(`未抽到: ${c.text.slice(0, 60)}`); continue; }

  const res = await verifyClaims(claims, 'calib-set', CFG, { probePort });
  const flagged = new Set((res.bad || []).map((b) => keyOf(b.claim.kind, b.claim.value)));

  // 独立真值：对每条断言问系统"现在到底怎样"，再按极性推期望
  for (const cl of mine) {
    const got = flagged.has(keyOf(cl.kind, cl.value));
    let real = null;
    if (cl.kind === 'path') real = fs.existsSync(cl.value);
    else if (cl.kind === 'port') real = await probePort(cl.value);
    else continue; // pid/math 不做独立真值，跳过统计

    // 肯定断言：实际成立才算对；否定断言：实际不成立才算对
    const shouldBeBad = cl.polarity === 'neg' ? real === true : real === false;
    calibSteps.push({
      at: new Date().toISOString(),
      sessionId: 'calibration',
      kind: cl.kind,
      value: cl.value,
      prediction: JSON.stringify(cl.value),
      observation: shouldBeBad ? '与系统真值不符' : '与系统真值一致',
      reward: shouldBeBad ? -1 : 1,
    });
    if (!shouldBeBad && !got) TN += 1;
    else if (!shouldBeBad && got) { FP += 1; notes.push(`判错: ${c.text.slice(0, 58)}`); }
    else if (shouldBeBad && got) TP += 1;
    else { FN += 1; notes.push(`漏放: ${c.text.slice(0, 58)}`); }
  }
}

const pct = (n, d) => (d ? (n / d * 100).toFixed(1) + '%' : 'n/a');
const realCount = TP + TN + FP + FN;
console.log('标定集：' + cases.length + ' 条（参与统计的断言 ' + realCount + ' / 诱饵 ' + decoy + '）\n');
console.log('四格  TP=' + TP + '  TN=' + TN + '  FP=' + FP + '  FN=' + FN + '  未抽取=' + missed + '\n');
console.log('ρ₀ 假阳性率 = ' + FP + '/' + (FP + TN) + ' = ' + pct(FP, FP + TN));
console.log('ρ₁ 假阴性率 = ' + FN + '/' + (FN + TP) + ' = ' + pct(FN, FN + TP));
console.log('诱饵误抽   = ' + decoyHit + '/' + decoy + ' = ' + pct(decoyHit, decoy));
if (notes.length) {
  console.log('\n问题明细（最多 10 条）：');
  for (const n of notes.slice(0, 10)) console.log('  ' + n);
}

// 写平衡样本：正负各约一半，可直接喂 to-prm.mjs
const STEP_OUT = new URL('./steps-calibration.jsonl', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
if (calibSteps.length) {
  fs.writeFileSync(STEP_OUT, calibSteps.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  const pos = calibSteps.filter((r) => r.reward === 1).length;
  const neg = calibSteps.filter((r) => r.reward === -1).length;
  console.log('\n平衡样本已写出：' + STEP_OUT);
  console.log('  reward +1 = ' + pos + '   -1 = ' + neg + '   合计 ' + calibSteps.length);
}

if (state && state.tmp) { try { fs.rmSync(state.tmp, { recursive: true, force: true }); } catch { /* ignore */ } }
process.exit(0);
