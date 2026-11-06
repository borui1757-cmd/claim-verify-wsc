// 在**所有工作区**的会话里搜关键词（会话是 zstd 压缩的 jsonl）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = 'C:/Users/19156/.dsh/sessions';
const KEYWORDS = process.argv.slice(2);
if (!KEYWORDS.length) {
  console.log('用法: node tools/find-in-sessions.mjs 正方体 对称性');
  process.exit(0);
}

function readSession(file) {
  const buf = fs.readFileSync(file);
  try {
    return zlib.zstdDecompressSync(buf).toString('utf8');
  }
  catch (e) {
    return null;
  }
}

const hits = [];
for (const ws of fs.readdirSync(ROOT)) {
  const wsDir = path.join(ROOT, ws);
  if (!fs.statSync(wsDir).isDirectory()) continue;
  for (const sid of fs.readdirSync(wsDir)) {
    const dir = path.join(wsDir, sid);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl.zstd')) continue;
      const text = readSession(path.join(dir, f));
      if (!text) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!KEYWORDS.some((k) => line.includes(k))) continue;
        hits.push({ ws, sid, line: i, len: line.length, snippet: line.slice(0, 300) });
      }
    }
  }
}

console.log(`命中 ${hits.length} 条\n`);
const bySession = new Map();
for (const h of hits) {
  const k = h.ws + '|' + h.sid;
  bySession.set(k, (bySession.get(k) || 0) + 1);
}
for (const [k, n] of bySession) console.log(`  ${n} 条  ${k}`);
console.log('');
for (const h of hits.slice(0, 5)) console.log(`[${h.ws.slice(0, 20)}… ${h.sid.slice(-8)}] ${h.snippet.slice(0, 200)}\n`);
