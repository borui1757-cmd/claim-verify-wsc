// 召回审计：找出「看起来像断言、却什么都没抽出来」的句子。
//
// 动机：语料复测显示抽取密度只有 1.4 条/100 句，但不知道漏在哪。
// Precision Is Not Faithfulness (arXiv 2606.09376) 指出：只测精确率会奖励"什么都不说"，
// 必须测覆盖/召回。这里用"可断言词元"（路径/端口/数字+单位/服务名）当信号，
// 定位那些**含有可核验词元、但抽取器没产出任何断言**的句子。
//
// 用法：node tools/recall-audit.mjs [采样条数]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { extractClaims } from '../lib/index.js';
import { extractHostClaims } from '../lib/host.js';

const LIMIT = Number(process.argv[2] || 120);
const ROOT = 'C:/Users/19156/.dsh/sessions';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.zstd')) out.push(p);
  }
  return out;
}
function decompress(file) {
  const buf = fs.readFileSync(file); const parts = []; let start = 0;
  for (let i = 1; i < buf.length - 3; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) { parts.push(buf.subarray(start, i)); start = i; }
  }
  parts.push(buf.subarray(start));
  const out = [];
  for (const p of parts) { if (p.length < 8) continue; try { out.push(zlib.zstdDecompressSync(p)); } catch {} }
  return Buffer.concat(out).toString('utf8');
}

const texts = [];
for (const f of walk(ROOT)) {
  let raw = '';
  try { raw = decompress(f); } catch { continue; }
  for (const line of raw.split('\n')) {
    if (!line.includes('"assistant/message"')) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const t = e?.data?.message?.content ?? e?.message?.content ?? e?.content;
    let s = '';
    if (typeof t === 'string') s = t;
    else if (Array.isArray(t)) s = t.filter((x) => x && x.type === 'text').map((x) => x.text).join('\n');
    if (s && s.length > 80) texts.push(s);
  }
}
const step = Math.max(1, Math.floor(texts.length / LIMIT));
const sample = texts.filter((_, i) => i % step === 0).slice(0, LIMIT);

// 可核验词元的信号
const SIGNALS = [
  { name: '路径', re: /[A-Za-z]:\\[^\s`"'，。；）]+/ },
  { name: '端口', re: /127\.0\.0\.1:\d{2,5}|localhost:\d{2,5}/ },
  { name: '大小', re: /\d+(?:\.\d+)?\s*(字节|KB|MB|GB|TB)/i },
  { name: '行数', re: /(?:一共|共|总共|有)\s*\d+\s*行/ },
  { name: '哈希', re: /(?=[0-9a-f]*[a-f])(?<![:\w/.-])[0-9a-f]{8,64}(?![\w/.-])/i },
  { name: '计数', re: /(?:目录|文件夹)[^\n]{0,20}?(?:有|共|包含)\s*\d+\s*个/ },
  { name: '服务', re: /服务\s*`?[A-Za-z][\w.-]{1,60}`?\s*(正在运行|运行中|已停止|已停)/ },
];

let sentences = 0, claimed = 0, missed = 0;
const missedSamples = [];
const bySignal = {};

for (const text of sample) {
  for (const raw of text.split(/[。！？\n]+/)) {
    const s = raw.trim();
    if (s.length < 8) continue;
    // 引用块 / 表格 / 代码行本来就不该抽成断言（这是设计，不是漏抽）
    if (/^[>|]/.test(s)) continue;
    sentences += 1;
    let claims = [];
    try { claims = [...extractClaims(s), ...extractHostClaims(s)]; } catch { claims = []; }
    if (claims.length) { claimed += 1; continue; }
    const hit = SIGNALS.find((x) => x.re.test(s));
    if (!hit) continue;
    missed += 1;
    bySignal[hit.name] = (bySignal[hit.name] || 0) + 1;
    if (missedSamples.length < 30) missedSamples.push(`[${hit.name}] ${s.slice(0, 90)}`);
  }
}

const pct = (n, d) => (d ? (n / d * 100).toFixed(1) + '%' : 'n/a');
console.log('召回审计（' + sample.length + ' 条消息）\n');
console.log('句子数 ' + sentences);
console.log('有断言产出 ' + claimed + ' (' + pct(claimed, sentences) + ')');
console.log('含可核验词元但没抽出 ' + missed + ' (' + pct(missed, sentences) + ')');
console.log('按信号：' + JSON.stringify(bySignal));
if (missedSamples.length) {
  console.log('\n漏抽样例（前 30 条，用来发现缺哪些句式）：');
  for (const s of missedSamples) console.log('  ' + s);
}
process.exit(0);
