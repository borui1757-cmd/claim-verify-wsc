// 变形测试（metamorphic testing）：对同一条断言做**保义变换**，判定必须不变。
// 依据：AUDIT (NeurIPS 2026) —— "如果一个保持语义不变的改动仍然让判定翻转，
// 那这个评判器按定义就不可靠"。这是唯一不需要制造错误、也不需要人工标注的可靠性测试。
//
// 用法：node tools/metamorphic.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { extractClaims, verifyClaims } from '../lib/index.js';

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-meta-'));
const realA = path.join(tmp, 'alpha-report.txt');
fs.writeFileSync(realA, 'x'.repeat(64));
const ghostA = path.join(tmp, 'gamma-not-created.txt');
const deadPort = 59000;

const base = [
  { kind: 'path', text: `配置文件写进了 \`${realA}\`，共 64 字节。` },
  { kind: 'path', text: `这个路径不存在：\`${ghostA}\`，我没创建过。` },
  { kind: 'port', text: `服务现在在 127.0.0.1:${deadPort} 上监听。` },
  { kind: 'port', text: `127.0.0.1:${deadPort} 没有服务在监听，放心用。` },
  { kind: 'path', text: `报告已经写到 \`${ghostA}\` 了。` },
  { kind: 'path', text: `生成的文件保存在 \`${realA}\`。` },
  { kind: 'port', text: `服务现在在 127.0.0.1:59001 上监听。` },
  { kind: 'pid', text: `当前进程 PID ${process.pid} 正在运行。` },
  { kind: 'math', text: `算式 12 乘以 12 等于 145。` },
];

// 保义变换：都不改变"这条断言说的是什么"
const transforms = [
  { name: '加粗', fn: (t) => '**' + t + '**' },
  { name: '加无关前置句', fn: (t) => '顺便说一下，今天北京是晴天。' + t },
  { name: '换引号样式', fn: (t) => t.replace(/`/g, '"') },
  { name: '加尾注', fn: (t) => t + '（以上是本次核对的结论。）' },
  // 注意：不能无脑替换所有冒号 —— `C:` 换成全角 `C：` 就不是合法 Windows 路径了，
  // 那是**改变了语义**的变换，不该算保义。只换 host:port 那种冒号（前面不是单个字母）。
  { name: '全角冒号', fn: (t) => t.replace(/(?<![A-Za-z]):/g, '：') },
  { name: '时态词替换', fn: (t) => t.replace(/现在/g, '当前') },
];

const keyOf = (kind, value) => kind + '|' + JSON.stringify(typeof value === 'string' ? value.trim() : value);

async function verdictOf(text, kind) {
  const claims = extractClaims(text);
  const mine = claims.filter((x) => x.kind === kind);
  if (mine.length === 0)
    return { state: 'missing' };
  const res = await verifyClaims(claims, 'metamorphic', CFG, { probePort });
  const flagged = new Set((res.bad || []).map((b) => keyOf(b.claim.kind, b.claim.value)));
  const hit = mine.some((x) => flagged.has(keyOf(x.kind, x.value)));
  return { state: hit ? 'bad' : 'ok' };
}

let total = 0, flipped = 0, missing = 0;
const detail = [];
for (const c of base) {
  const baseline = await verdictOf(c.text, c.kind);
  for (const tr of transforms) {
    const text = tr.fn(c.text);
    const v = await verdictOf(text, c.kind);
    total += 1;
    if (v.state === 'missing') { missing += 1; detail.push(`  未抽到  [${tr.name}] ${text.slice(0, 60)}`); continue; }
    if (v.state !== baseline.state) {
      flipped += 1;
      detail.push(`  翻转    [${tr.name}] 基准=${baseline.state} 变体=${v.state}  ${text.slice(0, 60)}`);
    }
  }
}

const pct = (n, d) => (d ? (n / d * 100).toFixed(1) + '%' : 'n/a');
console.log('变形测试：' + base.length + ' 条基准断言 × ' + transforms.length + ' 种保义变换 = ' + total + ' 个变体\n');
if (detail.length) { console.log('问题明细：'); for (const d of detail) console.log(d); console.log(''); }
console.log('判定翻转（同一断言，换个写法结论就变了）: ' + flipped + '/' + total + ' = ' + pct(flipped, total));
console.log('变体未抽到（召回不稳）: ' + missing + '/' + total + ' = ' + pct(missing, total));
console.log('变形一致性（判定不变且都抽到）: ' + (total - flipped - missing) + '/' + total + ' = ' + pct(total - flipped - missing, total));

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
process.exit(0);
