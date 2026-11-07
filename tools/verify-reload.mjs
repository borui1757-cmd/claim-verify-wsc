// verify-reload.mjs —— "重启后到底生效了没有"的确定性判据（零模型、零依赖）。
//
// 为什么要有它：2026-11-07 反复出现「改了、部署了、以为生效了，其实宿主还跑旧 build」。
// 部署脚本的自我检查说 WARN，人眼扫 logs 不靠谱 —— 于是把这件事做成一条可执行判据，
// 交给机器狗（free-agent）用 `cmd_exit_0` / `run_cmd` 去跑，退出码就是结论。
//
// 判定依据（三份真值互相比对）：
//   src  = plugins\dsh-claim-verify\lib        （源码 buildId）
//   dep  = profiles\web\node_modules\claim-verify-wsc\lib （部署副本 buildId）
//   host = loads.jsonl 里与 3080 监听 pid 对应的那条记录的 buildId（宿主实际加载的）
//
// 退出码（机器可判）：
//   0 READY      —— host == src == dep，新代码真的在跑
//   1 STALE      —— host != src，**需要重启宿主**
//   2 UNKNOWN    —— 端口没监听 / 没有该 pid 的加载记录（无法判定，不要当成通过）
//   3 DEPLOY-OLD —— src != dep，源码改了但没同步（先跑 tools\deploy.ps1）
//
// 用法：
//   node tools\verify-reload.mjs            # 人读
//   node tools\verify-reload.mjs --json     # 一行 JSON（给机器狗/脚本吃）
//   node tools\verify-reload.mjs --out reload-status.json   # 顺带写状态文件
//   node tools\verify-reload.mjs --quiet    # 只打结论，退出码为准

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const DEP = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'claim-verify-wsc');
const LOADS = path.join(os.homedir(), '.dsh', 'dsh-claim-verify', 'loads.jsonl');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const valueOf = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : null;
};

function buildIdAt(dir) {
  try {
    const mod = path.join(dir, 'lib', 'build-id.js');
    if (!fs.existsSync(mod))
      return null;
    process.chdir(dir);
    // build-id.js 只读本目录文件，可在子进程里算，避免污染本进程的 cwd
    const out = execSync(`node --input-type=module -e "import { computeBuildId } from './lib/build-id.js'; console.log(computeBuildId());"`, {
      cwd: dir, encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    return String(out).trim().split(/\r?\n/).pop() || null;
  }
  catch {
    return null;
  }
}

function listenPid(port = 3080) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 15000, windowsHide: true });
    const line = out.split(/\r?\n/).find((l) => new RegExp(':' + port + '\\s').test(l) && /LISTENING/i.test(l));
    if (!line)
      return null;
    return line.trim().split(/\s+/).pop() || null;
  }
  catch {
    return null;
  }
}

function hostRecord(pid) {
  if (!pid || !fs.existsSync(LOADS))
    return null;
  try {
    const rows = fs.readFileSync(LOADS, 'utf8').trim().split('\n').map((l) => {
      try { return JSON.parse(l); }
      catch { return null; }
    }).filter(Boolean);
    const mine = rows.filter((r) => String(r.pid) === String(pid));
    return mine.length ? mine[mine.length - 1] : null;
  }
  catch {
    return null;
  }
}

const srcId = buildIdAt(SRC);
const depId = fs.existsSync(DEP) ? buildIdAt(DEP) : null;
const pid = listenPid(3080);
const rec = hostRecord(pid);
const hostId = rec ? rec.buildId : null;

let code = 0;
let verdict = 'UNKNOWN';
let action = '';
if (!pid) {
  code = 2;
  verdict = 'UNKNOWN';
  action = '端口 3080 没有监听：宿主没起，别把"没起"当"通过"';
}
else if (!hostId) {
  code = 2;
  verdict = 'UNKNOWN';
  action = `找不到 pid ${pid} 的加载记录（loads.jsonl）；无法判定宿主加载的是哪一版`;
}
else if (!srcId) {
  code = 2;
  verdict = 'UNKNOWN';
  action = '算不出源码 buildId（lib/build-id.js 读不到？）';
}
else if (srcId !== depId) {
  code = 3;
  verdict = 'DEPLOY-OLD';
  action = '源码改了但没同步到 profile：先跑 tools\\deploy.ps1（它内置 CI，别手抄文件）';
}
else if (hostId !== srcId) {
  code = 1;
  verdict = 'STALE';
  action = '宿主还跑着旧 build：走桌面「重启DSH.bat」。重启后再跑本脚本，退出码 0 才算生效';
}
else {
  code = 0;
  verdict = 'READY';
  action = '新代码已在跑';
}

const status = {
  ok: code === 0,
  verdict,
  exitCode: code,
  action,
  at: new Date().toISOString(),
  host: { pid, buildId: hostId, version: rec ? rec.version : null },
  src: { dir: SRC, buildId: srcId },
  dep: { dir: DEP, buildId: depId },
};

const out = valueOf('--out');
if (out) {
  try {
    fs.writeFileSync(path.resolve(out), JSON.stringify(status, null, 2), 'utf8');
  }
  catch { /* 写不出来不影响退出码 */ }
}

if (flag('--json'))
  console.log(JSON.stringify(status));
else if (flag('--quiet'))
  console.log(`${verdict} host=${hostId || '?'} src=${srcId || '?'} pid=${pid || '?'}`);
else {
  console.log('重启判据（verify-reload）');
  console.log(`  宿主   pid=${pid || '(无)'} build=${hostId || '(无记录)'} ver=${rec ? rec.version : '?'}`);
  console.log(`  源码   build=${srcId || '(算不出)'}  ${SRC}`);
  console.log(`  部署   build=${depId || '(无)'}  ${DEP}`);
  console.log('');
  console.log(`  结论   ${verdict}（exit ${code}）`);
  console.log(`  含义   ${action}`);
}

// --soft：人看/排障用，永远退出 0（机读判据用不带 --soft 的模式，见 verify-revision 里的说明）
if (flag('--soft'))
  process.exit(0);
process.exit(code);
