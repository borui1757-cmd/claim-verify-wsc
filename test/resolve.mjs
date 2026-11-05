// resolve.mjs —— 证明 profile 侧 junction 能解析到插件（DSH Loader 就是这么找包的）。
// 这个测试是本机专属的：拿不到 profile 路径时打印 SKIP 并退出 0（CI 上本来就没有 profile）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const cands = [
  path.join(home, 'profiles', 'web', 'node_modules', 'claim-verify-wsc', 'lib', 'index.js'),
  path.join(home, 'profiles', 'desktop', 'node_modules', 'claim-verify-wsc', 'lib', 'index.js'),
];

const hit = cands.find((p) => fs.existsSync(p));
if (!hit) {
  console.log('SKIP  没找到 profile 侧 junction（非 DSH 环境）');
  process.exit(0);
}

const m = await import(pathToFileURL(hit).href);
const ok = m.name === 'claim-verify-wsc' && typeof m.apply === 'function' && typeof m.Config === 'function';
console.log(`${ok ? 'PASS' : 'FAIL'}  ${m.name} v${m.VERSION} apply=${typeof m.apply} Config=${typeof m.Config}`);
process.exit(ok ? 0 : 1);
