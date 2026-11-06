// 第 1 步：轴向聚类 —— 把 hits.jsonl 里的唯一断言归成"误报分类学"，并算频次。
// 依据 awesome-evals「open → axial coding → prioritize」模式：先聚类，再按频率×严重度排。
//
// 用法：node tools/error-taxonomy.mjs
import fs from 'node:fs';

const file = process.argv[2] || 'C:/Users/19156/.dsh/dsh-claim-verify/hits.jsonl';
const rows = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (!e || !Array.isArray(e.bad)) continue;
  rows.push(e);
}

const keyOf = (k, v) => k + '|' + JSON.stringify(v);
const uniq = new Map();
for (const e of rows) {
  for (const b of e.bad) {
    const k = keyOf(b.kind, b.claim);
    const cur = uniq.get(k) || { kind: b.kind, claim: b.claim, n: 0, text: '' };
    cur.n += 1;
    if (!cur.text) cur.text = String(e.text || '');
    uniq.set(k, cur);
  }
}

const P = /__[a-z0-9_]+__|no_such|nonexistent|dummy|placeholder/i;
function classify(u) {
  const t = u.text;
  const v = typeof u.claim === 'string' ? u.claim : String(u.claim);
  if (u.kind === 'port') {
    if (/DSH|宿主|网页版|GUI/.test(t)) return '自指端口（DSH 自己的端口）';
    if (/当时|之前|原来|上次|历史|曾经/.test(t)) return '历史叙述里的端口';
    return '普通端口断言';
  }
  if (u.kind === 'path') {
    if (P.test(v)) return '占位/夹具路径';
    if (/[$<>]/.test(v)) return '变量或提示符伪路径';
    if (/核验|误报|引用|原文|报错/.test(t)) return '元文本里的路径（引用自己）';
    return '普通路径断言';
  }
  if (u.kind === 'model') return '占位 provider/model';
  if (u.kind === 'money') return '被当成金额的裸数字';
  if (u.kind === 'time' || u.kind === 'date') return '时钟类（写下时刻 ≠ 核验时刻）';
  if (u.kind === 'pid') return '进程 PID';
  if (u.kind === 'math') return '算式';
  if (u.kind === 'service') return '服务状态';
  if (u.kind === 'size') return '文件大小';
  return '其他';
}

const buckets = new Map();
for (const u of uniq.values()) {
  const c = classify(u);
  const b = buckets.get(c) || { cat: c, unique: 0, records: 0, samples: [] };
  b.unique += 1;
  b.records += u.n;
  if (b.samples.length < 2) b.samples.push(`${u.kind}:${JSON.stringify(u.claim).slice(0, 40)} ×${u.n}`);
  buckets.set(c, b);
}

const arr = [...buckets.values()].sort((a, b) => b.records - a.records);
const totalU = uniq.size;
const totalR = [...uniq.values()].reduce((s, u) => s + u.n, 0);

console.log(`唯一断言 ${totalU} 条 / 记录 ${totalR} 条\n`);
console.log('类别'.padEnd(28) + '唯一'.padStart(6) + '记录'.padStart(8) + '  样例');
for (const b of arr) {
  console.log(b.cat.padEnd(28) + String(b.unique).padStart(6) + String(b.records).padStart(8) + '  ' + b.samples.join(' | '));
}
