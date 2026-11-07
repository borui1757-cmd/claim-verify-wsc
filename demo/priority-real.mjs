// 用真实的 receipts.jsonl 构造账本，检验优先级队列在真实数据上的表现。
// 不修改线上文件，只在临时目录生成。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { priorityQueue, prioritySummary } from '../lib/priority.js';

const rc = path.join(os.homedir(), '.dsh', 'dsh-claim-verify', 'receipts.jsonl');
if (!fs.existsSync(rc)) {
  console.log('没有 receipts.jsonl');
  process.exit(0);
}

const receipts = fs.readFileSync(rc, 'utf8').trim().split('\n').map((l) => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-pri-real-'));
const file = path.join(tmp, 'wm.jsonl');
const out = fs.createWriteStream(file);

let claims = 0;
for (const r of receipts) {
  const at = Date.parse(r.at || r.timestamp || '') || Date.now();
  for (const c of (r.claims || [])) {
    const inner = c.claim || {};
    const kind0 = inner.kind;
    const target0 = inner.target;
    const verdict = c.verdict === 'contradicted' ? 'contradicted' : (c.verdict === 'supported' ? 'supported' : null);
    if (!verdict || !kind0 || !target0)
      continue;
    const kind = kind0 === 'write' ? 'file' : (kind0 === 'port' ? 'port' : 'other');
    out.write(JSON.stringify({ at, kind, target: String(target0), verdict, detail: '' }) + '\n');
    claims += 1;
  }
}
out.end();

await new Promise((res) => out.on('close', res));

console.log(`从 ${receipts.length} 份回执抽取 ${claims} 条带对象与判定的声明`);
console.log(prioritySummary({ file }));
const q = priorityQueue({ file, limit: 10 });
if (q.length) {
  console.log('\n得分  被证伪  类型    对象');
  for (const x of q)
    console.log(`${String(x.score).padStart(5)}  ${String(x.count).padStart(5)}  ${x.kind.padEnd(6)} ${x.target}`);
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
