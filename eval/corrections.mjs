// corrections.mjs —— 从历史会话里抽「用户纠正句」，看这条路有没有真实素材
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const read = (f) => {
  const buf = fs.readFileSync(f); const st = []; let i = buf.indexOf(MAGIC);
  while (i !== -1) { st.push(i); i = buf.indexOf(MAGIC, i + 4); }
  const out = []; for (let k = 0; k < st.length; k++) { const e = k + 1 < st.length ? st[k + 1] : buf.length; try { out.push(zlib.zstdDecompressSync(buf.subarray(st[k], e))); } catch {} }
  return Buffer.concat(out).toString('utf8');
};
const walk = (d, a = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, a); else if (e.name.endsWith('.jsonl.zstd')) a.push(p); } return a; };

// 纠正/长期要求的标记词
const MARK = /以后|今后|下次|往后|从此|别再|不要再|不要|不用|禁止|一律|统一(?:用|改成)|必须|一律|记得|总是|永远|尽量别|换掉|不要再|从此以后/;

const files = walk(path.join(os.homedir(), '.dsh', 'sessions'));
const hits = [];
let userMsgs = 0;

for (const f of files) {
  let raw; try { raw = read(f); } catch { continue; }
  const sid = path.basename(path.dirname(f)).slice(-8);
  for (const line of raw.split('\n')) {
    if (!line.includes('"user/message"') && !line.includes('"user/text"'))
      continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const c = o.data?.message?.content ?? o.data?.content;
    let text = '';
    if (typeof c === 'string')
      text = c;
    else if (Array.isArray(c))
      text = c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n');
    if (!text || text.length < 6)
      continue;
    userMsgs += 1;
    for (const s of text.split(/[。！？!?；;\n]+/)) {
      const t = s.trim();
      if (t.length < 6 || t.length > 140)
        continue;
      if (!MARK.test(t))
        continue;
      if (/^(?:好|行|可以|ok|嗯)/i.test(t))
        continue;
      hits.push({ sid, turn: o.data?.turn, text: t });
    }
  }
}

// 去重（按前 40 字）
const seen = new Map();
for (const h of hits) {
  const k = h.text.slice(0, 40);
  if (!seen.has(k))
    seen.set(k, { ...h, count: 0 });
  seen.get(k).count += 1;
}
const uniq = [...seen.values()].sort((a, b) => b.count - a.count);

console.log(`扫 ${files.length} 个会话，含用户消息 ${userMsgs} 条`);
console.log(`命中纠正类句子 ${hits.length} 条，去重后 ${uniq.length} 条`);
console.log(`\n前 25 条（按重复次数）：`);
for (const u of uniq.slice(0, 25))
  console.log(`  [${u.count}] ${u.text.slice(0, 100)}`);

// 输出完整清单供人工挑规则
const out = ['# 用户纠正句候选（人工挑规则的原料）', '', `生成：${new Date().toISOString()}`, `共 ${uniq.length} 条（去重后）`, ''];
for (const u of uniq)
  out.push(`- [ ] \`${u.sid}\` t${u.turn ?? '?'} ×${u.count}  ${u.text}`);
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'docs', 'PRIVATE-corrections.md'), out.join('\n'), 'utf8');
console.log(`\n完整清单 → docs/PRIVATE-corrections.md`);
