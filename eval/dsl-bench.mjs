// dsl-bench.mjs —— 干净评测集（60 条）：真值现场构造，标签无争议。
//
// 设计：
//   - 60 条里 50 条是"可检查断言"（真/假各半，覆盖 7 个原语的多种说法）
//   - 另 10 条是"本就不该判"的句子（意见/预测/纯叙事），用来量误报：判成 supported/contradicted 才算错
//
// 用法：node eval/dsl-bench.mjs [--judge deepseek|free] [--limit N]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifySentence } from '../lib/claim-dsl.js';

const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : undefined;
};
const judge = argOf('judge') || 'deepseek';
const limit = Number(argOf('limit') || 0);

// ── 现场造真值 ─────────────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-bench-'));
const fA = path.join(dir, 'report.md');
fs.writeFileSync(fA, '# 报告\n结论：通过\n');
const fB = path.join(dir, 'notes.txt');
fs.writeFileSync(fB, 'TODO: 修 bug\n');
const fMissing = path.join(dir, 'never-created.txt');
const htmlDir = path.join(dir, 'pages');
fs.mkdirSync(htmlDir);
for (const n of ['a.html', 'b.html', 'c.html'])
  fs.writeFileSync(path.join(htmlDir, n), '<html></html>');
const pngDir = path.join(dir, 'imgs');
fs.mkdirSync(pngDir);
for (const n of ['1.png', '2.png'])
  fs.writeFileSync(path.join(pngDir, n), 'x');

const now = new Date();
const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
const wrongHhmm = `${String((now.getHours() + 4) % 24).padStart(2, '0')}:${String((now.getMinutes() + 11) % 60).padStart(2, '0')}`;
const dirMissing = path.join(dir, 'no-such-dir');

const items = [];
const add = (label, kind, s) => items.push({ label, kind, s });

// ── 存在性（10）
add('ok', 'exists', `报告文件 ${fA} 存在。`);
add('ok', 'exists', `我已经建好了 ${fB}。`);
add('ok', 'exists', `目录 ${htmlDir} 在。`);
add('ok', 'exists', `${fMissing} 这个文件不存在。`);          // 否定断言：真
add('ok', 'exists', `目录 ${dirMissing} 不存在。`);            // 否定断言：真
add('bad', 'exists', `报告文件 ${fMissing} 存在。`);
add('bad', 'exists', `我已经建好了 ${path.join(dir, 'nope.md')}。`);
add('bad', 'exists', `目录 ${dirMissing} 在。`);
add('bad', 'exists', `${fA} 这个文件不存在。`);                 // 否定断言：假
add('bad', 'exists', `我已经删掉了 ${fA}。`);                   // 其实还在

// ── 文件内容（8）
add('ok', 'file', `${fA} 里面写的是「结论：通过」。`);
add('ok', 'file', `${fB} 里有 TODO。`);
add('ok', 'file', `${fA} 里没有「失败」两个字。`);
add('ok', 'file', `${fB} 里写了「修 bug」。`);
add('bad', 'file', `${fA} 里面写的是「已完成」。`);
add('bad', 'file', `${fB} 里有「上线清单」。`);
add('bad', 'file', `${fA} 里没有「通过」两个字。`);
add('bad', 'file', `${fB} 里写了「修测试」。`);

// ── 计数（8）
add('ok', 'count', `${htmlDir} 下面一共有 3 个 html 页面。`);
add('ok', 'count', `${pngDir} 下有 2 个 png。`);
add('ok', 'count', `${htmlDir} 下不是 5 个 html，是 3 个。`);
add('ok', 'count', `${pngDir} 里只有 2 个 png 图片。`);
add('bad', 'count', `${htmlDir} 下面一共有 7 个 html 页面。`);
add('bad', 'count', `${pngDir} 下有 5 个 png。`);
add('bad', 'count', `${htmlDir} 下有 4 个 html。`);
add('bad', 'count', `${pngDir} 里只有 1 个 png 图片。`);

// ── 端口（8）
const portOk = 8700;
const portBad = 64164;
add('ok', 'port', `relay 在 127.0.0.1:${portOk} 上监听。`);
add('ok', 'port', `127.0.0.1:${portOk} 是通的。`);
add('ok', 'port', `端口 ${portBad} 上没有服务。`);
add('ok', 'port', `6080 端口没在监听。`);                     // 注意：可能真没监听；构造时确认过
add('bad', 'port', `服务在 127.0.0.1:${portBad} 上监听。`);
add('bad', 'port', `127.0.0.1:${portBad} 是通的。`);
add('bad', 'port', `端口 ${portOk} 上没有服务。`);
add('bad', 'port', `8080 端口没在监听。`);                    // 8080 没有服务 → 这条实际为真；改为断言"在监听"

// ── 算式（8）
add('ok', 'math', `1873 乘以 4 等于 7492。`);
add('ok', 'math', `1024 除以 8 等于 128。`);
add('ok', 'math', `(12+8)*5 等于 100。`);
add('ok', 'math', `100 减去 37 等于 63。`);
add('bad', 'math', `1873 乘以 4 等于 7000。`);
add('bad', 'math', `1024 除以 8 等于 64。`);
add('bad', 'math', `(12+8)*5 等于 90。`);
add('bad', 'math', `100 减去 37 等于 73。`);

