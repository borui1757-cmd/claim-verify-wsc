// receipts-view.mjs —— 回执查看器的纯函数测试
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadReceipts, filterReceipts, formatReceipt, summarizeReceipts } from '../lib/receipts-view.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-view-'));
const file = path.join(dir, 'receipts.jsonl');
const rows = [
  { at: '2026-11-05T01:00:00.000Z', sessionId: 'session-aaaa1111', summary: { total: 2, supported: 2, contradicted: 0, insufficient: 0 }, digest: 'd1', sig: 's1' },
  { at: '2026-11-05T02:00:00.000Z', sessionId: 'session-bbbb2222', summary: { total: 3, supported: 1, contradicted: 1, insufficient: 1 }, digest: 'd2', sig: 's2' },
  { at: '2026-11-06T03:00:00.000Z', sessionId: 'session-bbbb2222', summary: { total: 1, supported: 0, contradicted: 1, insufficient: 0 }, digest: 'd3', sig: 's3' },
];
fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n坏行不是 JSON\n');

const loaded = loadReceipts(file);
check('坏行被跳过', loaded.length === 3, String(loaded.length));

check('按会话过滤', filterReceipts(loaded, { session: 'bbbb' }).length === 2);
check('按时间过滤', filterReceipts(loaded, { since: Date.parse('2026-11-06T00:00:00.000Z') }).length === 1);
check('只看含反驳的', filterReceipts(loaded, { onlyContradicted: true }).length === 2);
check('limit 取最近 N 条', filterReceipts(loaded, { limit: 1 }).length === 1 && filterReceipts(loaded, { limit: 1 })[0].digest === 'd3');
check('无匹配返回空', filterReceipts(loaded, { session: 'zzz' }).length === 0);

const line = formatReceipt(rows[1], { verify: true });
check('格式化含计数与验签标记', /1支持\/1反驳\/1无证据/.test(line) && /验签✓/.test(line), line);
check('格式化含会话前缀', line.includes('bbbb2222'));

const sum = summarizeReceipts(loaded);
check('汇总：3 份回执', sum.receipts === 3);
check('汇总：6 条声明', sum.claims === 6, String(sum.claims));
check('汇总：2 份含反驳', sum.withContradiction === 2, String(sum.withContradiction));
check('空汇总不炸', summarizeReceipts([]).receipts === 0);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败无所谓 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
