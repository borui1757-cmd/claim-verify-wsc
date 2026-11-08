// restart-ab.mjs -- 重启前后 A/B 对照（确定性，零模型），交给机器狗按退出码判。
//
// 用法：
//   node tools/restart-ab.mjs before   # 重启前拍一张
//   node tools/restart-ab.mjs after    # 重启后拍一张并对比
//   node tools/restart-ab.mjs status   # 只看当前状态
//
// "after" 的退出码（机器狗用 cmd_exit_0）：
//   0  PASS   宿主换了进程，且新 pid 有加载记录，且加载的 buildId == 源码 buildId
//   1  STALE  宿主换了进程，但没加载到新 build（插件没起来或还跑旧版）
//   2  SAME   进程没换（根本没重启）
//   3  NOBASE 没有 before 快照，无法对比
//   4  SRC    算不出源码 buildId

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const DIR = path.join(os.homedir(), '.dsh', 'dsh-claim-verify');
const BEFORE = path.join(DIR, 'restart-ab-before.json');
const AFTER = path.join(DIR, 'restart-ab-after.json');

const argv = process.argv.slice(2);
const cmd = argv[0];

const readJsonl = (p) => {
  try {
    return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  catch { return []; }
};

const listenPid = (port = 3080) => {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 15000, windowsHide: true });
    const line = out.split(/\r?\n/).find((l) => new RegExp(':' + port + '\\s').test(l) && /LISTENING/i.test(l));
    return line ? line.trim().split(/\s+/).pop() : null;
  }
  catch { return null; }
};

const procStart = (pid) => {
  if (!pid) return null;
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToString('o')"`, {
      encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    return String(out).trim() || null;
  }
  catch { return null; }
};

const srcBuild = () => {
  try {
    const out = execSync(`node --input-type=module -e "import { computeBuildId } from './lib/build-id.js'; console.log(computeBuildId());"`, {
      cwd: SRC, encoding: 'utf8', timeout: 15000, windowsHide: true,
    });
    return String(out).trim().split(/\r?\n/).pop() || null;
  }
  catch { return null; }
};

const statOf = (f) => {
  try { const s = fs.statSync(f); return { bytes: s.size, mtime: s.mtime.toISOString() }; }
  catch { return null; }
};

const snapshot = () => {
  const pid = listenPid();
  const loads = readJsonl(path.join(DIR, 'loads.jsonl'));
  const mine = pid ? loads.filter((r) => String(r.pid) === String(pid)) : [];
  const last = mine.length ? mine[mine.length - 1] : null;
  return {
    at: new Date().toISOString(),
    host: { pid, startedAt: procStart(pid), loadedBuild: last ? last.buildId : null, loadedVersion: last ? last.version : null, loadRecords: mine.length },
    srcBuild: srcBuild(),
    files: {
      loads: statOf(path.join(DIR, 'loads.jsonl')),
      hits: statOf(path.join(DIR, 'hits.jsonl')),
      feedback: statOf(path.join(DIR, 'feedback.jsonl')),
      receipts: statOf(path.join(DIR, 'receipts.jsonl')),
      revisions: statOf(path.join(DIR, 'revisions.jsonl')),
      revisionsShadow: statOf(path.join(DIR, 'revisions-shadow.jsonl')),
    },
  };
};

if (cmd === 'before' || cmd === 'after') {
  const snap = snapshot();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(cmd === 'before' ? BEFORE : AFTER, JSON.stringify(snap, null, 2), 'utf8');
  console.log(JSON.stringify(snap));
  if (cmd === 'before') process.exit(0);

  if (!fs.existsSync(BEFORE)) { console.log('NOBASE 没有 before 快照'); process.exit(3); }
  const b = JSON.parse(fs.readFileSync(BEFORE, 'utf8'));
  const a = snap;
  if (!a.srcBuild) { console.log('SRC 算不出源码 buildId'); process.exit(4); }
  const changedPid = String(a.host.pid) !== String(b.host.pid);
  const freshLoad = a.host.loadedBuild === a.srcBuild;
  const lines = [
    `before  pid=${b.host.pid} build=${b.host.loadedBuild || '-'} at=${b.at}`,
    `after   pid=${a.host.pid} build=${a.host.loadedBuild || '-'} at=${a.at}`,
    `src     build=${a.srcBuild}`,
    `进程更换=${changedPid}  新build已加载=${freshLoad}`,
    `hits    ${b.files.hits ? b.files.hits.bytes : '-'} -> ${a.files.hits ? a.files.hits.bytes : '-'}`,
    `feedback ${b.files.feedback ? b.files.feedback.bytes : '-'} -> ${a.files.feedback ? a.files.feedback.bytes : '-'}`,
    `revisions ${b.files.revisions ? b.files.revisions.bytes : '无'} -> ${a.files.revisions ? a.files.revisions.bytes : '无'}`,
  ];
  console.log(lines.join('\n'));
  if (!changedPid) { console.log('SAME 进程没换：没重启'); process.exit(2); }
  if (!freshLoad) { console.log('STALE 换了进程但新 build 没加载'); process.exit(1); }
  console.log('PASS 重启生效：新进程 + 新 build 已加载');
  process.exit(0);
}

if (cmd === 'status') {
  console.log(JSON.stringify(snapshot(), null, 2));
  process.exit(0);
}

console.log('用法: node tools/restart-ab.mjs before|after|status');
process.exit(2);
