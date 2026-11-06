// dump-session-hits.mjs —— 把某个会话里命中关键词的消息整条取出来
// 用法: node tools/dump-session-hits.mjs <工作区目录名> <会话id> 关键词1 关键词2 ...
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = 'C:/Users/19156/.dsh/sessions';
const WS = process.argv[2];
const SID = process.argv[3];
const KEYS = process.argv.slice(4);

const dir = path.join(ROOT, WS, SID);
const file = fs.readdirSync(dir).find((f) => f.endsWith('.jsonl.zstd'));
const text = zlib.zstdDecompressSync(fs.readFileSync(path.join(dir, file))).toString('utf8');
const lines = text.split('\n').filter(Boolean);

/** 递归捞正文（不同事件结构不一样） */
function extract(obj) {
  const out = [];
  const walk = (v, depth) => {
    if (depth > 6 || v == null) return;
    if (typeof v === 'string') { if (v.length > 20) out.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k], depth + 1);
    }
  };
  walk(obj, 0);
  return out.join('\n');
}

let n = 0;
for (const line of lines) {
  if (!KEYS.some((k) => line.includes(k))) continue;
  let j;
  try { j = JSON.parse(line); } catch { continue; }
  const body = extract(j);
  // 排除只是 callId 之类偶然命中
  if (!KEYS.some((k) => body.includes(k))) continue;
  n += 1;
  console.log(`\n===== [${n}] ${j.type} ${new Date(j.time).toLocaleString('zh-CN')} =====`);
  console.log(body.slice(0, 1200));
  if (n >= 10) break;
}
console.log(`\n共 ${n} 条`);
