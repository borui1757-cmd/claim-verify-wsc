// 第 2 步：按「维度 × 场景 × 表述」生成标定集，并**强制触发校验**。
// 依据 awesome-evals「synthetic test-data generation」：
//   ① 维度笛卡尔积 ② 逐条生成（不批量） ③ ground 在真实系统状态 ④ 跑一遍确认真的触发目标场景，不触发就丢弃。
//
// 输出：tools/calibration-set.jsonl（每行 {id, kind, truth, decoy, text}）
// 用法：node tools/gen-calibration.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { extractClaims } from '../lib/index.js';

const OUT = new URL('./calibration-set.jsonl', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

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
    return [...set].filter((p) => p > 1024);
  }
  catch {
    return [];
  }
}

// ── grounding：真实文件（三种大小）+ 真实端口 ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-gen-'));
const files = [
  { path: path.join(tmp, 'report-alpha.txt'), size: 64 },
  { path: path.join(tmp, 'config-beta.json'), size: 4096 },
  { path: path.join(tmp, 'data-gamma.csv'), size: 65536 },
].map((f) => {
  fs.writeFileSync(f.path, 'x'.repeat(f.size));
  return f;
});
const ghosts = ['delta-missing.md', 'epsilon-never.json', 'zeta-absent.log'].map((n) => path.join(tmp, n));

const alive = listeningPorts().slice(0, 3);
const dead = [];
for (let p = 59010; p < 59100 && dead.length < 3; p++) {
  if (!(await probePort(p))) dead.push(p);
}

const pick = (arr, i) => arr[i % arr.length];

// ── 维度：kind × scenario × phrasing ──
const rows = [];
const gen = (kind, truth, decoy, text) => rows.push({ kind, truth, decoy, text, difficulty: 'easy' });
const genHard = (kind, truth, decoy, text) => rows.push({ kind, truth, decoy, text, difficulty: 'hard' });

const phrasePlain = (t) => t;
const phrasePrefix = (t) => `顺便说一下，刚才那步做完了。${t}`;
const phraseParen = (t) => `${t}（本次核对结论）`;

const phrasings = [phrasePlain, phrasePrefix, phraseParen];

for (let i = 0; i < 3; i++) {
  const f = pick(files, i);
  const g = pick(ghosts, i);
  for (const ph of phrasings) {
    // 真：文件确实存在
    gen('path', true, false, ph(`配置文件写进了 \`${f.path}\`，共 ${f.size} 字节。`));
    // 真：文件确实不存在
    gen('path', true, false, ph(`这个路径不存在：\`${g}\`，我没创建过。`));
    // 假：声称写到了不存在的路径
    gen('path', false, false, ph(`报告已经写到 \`${g}\` 了，可以直接打开。`));
    // 假：说一个存在的文件不存在
    gen('path', false, false, ph(`这个路径不存在：\`${f.path}\`。`));
  }
  // 诱饵：引用块 / 历史叙述 / 示例 —— 都不该被抽成断言
  gen('path', null, true, `> **当时把文件写到了 \`${g}\`，后来删掉了。**`);
  gen('path', null, true, `举例如下：给假路径 \`${g}\` 做个演示。`);
  gen('path', null, true, `路径里那个 \`C:\\Users\\19156\\$p${i}\` 是变量，不是真路径。`);
}

for (let i = 0; i < 3; i++) {
  const a = pick(alive, i);
  const d = pick(dead, i);
  for (const ph of phrasings) {
    gen('port', true, false, ph(`服务现在在 127.0.0.1:${a} 上监听。`));
    gen('port', true, false, ph(`127.0.0.1:${d} 没有服务在监听，放心用。`));
    gen('port', false, false, ph(`服务现在在 127.0.0.1:${d} 上监听。`));
    gen('port', false, false, ph(`127.0.0.1:${a} 现在没有服务在监听。`));
  }
  gen('port', null, true, `> **当时启动了第二个实例（端口 ${d}），后来关掉了。**`);
  gen('port', null, true, `【实时核验】命令返回成功，但 127.0.0.1:${d} 不存在。`);
}

// 进程
gen('pid', true, false, `当前进程 PID ${process.pid} 正在运行。`);
gen('pid', false, false, `当前进程 PID 59999 正在运行。`);
gen('pid', null, true, '> **当时进程 PID 59999 还在，现在已经退了。**');

