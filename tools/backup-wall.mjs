// backup-wall.mjs —— 备份墙：文件被删就自动放回去（2026-11-07）
//
// 背景：插件目录今天丢了 package.json / CHANGELOG.md / cordis.patch.yml 三个文件，
// 查不到是谁删的（无审计日志、无管理员权限）。既然抓不到凶手，就让删除无效。
//
// 做法：
//   1) snapshot  把关键文件的内容 + sha256 存到 ~/.dsh/dsh-claim-verify/wall/
//   2) watch     每 5 秒对照磁盘：**文件不见了**就从墙里取回；内容被改只报告不覆盖
//   3) check     一次性核对，缺几个就退出码几（>0 即异常）
//
// 为什么只补"缺失"不覆盖"被改"：覆盖会把正在改的源码冲掉——备份墙不能变成第二个事故源。
// 墙上目录独立于插件目录，删除方只删插件目录就不会一起带走它。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WALL = path.join(os.homedir(), '.dsh', 'dsh-claim-verify', 'wall');
const MANIFEST = path.join(WALL, 'manifest.json');
const LOG = path.join(WALL, 'restores.jsonl');

const INCLUDES = [/^lib[\\/].+\.js$/, /^bin[\\/].+\.mjs$/, /^tools[\\/].+\.mjs$/, /^test[\\/].+\.mjs$/,
  /^cordis\.patch\.yml$/, /^package\.json$/, /^CHANGELOG\.md$/, /^README\.md$/, /^LICENSE$/];
const SKIP = /node_modules|\.bak|\.deployed|gr-venv|pip-|data[\\/]/;

function walk(dir, base = '') {
  const out = [];
  let es = [];
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const rel = base ? path.join(base, e.name) : e.name;
    if (SKIP.test(rel)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { out.push(...walk(full, rel)); continue; }
    if (!INCLUDES.some((re) => re.test(rel))) continue;
    out.push(rel);
  }
  return out;
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function snapshot() {
  fs.mkdirSync(WALL, { recursive: true });
  const files = walk(ROOT);
  const entries = [];
  for (const rel of files) {
    const full = path.join(ROOT, rel);
    const buf = fs.readFileSync(full);
    const dest = path.join(WALL, 'files', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    entries.push({ rel, sha256: sha(buf), bytes: buf.length });
  }
  fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), root: ROOT, count: entries.length, entries }, null, 2), 'utf8');
  console.log(`墙已建好：${entries.length} 个文件 → ${WALL}`);
}

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return null; }
}

/** 核对一轮；返回 {missing:[], changed:[], restored:[]} */
function checkAndRestore({ restore = true } = {}) {
  const man = loadManifest();
  if (!man) throw new Error('没有墙：先跑 node tools/backup-wall.mjs snapshot');
  const missing = [];
  const changed = [];
  const restored = [];
  for (const e of man.entries) {
    const full = path.join(ROOT, e.rel);
    const fromWall = path.join(WALL, 'files', e.rel);
    if (!fs.existsSync(full)) {
      missing.push(e.rel);
      if (restore && fs.existsSync(fromWall)) {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.copyFileSync(fromWall, full);
        const ok = sha(fs.readFileSync(full)) === e.sha256;
        restored.push({ rel: e.rel, ok });
        fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), rel: e.rel, ok }) + '\n', 'utf8');
      }
      continue;
    }
    const cur = sha(fs.readFileSync(full));
    if (cur !== e.sha256) changed.push(e.rel);
  }
  return { missing, changed, restored };
}

const cmd = process.argv[2] || 'check';

if (cmd === 'snapshot') {
  snapshot();
  process.exit(0);
}

if (cmd === 'check') {
  const r = checkAndRestore({ restore: false });
  console.log(JSON.stringify({ missing: r.missing.length, changed: r.changed.length, files: r.missing.slice(0, 10) }));
  process.exit(r.missing.length === 0 ? 0 : Math.min(r.missing.length, 9));
}

if (cmd === 'heal') {
  const r = checkAndRestore({ restore: true });
  console.log(JSON.stringify({ missing: r.missing.length, restored: r.restored.length, changed: r.changed.length }));
  process.exit(r.missing.length === 0 ? 0 : 1);
}

if (cmd === 'watch') {
  const interval = Number(process.argv[3] || 5000);
  checkAndRestore({ restore: true }); // 启动先补一次
  const t = setInterval(() => {
    try {
      const r = checkAndRestore({ restore: true });
      if (r.restored.length) console.log(`[${new Date().toISOString()}] 已恢复 ${r.restored.length} 个：${r.restored.map((x) => x.rel).join(', ')}`);
      if (r.changed.length) console.log(`[${new Date().toISOString()}] 内容有变（不覆盖）：${r.changed.slice(0, 5).join(', ')}`);
    }
    catch (e) { console.log('watch 出错：' + e.message); }
  }, interval);
  console.log(`备份墙运行中：每 ${interval}ms 核对一次，缺失即恢复。墙在 ${WALL}`);
  process.on('SIGINT', () => { clearInterval(t); process.exit(0); });
  // 长跑：12 小时后自退，避免僵尸进程
  setTimeout(() => { clearInterval(t); process.exit(0); }, 12 * 3600 * 1000);
}
else if (!['snapshot', 'check', 'heal', 'watch'].includes(cmd)) {
  console.log('用法: node tools/backup-wall.mjs snapshot|check|heal|watch [间隔ms]');
  process.exit(2);
}
