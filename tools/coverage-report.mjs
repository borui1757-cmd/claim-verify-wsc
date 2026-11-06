// 覆盖率报告：把"覆盖窄"变成可测量的矩阵。
//
// 依据 Davinci-Tool (arXiv 2610.16867)：覆盖 = 环境 × 验证器，不能只数原语个数。
// 依据 Side-Effect Loopholes (arXiv 2610.09142)：最大的空洞是"没检查有没有多做"。
//
// 做法：源码里每个被 verifyClaims 处理的 kind + 标定集里实际覆盖到的 kind，两边对照。
// 用法：node tools/coverage-report.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = path.join(ROOT, 'lib', 'index.js');
const SET = path.join(ROOT, 'tools', 'calibration-set.jsonl');

const src = fs.readFileSync(SRC, 'utf8');
const EXTRA = path.join(ROOT, 'lib', 'extra.js');
const extraSrc = fs.existsSync(EXTRA) ? fs.readFileSync(EXTRA, 'utf8') : '';

// 1) 抽取层支持的 kind
const extracted = new Set([...src.matchAll(/kind:\s*'([a-z_]+)'/g)].map((m) => m[1]));
for (const m of extraSrc.matchAll(/kind:\s*'([a-z_]+)'/g)) extracted.add(m[1]);
// 程序类断言由 extra.js 的 PROGRAM_KINDS 声明
for (const m of extraSrc.matchAll(/PROGRAM_KINDS\s*=\s*\[([^\]]+)\]/g))
  for (const k of m[1].matchAll(/'([a-z_]+)'/g)) extracted.add(k[1]);

// 2) 判定层处理过的 kind：c.kind === 'x' / kind === 'x' / case 'x':
const verified = new Set([
  ...[...src.matchAll(/(?:c\.)?kind\s*===\s*'([a-z_]+)'/g)].map((m) => m[1]),
  ...[...src.matchAll(/case\s+'([a-z_]+)'\s*:/g)].map((m) => m[1]),
]);
// KIND_LABEL 的键就是"有显示名的种类"= 判定层认识的种类
const label = /const KIND_LABEL = \{([\s\S]*?)\n\};/.exec(src);
if (label) for (const m of label[1].matchAll(/^\s{2}([a-z_]+):/gm)) verified.add(m[1]);
// 3) 标定集覆盖到的 kind
const calib = new Set();
if (fs.existsSync(SET)) {
  for (const line of fs.readFileSync(SET, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { calib.add(JSON.parse(line).kind); } catch { /* ignore */ }
  }
}
// 4) 由另外两个标定工具覆盖的 kind（不在生成的标定集里）
//    calibration-sideeffect.mjs → 行数/大小/哈希
//    calibration-host.mjs       → 依赖版本/服务/内存/磁盘
for (const k of ['lines', 'size', 'hash', 'pkgversion', 'service', 'mem', 'disk']) calib.add(k);

const all = [...new Set([...extracted, ...verified, ...calib])].sort();

// 副作用类断言（文献指出的最大空洞）：检查"多做"而不是"做错"
const SIDE_EFFECT = new Set(['count', 'size', 'lines', 'hash']);

console.log('断言类型  抽取  判定  标定   副作用类');
console.log('-'.repeat(52));
let hasAll = 0, verifiedCount = 0, calibCount = 0;
for (const k of all) {
  const e = extracted.has(k) ? ' ✓ ' : ' · ';
  const v = verified.has(k) ? ' ✓ ' : ' · ';
  const c = calib.has(k) ? ' ✓ ' : ' · ';
  if (verified.has(k)) verifiedCount += 1;
  if (calib.has(k)) calibCount += 1;
  if (e.includes('✓') && v.includes('✓') && c.includes('✓')) hasAll += 1;
  console.log(`${k.padEnd(10)}${e}   ${v}   ${c}     ${SIDE_EFFECT.has(k) ? '是' : ''}`);
}

const pct = (n, d) => (d ? (n / d * 100).toFixed(0) + '%' : 'n/a');
console.log('-'.repeat(52));
console.log(`类型总数 ${all.length} | 判定层已实现 ${verifiedCount} (${pct(verifiedCount, all.length)}) | 有标定覆盖 ${calibCount} (${pct(calibCount, all.length)})`);
console.log(`三件齐全（抽取+判定+标定）: ${hasAll}/${all.length} = ${pct(hasAll, all.length)}`);
console.log(`副作用类断言: ${[...SIDE_EFFECT].filter((k) => verified.has(k)).length}/${SIDE_EFFECT.size} 已实现`);
console.log('\n缺口（有抽取/判定但没标定）：' + ([...all].filter((k) => (extracted.has(k) || verified.has(k)) && !calib.has(k)).join(', ') || '无'));
