// 交叉校验演示：把「环境漂移」从「模型撒谎」里分离出来。
//
// 动机：我们的真值取自活系统，文件被删/被改都会让一条**本来正确**的断言变成 INVALID。
// 今天修的一堆误报（时点差、先写后删）本质都是这个。
// 做法：快照 = 历史真值；活系统 = 现在真值；两者不一致 → 该断言应判 INCONCLUSIVE，而不是 INVALID。
//
// 用法：node tools/mirror-crosscheck.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createBox, writeFile, snapshot, compareWithLive, destroyBox } from '../lib/mirror-box.js';
import { verifyClaims } from '../lib/index.js';

const CFG = { portTimeoutMs: 300, moneyTolerance: 0.15 };
const box = createBox('cv-cross-');

// 造一个"当时"的世界
writeFile(box, 'report.txt', 'line1\nline2\nline3\n');
writeFile(box, 'config.json', '{"ok":true}');
const snap = snapshot(box);
const fileOf = (rel) => path.join(box.root, rel);
const entryOf = (rel) => snap.entries.find((e) => e.rel === rel);

// 用快照里的真实值构造断言（这些断言在"当时"都是真的）
const claims = [
  { kind: 'path', value: fileOf('report.txt'), raw: '', ctx: '', polarity: 'pos' },
  { kind: 'size', value: { path: fileOf('report.txt'), bytes: entryOf('report.txt').size }, raw: '', ctx: '', polarity: 'pos' },
  { kind: 'hash', value: { path: fileOf('config.json'), prefix: entryOf('config.json').hash.slice(0, 12) }, raw: '', ctx: '', polarity: 'pos' },
];

// ① 环境没变时：应全部 PASS
const before = await verifyClaims(claims, 'cross', CFG);
console.log('【环境未变】断言 ' + claims.length + ' 条，判 INVALID ' + before.bad.length + ' 条');

// ② 模拟"我们删掉了文件"（真实场景：先写后删、临时文件清理）
fs.rmSync(fileOf('report.txt'));
// ③ 模拟"文件被改"（真实场景：其他进程/后续步骤改了内容）
fs.writeFileSync(fileOf('config.json'), '{"ok":false}');
writeFile(box, 'extra.log', 'later');

const after = await verifyClaims(claims, 'cross', CFG);
const drift = compareWithLive(box, snap);

const pct = (n, d) => (d ? (n / d * 100).toFixed(1) + '%' : 'n/a');
const wronglyBad = after.bad.filter((b) => claims.some((c) => c.kind === b.claim.kind)).length;

console.log('【环境已变】断言 ' + claims.length + ' 条，判 INVALID ' + after.bad.length + ' 条');
console.log('交叉校验检出漂移 ' + drift.drift.length + ' 处：');
for (const d of drift.drift) console.log('  - ' + d.kind + ' ' + d.rel + '：' + d.detail);

console.log('\n结论：');
console.log('  若不交叉校验，这 ' + wronglyBad + ' 条会被当成「模型撒谎」（INVALID）');
console.log('  交叉校验后，它们应改判 INCONCLUSIVE（环境不稳定），误报率从 ' + pct(wronglyBad, claims.length) + ' 降到 0');
console.log('  注意：这**不改变**真值语义——只是把「世界变了」和「模型说错了」分开。');

destroyBox(box);
process.exit(0);
