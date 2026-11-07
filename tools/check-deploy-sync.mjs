// check-deploy-sync.mjs —— 源码与部署副本是否同一个 build（不看宿主是否重启）。
// 退出码：0 一致 / 1 不一致（该跑 deploy.ps1）/ 2 算不出（路径或 build-id 缺失）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const DEP = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'claim-verify-wsc');

const idAt = (dir) => {
  try {
    if (!fs.existsSync(path.join(dir, 'lib', 'build-id.js')))
      return null;
    const out = execSync(`node --input-type=module -e "import { computeBuildId } from './lib/build-id.js'; console.log(computeBuildId());"`, {
      cwd: dir, encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    return String(out).trim().split(/\r?\n/).pop() || null;
  }
  catch { return null; }
};

const src = idAt(SRC);
const dep = fs.existsSync(DEP) ? idAt(DEP) : null;
const ok = Boolean(src) && Boolean(dep) && src === dep;
console.log(`${ok ? 'SYNC' : 'OUT-OF-SYNC'} src=${src || '?'} dep=${dep || '?'}`);
process.exit(!src || !dep ? 2 : (ok ? 0 : 1));
