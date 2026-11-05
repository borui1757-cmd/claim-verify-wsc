// priority.mjs —— 矛盾驱动的优先级
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordFact } from '../lib/worldmodel.js';
import { unresolvedContradictions, priorityQueue, prioritySummary } from '../lib/priority.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-pri-'));
const file = path.join(dir, 'wm.jsonl');
const T = Date.now();

// 空账本
check('空账本 → 无未解决', unresolvedContradictions({ file }).length === 0);
check('空账本 → 总结文案', prioritySummary({ file }).includes('没有未解决'));

// A：被证伪 3 次，未再支持 → 未解决
for (let i = 0; i < 3; i += 1)
  recordFact({ kind: 'file', target: 'C:/a.txt', verdict: 'contradicted', file, at: T - 1000 * (3 - i) });
const u1 = unresolvedContradictions({ file });
check('被证伪且未解释 → 未解决', u1.length === 1 && u1[0].count === 3, JSON.stringify(u1));

// B：证伪后又成功 → 已解释
recordFact({ kind: 'file', target: 'C:/b.txt', verdict: 'contradicted', file, at: T - 5000 });
recordFact({ kind: 'file', target: 'C:/b.txt', verdict: 'supported', file, at: T - 4000 });
const u2 = unresolvedContradictions({ file });
check('证伪后成功 → 已解释（不在队列）', u2.every((x) => x.target !== 'C:/b.txt'), JSON.stringify(u2.map((x) => x.target)));

// 优先级：次数多 + 类型权重高的排前
for (let i = 0; i < 5; i += 1)
  recordFact({ kind: 'port', target: '8700', verdict: 'contradicted', file, at: T - 100 * i });
const q = priorityQueue({ file });
check('队列非空', q.length > 0);
check('端口（权重高且次数多）排第一', q[0].kind === 'port' && q[0].target === '8700', JSON.stringify(q[0]));
check('得分递减', q.every((x, i) => i === 0 || q[i - 1].score >= x.score), JSON.stringify(q.map((x) => x.score)));

// limit 生效
check('limit 生效', priorityQueue({ file, limit: 1 }).length === 1);

// 新鲜度：越近得分越高
const f = path.join(dir, 'fresh.jsonl');
recordFact({ kind: 'file', target: 'C:/old.txt', verdict: 'contradicted', file: f, at: T - 6 * 24 * 3600 * 1000 });
recordFact({ kind: 'file', target: 'C:/new.txt', verdict: 'contradicted', file: f, at: T - 60 * 1000 });
const qf = priorityQueue({ file: f, now: T });
check('新的排前面', qf[0].target === 'C:/new.txt', JSON.stringify(qf.map((x) => [x.target, x.score])));

// 总结文案含最优先项
check('总结含最优先对象', prioritySummary({ file }).includes('8700'));

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
