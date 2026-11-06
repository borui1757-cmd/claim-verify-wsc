// blackbox.mjs —— 查看/校验/回放黑盒记录
//
// 用法：
//   node tools/blackbox.mjs                 # 摘要 + 链校验
//   node tools/blackbox.mjs --replay 00:30  # 回放到该时刻（今天）
//   node tools/blackbox.mjs --tail 20       # 看最后 20 条
//   node tools/blackbox.mjs --verify        # 只校验链
import fs from 'node:fs';
import path from 'node:path';
import { createRecorder } from '../lib/recorder.js';

const DIR = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]
  : 'C:/Users/19156/.dsh/dsh-claim-verify/blackbox';

if (!fs.existsSync(path.join(DIR, 'events.jsonl'))) {
  console.log('还没有黑盒记录：' + DIR);
  console.log('（宿主加载新版插件并跑过一轮后才会产生）');
  process.exit(0);
}

const rec = createRecorder({ dir: DIR });
const st = rec.stats();

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};

if (process.argv.includes('--verify')) {
  console.log(JSON.stringify(rec.verify()));
  process.exit(0);
}

const replayAt = argOf('--replay');
if (replayAt) {
  // 支持 "HH:MM" （今天）或完整 ISO
  let t = replayAt;
  if (/^\d{2}:\d{2}/.test(replayAt)) {
    const d = new Date();
    const [h, m] = replayAt.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    t = d.toISOString();
  }
  const r = rec.replay(t);
  console.log('回放到 ' + t);
  console.log('  事件数: ' + r.events);
  console.log('  按类型: ' + JSON.stringify(r.byType));
  if (r.lastEvent)
    console.log('  最后一条: ' + JSON.stringify(r.lastEvent).slice(0, 200));
  process.exit(0);
}

const tailN = Number(argOf('--tail') || 0);
if (tailN > 0) {
  const lines = fs.readFileSync(path.join(DIR, 'events.jsonl'), 'utf8').trim().split('\n').slice(-tailN);
  for (const l of lines) console.log(l.slice(0, 200));
  process.exit(0);
}

// 默认：摘要
console.log('黑盒：' + st.file);
console.log('  记录数: ' + st.records + ' / 上限 ' + st.maxRecords);
console.log('  链头:   ' + st.head);
console.log('  校验:   ' + JSON.stringify(rec.verify()));
const all = fs.readFileSync(path.join(DIR, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const byType = all.reduce((a, r) => { a[r.type] = (a[r.type] || 0) + 1; return a; }, {});
console.log('  按类型: ' + JSON.stringify(byType));
if (all.length) {
  console.log('  最早: ' + all[0].at);
  console.log('  最新: ' + all[all.length - 1].at);
}
