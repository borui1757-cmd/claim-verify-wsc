// worldmodel.mjs —— 外部世界模型账本
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordFact, readLedger, lookupFact, ledgerStats } from '../lib/worldmodel.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-wm-'));
const file = path.join(dir, 'wm.jsonl');

// 1) 记录与读取
recordFact({ kind: 'file', target: 'C:/a/b.txt', verdict: 'supported', detail: '存在', file });
recordFact({ kind: 'file', target: 'C:/a/b.txt', verdict: 'contradicted', detail: '不存在', file, at: Date.now() + 1000 });
recordFact({ kind: 'port', target: '8700', verdict: 'supported', detail: '监听', file });

check('写入 3 条', readLedger(file).length === 3);
check('缺 kind 不写入', recordFact({ target: 'x', verdict: 'supported', file }) === null);

// 2) 查询取最近一条
const hit = lookupFact({ kind: 'file', target: 'c:/a/b.txt', file, now: Date.now() + 2000 });
check('查到最近一条', hit && hit.verdict === 'contradicted', JSON.stringify(hit));
check('路径归一（大小写/斜杠）', Boolean(hit));
check('未过期', hit && hit.stale === false);

// 3) 过期判定（file 的 TTL 是 1 小时）
const stale = lookupFact({ kind: 'file', target: 'C:/a/b.txt', file, now: Date.now() + 3 * 3600 * 1000 });
check('超过 TTL 标 stale', stale && stale.stale === true);

// 4) 端口 TTL 更短（5 分钟）
recordFact({ kind: 'port', target: '3080', verdict: 'supported', file, at: 1_700_000_000_000 });
const p1 = lookupFact({ kind: 'port', target: '3080', file, now: 1_700_000_000_000 + 60_000 });
const p2 = lookupFact({ kind: 'port', target: '3080', file, now: 1_700_000_000_000 + 10 * 60_000 });
check('端口 1 分钟内未过期', p1 && p1.stale === false);
check('端口 10 分钟后过期', p2 && p2.stale === true);

// 5) 查不到
check('查不到返回 null', lookupFact({ kind: 'file', target: 'C:/nope', file }) === null);

// 6) 统计
const s = ledgerStats(file);
check('统计总数', s.total === 4, JSON.stringify(s));
check('按类型分组', s.byKind.file === 2 && s.byKind.port === 2, JSON.stringify(s.byKind));
check('按判定分组', s.byVerdict.supported >= 3);

// 7) 空文件不崩
const empty = path.join(dir, 'empty.jsonl');
check('空账本不崩', ledgerStats(empty).total === 0 && lookupFact({ kind: 'file', target: 'x', file: empty }) === null);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
