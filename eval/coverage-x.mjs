// coverage-x.mjs —— 离线测结构对账覆盖率 X（不调模型、不改任何状态）
// X = checkPromises 能判定的动作断言 / 全部动作断言
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { createTrace } from '../lib/trace.js';
import { checkPromises, summarizePromises, countClaimCandidates } from '../lib/promise.js';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const read = (f) => {
  const buf = fs.readFileSync(f); const st = []; let i = buf.indexOf(MAGIC);
  while (i !== -1) { st.push(i); i = buf.indexOf(MAGIC, i + 4); }
  const out = []; for (let k = 0; k < st.length; k++) { const e = k + 1 < st.length ? st[k + 1] : buf.length; try { out.push(zlib.zstdDecompressSync(buf.subarray(st[k], e))); } catch {} }
  return Buffer.concat(out).toString('utf8');
};
const walk = (d, a = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, a); else if (e.name.endsWith('.jsonl.zstd')) a.push(p); } return a; };

// 动作断言的宽口径（跟 sentence-audit 的 ACTION_RE 一致，用来当分母）
const ACTION_RE = /(?:已|已经|完成|创建|写入|保存|删除|修改|更新|启动|重启|停止|部署|安装|通过|成功|失败|修复|上传|提交|运行中|在跑|监听)/;
const splitS = (t) => t.split(/[。！？!?；;\n]+/).map((s) => s.trim()).filter((s) => s.length >= 4);

const files = walk(path.join(os.homedir(), '.dsh', 'sessions'));
const trace = createTrace();
let totalAction = 0;
let claimCandidates = 0;
let turnsWithReport = 0;
const tally = { supported: 0, contradicted: 0, uncertain: 0 };
const samples = [];

for (const f of files) {
  let raw; try { raw = read(f); } catch { continue; }
  const sid = path.basename(path.dirname(f));
  const session = { id: sid };
  const rep = new Map();
  const turns = new Set();
  for (const line of raw.split('\n')) {
    if (!line.includes('"tool/') && !line.includes('"assistant/message"')) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'tool/call' || o.type === 'tool/result') {
      trace.onEvent(session, o);
      if (o.type === 'tool/call' && o.data?.turn !== undefined) turns.add(o.data.turn);
      continue;
    }
    const c = o.data?.message?.content;
    if (Array.isArray(c)) {
      const t = c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n').trim();
      if (t && t.length > 80) rep.set(o.data.turn, (rep.get(o.data.turn) || '') + '\n' + t);
    }
  }
  for (const t of turns) {
    const text = rep.get(t);
    if (!text) continue;
    turnsWithReport += 1;
    const actionSentences = splitS(text).filter((s) => ACTION_RE.test(s));
    totalAction += actionSentences.length;
    const { pairs } = trace.pairs(sid, t);
    if (!pairs.length) continue;
    const r = checkPromises(text, pairs);
    claimCandidates += countClaimCandidates(text);
    for (const x of r.results) {
      tally[x.verdict] = (tally[x.verdict] || 0) + 1;
      if (samples.length < 400) samples.push({ sid: sid.slice(-8), turn: t, ...x });
    }
  }
  trace.clear(sid);
}

const covered = tally.supported + tally.contradicted + tally.uncertain;
const decisive = tally.supported + tally.contradicted;
console.log(`扫 ${files.length} 个会话，${turnsWithReport} 个有报告的轮次`);
console.log(`动作句总数（分母）    ${totalAction}`);
console.log(`结构对账产出的判定    ${covered}`);
console.log(`  其中 supported      ${tally.supported}`);
console.log(`       contradicted   ${tally.contradicted}`);
console.log(`       uncertain      ${tally.uncertain}`);
console.log('');
console.log(`X（覆盖动作句比例）   ${totalAction ? (covered / totalAction * 100).toFixed(1) : 0}%`);
console.log(`X_decisive（能给结论） ${totalAction ? (decisive / totalAction * 100).toFixed(1) : 0}%`);
console.log(`断言候选（真分母）     ${claimCandidates}`);
console.log(`X_claim（对断言候选）  ${claimCandidates ? (decisive / claimCandidates * 100).toFixed(1) : 0}%`);
if (totalAction) {
  const X = decisive / totalAction;
  console.log('');
  console.log(`按公式估算整体 F1 ≈ ${(X * 1 + (1 - X) * 0.78).toFixed(3)}（结构层按 1.0、模型层按 0.78）`);
}

// 抽 30 条 contradicted 供人工判定（这是算 precision 的样本）
const bad = samples.filter((s) => s.verdict === 'contradicted').slice(0, 30);
if (bad.length) {
  const lines = ['# 结构对账 contradicted 样本（人工判定用）', '', '填 TRUE（确实虚报）/ FALSE（误报）', ''];
  for (const b of bad)
    lines.push(`- [ ] **${b.sid} t${b.turn}** ${b.kind}\n  - 句子：${b.sentence.slice(0, 120)}\n  - 依据：${b.evidence}`);
  fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'docs', 'PRIVATE-promise-samples.md'), lines.join('\n'), 'utf8');
  console.log(`\n已导出 ${bad.length} 条 contradicted 样本 → docs/PRIVATE-promise-samples.md`);
}

const good = samples.filter((s) => s.verdict === 'supported').slice(0, 8);
if (good.length) {
  console.log('\n--- supported 抽样（看有没有把错的判成对的）---');
  for (const g of good) console.log(`  ${g.kind} | ${g.sentence.slice(0, 50)} ← ${g.evidence}`);
}