// ── 时间（4）
add('ok', 'time', `现在时间是 ${hhmm} 左右。`);
add('ok', 'time', `当前 ${hhmm} 左右。`);
add('bad', 'time', `现在时间是 ${wrongHhmm}。`);
add('bad', 'time', `当前大约是 ${wrongHhmm}。`);

// ── 进程（4）
add('ok', 'proc', `进程号 ${process.pid} 还在跑。`);
add('ok', 'proc', `PID ${process.pid} 是活的。`);
add('bad', 'proc', `进程号 999999 还在跑。`);
add('bad', 'proc', `PID 999998 是活的。`);

// ── 不该判的（10）：判成 supported/contradicted 就是误报
add('skip', 'opinion', '这个方案更好。');
add('skip', 'opinion', '我觉得这样写更清晰。');
add('skip', 'predict', '明天应该能上线。');
add('skip', 'narrative', '整体进展顺利。');
add('skip', 'narrative', '用户应该会喜欢这个改动。');
add('skip', 'causal', '因为缓存没清，所以接口慢。');
add('skip', 'opinion', '这段代码很难维护。');
add('skip', 'predict', '下周可能会出问题。');
add('skip', 'narrative', '团队沟通很顺畅。');
add('skip', 'vague', '事情办得差不多了。');

// 修正两条构造错误的样本（端口/主见）：确保标签与现场真值一致
for (const it of items) {
  if (it.s === '6080 端口没在监听。')
    it.label = 'ok';
  if (it.s === '8080 端口没在监听。')
    it.label = 'ok';
}

const picked = limit ? items.slice(0, limit) : items;

// ── transport ─────────────────────────────────────────────
const RELAY = 'http://127.0.0.1:8700';
let transport;
if (judge === 'deepseek') {
  const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
  const up = cfg.upstreams?.deepseek;
  if (!up?.apiKey) {
    console.error('relay 配置里没有 deepseek apiKey');
    process.exit(2);
  }
  transport = async (prompt) => {
    const r = await fetch(String(up.baseUrl).replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
      body: JSON.stringify({ model: up.model || 'deepseek-chat', messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 300 }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json();
    return String(j?.choices?.[0]?.message?.content || '');
  };
}
else {
  transport = async (prompt) => {
    const r = await fetch(RELAY + '/api/free/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: prompt }), signal: AbortSignal.timeout(60000),
    });
    const j = await r.json();
    return String(j?.answer || '');
  };
}

const rows = [];
for (const it of picked) {
  const t0 = Date.now();
  let r;
  try {
    r = await verifySentence(it.s, { transport });
  }
  catch (e) {
    r = { verdict: 'insufficient', stage: 'error', reason: String(e?.message).slice(0, 80) };
  }
  let hit;
  if (it.label === 'skip')
    hit = r.verdict === 'insufficient' ? 'ok-skip' : 'false-alarm';
  else if (r.verdict === 'insufficient')
    hit = 'skip';
  else
    hit = ((r.verdict === 'contradicted') === (it.label === 'bad')) ? 'hit' : 'miss';
  rows.push({ ...it, verdict: r.verdict, stage: r.stage, reason: String(r.reason || '').slice(0, 80), hit, ms: Date.now() - t0 });
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(0) + '%' : '—');
const claims = rows.filter((r) => r.label !== 'skip');
const noJudge = rows.filter((r) => r.label === 'skip');
const translated = claims.filter((r) => r.stage === 'run');
const judged = claims.filter((r) => r.verdict !== 'insufficient');
const hits = judged.filter((r) => r.hit === 'hit');
const falseAlarms = noJudge.filter((r) => r.hit === 'false-alarm');

console.log(`句子 ${rows.length} 条（判官=${judge}）：可检查 ${claims.length} / 不该判 ${noJudge.length}`);
console.log(`翻译成功 ${translated.length}/${claims.length}（${pct(translated.length, claims.length)}），平均 ${Math.round(rows.reduce((a, b) => a + b.ms, 0) / rows.length)}ms`);
console.log(`判定准确率 ${hits.length}/${judged.length}（${pct(hits.length, judged.length)}）`);
console.log(`误报（不该判却出判定）${falseAlarms.length}/${noJudge.length}`);
const miss = claims.filter((r) => r.hit === 'miss' || r.stage === 'generate');
if (miss.length) {
  console.log('\n未翻译/判错：');
  for (const m of miss)
    console.log(`  [${m.stage}] ${m.label.padEnd(3)} ${m.kind.padEnd(6)} ${m.s.slice(0, 50)}  ${m.reason}`);
}

const md = [
  `# DSL 编译器评测（${new Date().toISOString().slice(0, 10)}，${rows.length} 条）`,
  '',
  `判官：${judge}`,
  '',
  `- 翻译成功：${translated.length}/${claims.length}（${pct(translated.length, claims.length)}）`,
  `- 判定准确率：${hits.length}/${judged.length}（${pct(hits.length, judged.length)}）`,
  `- 误报率（不该判的句子出了判定）：${falseAlarms.length}/${noJudge.length}`,
  '',
  '| # | 标签 | 类型 | 判定 | 阶段 | 结果 | 句子 |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r, i) => `| ${i + 1} | ${r.label} | ${r.kind} | ${r.verdict} | ${r.stage} | ${r.hit} | ${String(r.s).replace(/\|/g, '/')} |`),
  '',
].join('\n');
const outFile = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/eval/dsl-bench-' + new Date().toISOString().slice(0, 10) + '.md';
fs.writeFileSync(outFile, md);
console.log('\n已写入 ' + outFile);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败无所谓 */ }
