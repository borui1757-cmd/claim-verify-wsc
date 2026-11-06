// 三维 vs 四维：同一条断言，两种判定
//
// 场景：我在 t=100 写入了文件；t=200 它被删掉了。
// 现在（t=300）有人说"我写入了这个文件"。
//   三维判定：现在不存在 → 判 INVALID（模型撒谎）   ← 误报
//   四维判定：窗口内曾存在 → 判 PASS                ← 正确
//
// 用法：node tools/timeline-demo.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTimelineBox } from '../lib/timeline-box.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-tl-demo-'))
const box = createTimelineBox(root);
const f = path.join(root, 'report.md');

// ── 时间线 ──
fs.writeFileSync(f, '# 报告内容\n');
box.record(100, [f]);          // t=100 写入
fs.rmSync(f, { force: true });
box.record(200, [f]);          // t=200 被删（临时文件清理）

// ── 断言：我在 t=100 前后写入了 report.md ──
const claimWindow = [50, 150];

// 三维：只看"现在"
const existsNow = fs.existsSync(f);
const verdict3d = existsNow ? 'PASS' : 'INVALID';

// 四维：查时间窗
const inWindow = box.existedBetween(f, claimWindow[0], claimWindow[1]);
const verdict4d = inWindow.existed ? 'PASS' : 'INVALID';

console.log('断言：我在 t=100 前后写入了 report.md\n');
console.log('三维判定（只看此刻）  ：' + verdict3d + '   ← 现在文件不存在');
console.log('四维判定（查时间窗）  ：' + verdict4d + '   ← 窗口内 t=' + (inWindow.at ?? '-') + ' 存在过');
console.log('');
if (verdict3d !== verdict4d) {
  console.log('两种判定结论不同 —— 三维这一侧就是**误报**：');
  console.log('  它把"后来被清理"误判成"当初没写"。');
  console.log('  这正是我们今天修了很久的时点差类误报。');
}

// 世界线
const wl = box.worldline(f);
console.log('\n世界线：');
for (const v of wl) console.log(`  t=${v.at}  ${v.size} 字节  ${v.hash.slice(0, 12)}…`);

// 四维还能回答"当时那份字节是哪一份"
const at100 = box.versionAt(f, 120);
console.log('\nt=120 时刻的版本：' + (at100 ? at100.hash.slice(0, 12) + '…' : '无'));

fs.rmSync(root, { recursive: true, force: true });
process.exit(0);
