// tools/gate.mjs —— 部署前的一道总门（编排器，不合并功能）
//
// 设计：只串现成的东西，不重写。
//   [1] 逻辑门   tools/lab.mjs        宿主契约模拟 + 畸形历史
//   [2] 回归门   tools/ci.mjs         全量测试
//   [3] 同步门   buildId  src vs profile
//
// 用法：
//   node tools/gate.mjs            # 全跑
//   node tools/gate.mjs --fast     # 跳过 CI（只跑逻辑 + 同步）
//
// 退出码非 0 = 不许部署。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '..');
const fast = process.argv.includes('--fast');

const rows = [];

function run(label, cmd, args, opts = {}) {
  process.stdout.write(`\n[${label}] ${cmd} ${args.join(' ')}\n`);
  const r = spawnSync(cmd, args, { cwd: src, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  const ok = r.status === 0;
  rows.push({ label, ok, code: r.status });
  return ok;
}

// [1] 逻辑门：宿主契约模拟
const logicOk = run('1/3 逻辑门', 'node', ['tools/lab.mjs']);

// [2] 回归门：全量 CI
let ciOk = true;
if (!fast) ciOk = run('2/3 回归门', 'node', ['tools/ci.mjs']);
else rows.push({ label: '2/3 回归门', ok: null, code: null });

// [3] 同步门：源码 buildId 是否已同步到 profile
let syncOk = true;
try {
  const { computeBuildId } = await import(pathToFileURL(path.join(src, 'lib', 'build-id.js')).href);
  const srcBuild = computeBuildId();
  const profileDir = path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'profiles', 'web', 'node_modules', 'claim-verify-wsc');
  let dstBuild = null;
  if (fs.existsSync(profileDir)) {
    const mod = await import(pathToFileURL(path.join(profileDir, 'lib', 'build-id.js')).href);
    dstBuild = mod.computeBuildId();
  }
  syncOk = dstBuild !== null && dstBuild === srcBuild;
  rows.push({ label: '3/3 同步门', ok: syncOk, code: srcBuild === dstBuild ? 0 : 1 });
  console.log(`\n[3/3 同步门] src=${srcBuild}  profile=${dstBuild ?? '(未安装)'}`);
} catch (e) {
  syncOk = false;
  rows.push({ label: '3/3 同步门', ok: false, code: 1 });
  console.log(`\n[3/3 同步门] 计算失败：${e.message}`);
}

// 汇总
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
console.log('\n' + '='.repeat(56));
console.log(pad('门', 18) + pad('结果', 10) + '退出码');
console.log('-'.repeat(56));
for (const r of rows) {
  const label = r.ok === null ? '跳过' : r.ok ? 'PASS' : 'FAIL';
  console.log(pad(r.label, 18) + pad(label, 12) + (r.code ?? '-'));
}
console.log('='.repeat(56));

const failed = rows.filter((r) => r.ok === false);
if (failed.length) {
  console.log(`\n[x] ${failed.map((r) => r.label).join(' / ')} 没过，不许部署`);
  process.exit(1);
}
console.log('\n[ok] 全过，可以 deploy');
