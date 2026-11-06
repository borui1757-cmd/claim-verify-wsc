// 打印某个会话**最后 N 条** assistant 消息（看结论落在哪）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = 'C:/Users/19156/.dsh/sessions';
const WS = process.argv[2];
const SID = process.argv[3];
const N = Number(process.argv[4] || 5);

const dir = path.join(ROOT, WS, SID);
const file = fs.readdirSync(dir).find((f) => f.endsWith('.jsonl.zstd'));
const text = zlib.zstdDecompressSync(fs.readFileSync(path.join(dir, file))).toString('utf8');

function textOf(msg) {
  const c = msg && msg.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((x) => x && x.type === 'text').map((x) => x.text).join('\n');
}

const msgs = [];
for (const line of text.split('\n')) {
  let j; try { j = JSON.parse(line); } catch { continue; }
  if (j.type !== 'assistant/message') continue;
  const t = textOf(j.data && j.data.message);
  if (t && t.length > 60) msgs.push({ at: j.time, t });
}
for (const m of msgs.slice(-N)) {
  console.log(`\n===== ${new Date(m.at).toLocaleString('zh-CN')} =====`);
  console.log(m.t.slice(0, 1000));
}
console.log(`\n（共 ${msgs.length} 条 assistant 消息）`);
