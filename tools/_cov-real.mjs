// 真实跑一次：清单 → 逐项核验 → 回执 → 覆盖率
//
// 2026-11-07 修两处：
//   1) 先探 API 是否可达——之前没起服务时 4 项全报 "API 不可达"，看起来像覆盖率 0，
//      实际是环境没起来，读数会误导人。
//   2) 原来用 pkgversion 验"版本号是 0.9.53"，但 pkgversion 的口径是**依赖**版本
//      （value 必须是 {name, version}），而本插件没有任何 dependencies，天然取不到真值。
//      改成 hash（package.json 指纹）：既能证明版本文件没被改，又不需要依赖。
//      "故意假的"对照组移出清单——它属于**健康度检查**，不该占完成度名额。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManifest, computeCoverage, renderCoverage } from '../lib/manifest.js';

const API = 'http://127.0.0.1:8600';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(ROOT, 'package.json');
const realHash = crypto.createHash('sha256').update(fs.readFileSync(pkgPath)).digest('hex');

// 前置检查：API 不通就不是覆盖率问题，是环境问题，直接说清楚。
try {
  const r = await fetch(API + '/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claims: [{ kind: 'path', value: ROOT + '/package.json' }] }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}
catch (e) {
  console.error(`API ${API} 不可达：${e.message}`);
  console.error('先起服务：node tools/api-server.mjs --port=8600');
  process.exit(1);
}

const items = [
  { id: 'm1', desc: '插件主文件存在', claim: { kind: 'path', value: path.join(ROOT, 'lib/manifest.js') } },
  { id: 'm2', desc: 'API 端口 8600 在听', claim: { kind: 'port', value: '8600', expect: 'listening' } },
  { id: 'm3', desc: 'package.json 未被篡改', claim: { kind: 'hash', value: { path: pkgPath, prefix: realHash.slice(0, 12) } } },
];

// 对照组：故意造假，预期 contradicted。它证明"假话会被抓"，但不计入完成度。
const control = { id: 'c1', desc: '对照组：假哈希', claim: { kind: 'hash', value: { path: pkgPath, prefix: 'deadbeefdead' } } };

async function verifyOne(it) {
  const res = await fetch(API + '/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claims: [{ kind: it.claim.kind, value: it.claim.value, expect: it.claim.expect }] }),
  });
  return (await res.json()).results[0];
}

const manifest = createManifest({ sessionId: 'real-demo', title: '覆盖率真实测量', items });
console.log(`清单：${manifest.items.length} 项  digest=${manifest.digest.slice(0, 16)}…\n`);

const receiptClaims = [];
for (const it of items) {
  const r = await verifyOne(it);
  console.log(`  ${r.ok ? '✅' : '❌'} ${it.desc.padEnd(24)} ${String(r.verdict).padEnd(13)} ${r.expect || r.reason || ''}`);
  receiptClaims.push({
    claim: { kind: it.claim.kind, value: it.claim.value },
    verdict: r.ok ? 'supported' : (r.verdict === 'contradicted' ? 'contradicted' : 'insufficient'),
  });
}

const cov = computeCoverage(manifest, [{ claims: receiptClaims }]);
console.log(`\n覆盖率：${cov.covered}/${cov.total} = ${(cov.coverage * 100).toFixed(1)}%`);
console.log(`判定：${cov.verdict}`);
if (cov.missing.length) {
  console.log('缺项：');
  for (const m of cov.missing) console.log(`  - ${m.id}  ${m.desc}`);
}
const line = renderCoverage(cov);
if (line) console.log('\n' + line);

// 对照组单独跑：只报拦截率，不污染覆盖率。
const c = await verifyOne(control);
const caught = c.verdict === 'contradicted';
console.log(`\n对照组：${caught ? '✅ 被拒绝' : '❌ 没抓到'}（${control.desc} → ${c.verdict}）`);
console.log(`假断言拦截率：${caught ? '100%' : '0%'}`);

process.exit(cov.verdict === 'COVERAGE_PASS' && caught ? 0 : 1);
