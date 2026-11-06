// doctor.mjs —— 体检：在你这个环境里，它到底能跑多少
//
// 为什么需要：换个宿主/平台时，插件可能"装好了但从不触发"——
// 静默失效是最危险的失败方式。这个命令把"能跑多少"摊开给人看。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIXTURE = path.join(ROOT, 'package.json'); // 一定存在，用来测文件类原语

const rows = [];
function add(name, ok, detail) {
  const text = String(detail ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
  rows.push({ name, ok, detail: text });
}

function cmd(exe, args, timeout = 4000) {
  try {
    const r = spawnSync(exe, args, { encoding: 'utf8', timeout });
    return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).slice(0, 80) };
  }
  catch (e) {
    return { ok: false, out: e.message.slice(0, 60) };
  }
}

// ── 1. 运行环境 ──
add('Node 版本', Number(process.versions.node.split('.')[0]) >= 20, process.versions.node);
add('平台', true, process.platform + ' ' + os.arch());

// ── 2. 文件类原语（最容易移植）──
try {
  const st = fs.statSync(FIXTURE);
  add('path / size', st.isFile(), `${st.size} 字节`);
}
catch (e) { add('path / size', false, e.message); }

try {
  const buf = fs.readFileSync(FIXTURE);
  add('lines / hash', buf.length > 0, `${buf.toString('utf8').split('\n').length} 行`);
}
catch (e) { add('lines / hash', false, e.message); }

try {
  const dir = path.dirname(FIXTURE);
  const listed = fs.readdirSync(dir).includes(path.basename(FIXTURE));
  add('readdir（目录项）', listed, dir.split(path.sep).slice(-1)[0]);
}
catch (e) { add('readdir（目录项）', false, e.message); }

// ── 3. 纯计算（任何平台都有）──
add('math', 12 * 12 === 144, '12×12=144');
add('time / date', new Date().getFullYear() >= 2020, new Date().toISOString().slice(0, 19));

// ── 4. 进程/端口 ──
add('pid（自身进程）', process.pid > 0, 'pid=' + process.pid);

const portProbe = await (async () => {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const fin = (v) => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(500);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error', () => fin(false));
    try { s.connect(59999, '127.0.0.1'); } catch { fin(false); }
  });
})();
add('port（探测）', portProbe === false, '59999 未监听（探测可用）');

// ── 5. Windows 专属原语 ──
if (process.platform === 'win32') {
  const sc = cmd('sc.exe', ['query', 'type=', 'service', 'state=', 'all']);
  add('service（sc query）', sc.ok, sc.ok ? '可查询' : sc.out);

  const reg = cmd('reg.exe', ['query', 'HKLM\\SOFTWARE', '/v', 'Microsoft']);
  add('registry（reg query）', reg.ok || /REG_|ERROR/.test(reg.out), reg.ok ? '可查询' : reg.out);

  const task = cmd('schtasks.exe', ['/query', '/fo', 'list']);
  add('task（schtasks）', task.ok, task.ok ? '可查询' : task.out);

  const wmic = cmd('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory']);
  add('mem（WMI）', wmic.ok && /\d/.test(wmic.out), wmic.out.slice(0, 40));
}
else {
  add('service / registry / task', false, '仅 Windows 实现，本平台不可用');
  const free = cmd('free', ['-b']);
  add('mem（free）', free.ok, free.ok ? '可读' : free.out);
}

// ── 6. 宿主能力（工具注册 / 钩子）──
let dshTools = false;
try {
  await import('@deepseek-ai/dsh-tools');
  dshTools = true;
}
catch { dshTools = false; }
add('工具注册（@deepseek-ai/dsh-tools）', dshTools, dshTools ? '可注册 commit_claims / task_accept' : '宿主外运行，工具类功能不可用');

// ── 输出 ──
const okCount = rows.filter((r) => r.ok).length;
const width = Math.max(...rows.map((r) => r.name.length));

console.log('claim-verify 环境体检\n');
for (const r of rows) {
  const mark = r.ok ? '✅' : '❌';
  console.log(`  ${mark} ${r.name.padEnd(width)}  ${r.detail || ''}`);
}

console.log(`\n共 ${rows.length} 项，可用 ${okCount} 项。`);

// 结论
const core = ['path / size', 'lines / hash', 'math', 'port（探测）'];
const coreOk = core.every((n) => rows.find((r) => r.name === n)?.ok);
if (coreOk && dshTools)
  console.log('结论：可以完整运行（文件/端口/计算核验 + 工具注册）。');
else if (coreOk)
  console.log('结论：核验层可用（文件/端口/计算），但工具注册不可用——只能在宿主内用。');
else
  console.log('结论：核心原语不全，不建议在这个环境里开。');

process.exit(okCount >= rows.length * 0.6 ? 0 : 1);