// 算式
for (const [a, b, c, truth] of [[12, 12, 144, true], [12, 12, 145, false], [37, 3, 111, true], [37, 3, 112, false]]) {
  gen('math', truth, false, `算式 ${a} 乘以 ${b} 等于 ${c}。`);
}

// ── 难负例（near-miss）：只差一点点 ──────────────────────────────────────
// 依据：Hard Negative Sample-Augmented DPO (arXiv 2512.19728)、
//      Contrastive Learning for Fact Checking (arXiv 2410.04657) ——
//      最小改动的近邻负例比"明显错"的负例更有训练价值，也更容易让验证器漏判。
for (let i = 0; i < 3; i++) {
  const f = pick(files, i);
  const nearSibling = f.path + '.bak';        // 兄弟文件：只差一个后缀，实际不存在
  // 假：声称写到了只差后缀的文件
  genHard('path', false, false, `报告已经写到 \`${nearSibling}\` 了，可以直接打开。`);
  // 真：确实不存在
  genHard('path', true, false, `这个路径不存在：\`${nearSibling}\`，我没有备份过。`);
  // 真：Windows 不区分大小写，大写形式其实存在 —— 判定必须认出来
  genHard('path', true, false, `配置文件写进了 \`${f.path.toUpperCase()}\`，共 ${f.size} 字节。`);
  // 假：把父目录说成"写入了文件"
  genHard('path', false, false, `报告已经写到 \`${path.dirname(f.path)}\` 这个文件里了。`);
}

for (let i = 0; i < 3; i++) {
  const a = pick(alive, i);
  const d = pick(dead, i);
  const neighbor = a + 1;                      // 相邻端口：最容易被误判成"在监听"
  if (!(await probePort(neighbor))) {
    genHard('port', false, false, `服务现在在 127.0.0.1:${neighbor} 上监听。`);
    genHard('port', true, false, `127.0.0.1:${neighbor} 没有服务在监听。`);
  }
  // 真：同一端口换个主机写法（localhost）
  genHard('port', true, false, `服务现在在 localhost:${a} 上监听。`);
}

// 难负例：算式只差 1
genHard('math', false, false, '算式 12 乘以 12 等于 143。');
genHard('math', true, false, '算式 12 乘以 12 等于 144。');

// ── 触发校验：真断言必须抽到同 kind；诱饵必须抽不到 ──
const kept = [];
const dropped = [];
for (const r of rows) {
  let got = [];
  try { got = extractClaims(r.text); } catch { got = []; }
  const sameKind = got.some((c) => c.kind === r.kind);
  const ok = r.decoy ? !sameKind : sameKind;
  if (ok) kept.push({ id: `cal-${String(kept.length + 1).padStart(3, '0')}`, ...r });
  else dropped.push({ reason: r.decoy ? '诱饵被误抽' : '该抽却没抽到', text: r.text });
}

fs.writeFileSync(OUT, kept.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
const counts = {};
for (const r of kept) counts[r.kind] = (counts[r.kind] || 0) + 1;
const truthCount = kept.filter((r) => r.decoy === false && r.truth).length;
const falseCount = kept.filter((r) => r.decoy === false && r.truth === false).length;
const decoyCount = kept.filter((r) => r.decoy).length;
const hardCount = kept.filter((r) => r.difficulty === 'hard').length;

console.log('生成候选 ' + rows.length + ' 条');
console.log('触发校验通过并写入 ' + kept.length + ' 条  →  ' + OUT);
console.log('  其中：陈述为真 ' + truthCount + ' | 陈述为假 ' + falseCount + ' | 诱饵(不该抽) ' + decoyCount + ' | 难负例 ' + hardCount);
console.log('  按类型：' + JSON.stringify(counts));
console.log('丢弃 ' + dropped.length + ' 条');
for (const d of dropped.slice(0, 6)) console.log('  丢弃[' + d.reason + '] ' + d.text.slice(0, 60));

// 保留临时文件（runner 要用它们做真值），并把清单写进 state 文件；runner 跑完负责清理。
const STATE = new URL('./calibration-state.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
fs.writeFileSync(STATE, JSON.stringify({ tmp, files, ghosts }, null, 2), 'utf8');
process.exit(0);
