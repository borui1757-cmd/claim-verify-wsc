// 副作用类断言的标定：行数 / 大小 / 哈希
//
// 依据 Finding Side-Effect Loopholes (arXiv 2610.09142)：
// 验证器最大的漏洞不是"没做对"，而是"**多做了却没被发现**"。
// 所以这里除了测"判得对不对"，还专门测"**改写文件后能不能发现**"（mutation sensitivity）。
//
// 用法：node tools/calibration-sideeffect.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { extractHostClaims, verifyHostClaim } from '../lib/host.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-side-'));
const file = path.join(tmp, 'payload.txt');
const LINE = '0123456789\n'; // 11 字节
const LINES = 10;
fs.writeFileSync(file, LINE.repeat(LINES));
const bytes = fs.statSync(file).size;
const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const prefix = sha.slice(0, 8);

const cases = [
  { kind: 'lines', truth: true, text: `文件 \`${file}\` 一共 ${LINES} 行。` },
  { kind: 'lines', truth: false, text: `文件 \`${file}\` 一共 99 行。` },
  { kind: 'size', truth: true, text: `文件 \`${file}\` 大小 ${bytes} 字节。` },
  { kind: 'size', truth: false, text: `文件 \`${file}\` 大小 5 MB。` },
  { kind: 'hash', truth: true, text: `文件 \`${file}\` 的 sha256 是 ${prefix}` },
  { kind: 'hash', truth: false, text: `文件 \`${file}\` 的 sha256 是 deadbeef` },
];

let right = 0, wrong = 0;
const keep = []; // 记住"判对了且断言为真"的 claim，供变异测试复用
const notes = [];

for (const c of cases) {
  const claims = extractHostClaims(c.text).filter((x) => x.kind === c.kind);
  if (!claims.length) { notes.push(`未抽到 ${c.kind}: ${c.text.slice(0, 50)}`); wrong += 1; continue; }
  const res = await verifyHostClaim(claims[0], {});
  if (res === null) { notes.push(`真值取不到 ${c.kind}`); continue; }
  const ok = res.ok === c.truth; // 断言为真时应当 ok，为假时应当 not ok
  if (ok) right += 1; else { wrong += 1; notes.push(`判错 ${c.kind} truth=${c.truth} 实际ok=${res.ok} (${res.expect})`); }
  if (c.truth && res.ok) keep.push({ kind: c.kind, claim: claims[0], text: c.text });
}

// ── 变异测试：改写文件（追加 10 字节）后，原先"正确"的断言必须被发现不再成立 ──
fs.appendFileSync(file, 'X'.repeat(10));
let caught = 0, missedMut = 0;
for (const k of keep) {
  const res = await verifyHostClaim(k.claim, {});
  if (res === null) continue;
  if (!res.ok) caught += 1;
  else { missedMut += 1; notes.push(`变异未发现 ${k.kind}: ${k.text.slice(0, 50)}`); }
}

const pct = (n, d) => (d ? (n / d * 100).toFixed(1) + '%' : 'n/a');
console.log('副作用类标定（行数 / 大小 / 哈希）\n');
console.log('判定正确 ' + right + '/' + (right + wrong) + ' = ' + pct(right, right + wrong));
console.log('变异捕获 ' + caught + '/' + keep.length + ' = ' + pct(caught, keep.length) + '   （追加 10 字节后能否发现）');
if (notes.length) { console.log('\n明细：'); for (const n of notes) console.log('  ' + n); }

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
