// consolidate.mjs —— 慢循环（副交感）：整理账本
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isNoise, consolidate, consolidateFile } from '../lib/consolidate.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const now = Date.now();

// 噪音识别
check('临时路径是噪音', isNoise({ kind: 'file', target: 'C:\\Temp\\a.txt' }));
check('普通文件不是噪音', !isNoise({ kind: 'file', target: 'C:\\work\\a.txt' }));
check('测试命令是噪音', isNoise({ kind: 'cmd', target: 'npm test' }));
check('业务命令不是噪音', !isNoise({ kind: 'cmd', target: 'docker compose up -d' }));

// 整理：去重 / 过期 / 归并
const rows = [
  { kind: 'file', target: 'C:/a.txt', verdict: 'contradicted', at: now - 1000 },
  { kind: 'file', target: 'C:\\a.txt', verdict: 'supported', at: now - 500 },
  { kind: 'file', target: 'C:/b.txt', verdict: 'supported', at: now - 2 * 3600 * 1000 }, // 过期（>1h）
  { kind: 'cmd', target: 'npm test', verdict: 'contradicted', at: now - 100 },          // 噪音
  { kind: 'port', target: '8700', verdict: 'supported', at: now - 60 * 1000 },
];
const { kept, stats } = consolidate(rows, { now });
check('去重后 key 唯一', new Set(kept.map((r) => r.kind + r.target.toLowerCase())).size === kept.length, JSON.stringify(kept.map((r) => r.target)));
check('保留最新判定', kept.find((r) => r.kind === 'file')?.verdict === 'supported', JSON.stringify(kept));
check('过期被清掉', !kept.some((r) => String(r.target).includes('b.txt')));
check('噪音被清掉', !kept.some((r) => r.kind === 'cmd'));
check('统计一致', stats.kept === kept.length, JSON.stringify(stats));
check('噪音计数为 1', stats.noise === 1, JSON.stringify(stats));
check('过期计数为 1', stats.expired === 1, JSON.stringify(stats));

// 文件级：原子替换 + 归档
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-cons-'));
const file = path.join(dir, 'wm.jsonl');
fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const r = consolidateFile(file, { now });
check('文件整理成功', r.ok === true, JSON.stringify(r));
check('归档文件存在', Boolean(r.archive) && fs.existsSync(r.archive));
const after = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
check('整理后只剩保留项', after.length === kept.length, `${after.length} vs ${kept.length}`);
check('不存在的账本 → ok:false', consolidateFile(path.join(dir, 'nope.jsonl'), { now }).ok === false);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
