// 系统状态类断言的标定：依赖版本 / 服务状态 / 内存 / 磁盘
//
// 思路同 calibration-sideeffect：真值来自系统本身，不靠人工标注。
// 取不到真值的项直接跳过并记录（"绝不猜"原则）。
//
// 用法：node tools/calibration-host.mjs
import { execFileSync } from 'node:child_process';
import { extractHostClaims, verifyHostClaim, availableMem, diskFree, pkgVersion } from '../lib/host.js';

const cases = [];
const skipped = [];

// ── 依赖版本：挑一个本机确实装了的包 ──
const PKG = 'dsh-smart-compact';
const realVer = (() => {
  try { return pkgVersion(PKG); } catch { return null; }
})();
if (realVer) {
  cases.push({ kind: 'pkgversion', truth: true, text: `\`${PKG}\` 的版本是 ${realVer}` });
  cases.push({ kind: 'pkgversion', truth: false, text: `\`${PKG}\` 的版本是 99.99.99` });
} else {
  skipped.push(`pkgversion: pkgVersion('${PKG}') 取不到（不在可解析的 node_modules 根里）`);
}

// ── 服务状态：读真实状态再构造断言 ──
const SERVICE = 'Spooler';
let svcState = null;
try {
  const out = execFileSync('sc', ['query', SERVICE], { encoding: 'utf8' });
  svcState = /RUNNING/.test(out) ? 'RUNNING' : 'STOPPED';
} catch { svcState = null; }
if (svcState) {
  const runWord = svcState === 'RUNNING' ? '正在运行' : '已停止';
  const wrongWord = svcState === 'RUNNING' ? '已停止' : '正在运行';
  cases.push({ kind: 'service', truth: true, text: `服务 \`${SERVICE}\` ${runWord}` });
  cases.push({ kind: 'service', truth: false, text: `服务 \`${SERVICE}\` ${wrongWord}` });
} else {
  skipped.push(`service: 查不到 ${SERVICE} 的状态`);
}

// ── 内存：只构造"明显错"的断言（真实值有取整误差，不适合造"正确"断言） ──
const mem = availableMem();
if (mem !== null && mem !== undefined) {
  const absurd = mem > 64 * 1024 ** 3 ? 1 : 999; // 报一个不可能的值
  cases.push({ kind: 'mem', truth: false, text: `可用内存还剩 ${absurd} GB。` });
} else {
  skipped.push('mem: availableMem() 取不到');
}

// ── 磁盘：同上，只测"明显错" ──
const disk = diskFree('C:');
if (disk !== null && disk !== undefined) {
  cases.push({ kind: 'disk', truth: false, text: `C 盘剩余 99999 TB，够用。` });
} else {
  skipped.push('disk: diskFree("C:") 取不到');
}

let right = 0, wrong = 0, unknown = 0;
const notes = [];
for (const c of cases) {
  const claims = extractHostClaims(c.text).filter((x) => x.kind === c.kind);
  if (!claims.length) { notes.push(`未抽到 ${c.kind}: ${c.text.slice(0, 56)}`); wrong += 1; continue; }
  let res = null;
  try { res = await verifyHostClaim(claims[0], {}, { }); } catch { res = null; }
  if (res === null) { unknown += 1; notes.push(`真值取不到 ${c.kind}`); continue; }
  const ok = res.ok === c.truth;
  if (ok) right += 1; else { wrong += 1; notes.push(`判错 ${c.kind} truth=${c.truth} 实际ok=${res.ok} (${res.expect})`); }
}

const pct = (n, d) => (d ? (n / d * 100).toFixed(1) + '%' : 'n/a');
console.log('系统状态类标定（版本 / 服务 / 内存 / 磁盘）\n');
console.log('判定正确 ' + right + '/' + (right + wrong) + ' = ' + pct(right, right + wrong) + (unknown ? `   真值取不到 ${unknown} 项` : ''));
if (skipped.length) { console.log('\n跳过：'); for (const s of skipped) console.log('  ' + s); }
if (notes.length) { console.log('\n明细：'); for (const n of notes) console.log('  ' + n); }
process.exit(0);
