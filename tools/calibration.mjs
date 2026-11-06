// 标定集：用**客观已知真假**的断言测验证器，算出 ρ₀（假阳性率）与 ρ₁（假阴性率）。
//
// 为什么这样算：文献（arXiv 2510.00915）把验证器当带噪奖励信道，
// 训练时需要的是这两个数字，而不是"精度 99%"。
//
// 用法：node tools/calibration.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { extractClaims, verifyClaims } from '../lib/index.js';

const CFG = { portTimeoutMs: 600, moneyTolerance: 0.15 };
const KIND_ORDER = ['path', 'port', 'pid', 'math'];

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

function listeningPorts() {
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    const set = new Set();
    for (const line of out.split('\n')) {
      if (!/LISTENING/.test(line)) continue;
      const m = /:(\d{2,5})\s+\S+\s+LISTENING/.exec(line);
      if (m) set.add(Number(m[1]));
    }
    return [...set];
  }
  catch {
    return [];
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-calib-'));
const realA = path.join(tmp, 'alpha-report.txt');
const realB = path.join(tmp, 'beta-config.json');
fs.writeFileSync(realA, 'x'.repeat(64));
fs.writeFileSync(realB, '{"ok":true}');
const ghostA = path.join(tmp, 'gamma-not-created.txt');
const ghostB = path.join(tmp, 'delta-never.md');

const listen = listeningPorts();
const alivePort = listen.find((p) => p > 1024) ?? 3080;
const deadPort = await (async () => {
  for (let p = 59000; p < 59100; p++) if (!(await probePort(p))) return p;
  return 59999;
})();

/** 每条：自然句子 + 该断言在客观世界里的真假（true = 我说的是对的） */
const cases = [
  // ── 路径 ──
  { kind: 'path', truth: true, text: `配置文件写进了 \`${realA}\`，共 64 字节。` },
  { kind: 'path', truth: true, text: `配置写进了 \`${realB}\`。` },
  { kind: 'path', truth: true, text: `这个路径不存在：\`${ghostA}\`，我没创建过。` },
  { kind: 'path', truth: true, text: `报告已经写到 \`${realB}\` 了，可以直接打开。` },
  { kind: 'path', truth: true, text: `生成的文件保存在 \`${realA}\`。` },
  { kind: 'path', truth: false, text: `报告已经写到 \`${ghostB}\` 了，可以直接打开。` },
  { kind: 'path', truth: false, text: `报告已经写到 \`${ghostB}\` 了，可以直接打开。` },
  { kind: 'path', truth: false, text: `这个路径不存在：\`${realA}\`，需要先创建。` },
  // ── 端口 ──
  { kind: 'port', truth: true, text: `服务现在在 127.0.0.1:${alivePort} 上监听。` },
  { kind: 'port', truth: true, text: `127.0.0.1:${deadPort} 没有服务在监听，放心用。` },
  { kind: 'port', truth: false, text: `服务现在在 127.0.0.1:${deadPort} 上监听。` },
  { kind: 'port', truth: false, text: `127.0.0.1:${alivePort} 现在没有服务在监听。` },
  // ── 进程 ──
  { kind: 'pid', truth: true, text: `当前进程 PID ${process.pid} 正在运行。` },
  { kind: 'pid', truth: false, text: `当前进程 PID 59999 正在运行。` },
  // ── 算式（纯可判定，无环境依赖）──
  { kind: 'math', truth: true, text: `算式 12 乘以 12 等于 144。` },
  { kind: 'math', truth: false, text: `算式 12 乘以 12 等于 145。` },
  // ── 诱饵：看起来像断言、但不该被抽取（误抽率）──
  { decoy: true, kind: 'path', truth: null, text: `> **当时把文件写到了 \`${ghostB}\`，后来删了。**` },
  { decoy: true, kind: 'path', truth: null, text: `路径里那个 \`C:\\Users\\19156\\$p1\` 是变量，不是路径。` },
  { decoy: true, kind: 'path', truth: null, text: `示例：给假路径 \`${ghostA}\` 做个演示。` },
  { decoy: true, kind: 'path', truth: null, text: `这个路径不存在：\`C:\\tmp\\__no_such_file__.md\`` },
  { decoy: true, kind: 'port', truth: null, text: `【实时核验】命令返回成功，但 127.0.0.1:59000 不存在。` },
  { decoy: true, kind: 'port', truth: null, text: `> **当时启动了第二个实例（端口 59000），后来关掉了。**` },
];

const keyOf = (kind, value) => kind + '|' + JSON.stringify(value);
const norm = (v) => (typeof v === 'string' ? v.trim() : v);

const rows = [];
for (const c of cases) {
  const claims = extractClaims(c.text);
  const mine = claims.filter((x) => x.kind === c.kind);
  if (c.decoy) {
    // 诱饵句：抽出来就是误抽（ρ₀ 的另一种来源——不是判错，是不该判）
    rows.push({ ...c, extracted: mine.length > 0, verdict: mine.length > 0 ? 'bad' : 'ok', decoyGot: mine.length > 0 });
    continue;
  }
  if (mine.length === 0) {
    rows.push({ ...c, extracted: false, verdict: null });
    continue;
  }
  const res = await verifyClaims(claims, 'calibration', CFG, { probePort });
  const flagged = new Set((res.bad || []).map((b) => keyOf(b.claim.kind, norm(b.claim.value))));
  const hit = mine.some((x) => flagged.has(keyOf(x.kind, norm(x.value))));
  rows.push({ ...c, extracted: true, verdict: hit ? 'bad' : 'ok', value: mine[0].value });
}

// 四格：truth=我说得对；verdict=验证器是否判"不一致"
let TP = 0, TN = 0, FP = 0, FN = 0, missed = 0, decoy = 0, decoyHit = 0;
console.log('类型  真值  验证器   句子');
for (const r of rows) {
  if (r.decoy) {
    decoy += 1;
    if (r.decoyGot) decoyHit += 1;
    console.log(`${r.kind.padEnd(5)} ${'诱饵'.padEnd(4)} ${(r.decoyGot ? '误抽 ✗' : '放过 ✓').padEnd(9)} ${r.text.slice(0, 52)}`);
    continue;
  }
  let mark;
  if (!r.extracted) { missed += 1; mark = '未抽取'; }
  else if (r.truth && r.verdict === 'ok') { TN += 1; mark = '一致(对)'; }
  else if (r.truth && r.verdict === 'bad') { FP += 1; mark = '判错 ✗'; }
  else if (!r.truth && r.verdict === 'bad') { TP += 1; mark = '抓对 ✓'; }
  else { FN += 1; mark = '漏放 ✗'; }
  console.log(`${r.kind.padEnd(5)} ${(r.truth ? '对' : '错').padEnd(4)} ${mark.padEnd(9)} ${r.text.slice(0, 52)}`);
}

const pct = (n, d) => (d ? (n / d * 100).toFixed(1) + '%' : 'n/a');
console.log('\n四格：TP=' + TP + '  TN=' + TN + '  FP=' + FP + '  FN=' + FN + '  未抽取=' + missed);
console.log('ρ₀ 假阳性率 FP/(FP+TN) = ' + FP + '/' + (FP + TN) + ' = ' + pct(FP, FP + TN) + '   （把对的判成错）');
console.log('ρ₁ 假阴性率 FN/(FN+TP) = ' + FN + '/' + (FN + TP) + ' = ' + pct(FN, FN + TP) + '   （把错的判成对）');
const real = rows.length - decoy;
console.log('抽取召回 ' + (real - missed) + '/' + real + ' = ' + pct(real - missed, real));
console.log('诱饵误抽 ' + decoyHit + '/' + decoy + ' = ' + pct(decoyHit, decoy) + '   （不该抽的抽出来了）');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
process.exit(0);
