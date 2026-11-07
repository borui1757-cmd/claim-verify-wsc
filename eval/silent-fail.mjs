// silent-fail.mjs —— 失败未汇报检测（v2）
// 相对 v1 的三处修正：
//   1. 过滤 AbortError / 用户中断（那不是工具失败）
//   2. 失败措辞表扩充（退出码 N、不认参数、没生效、被拒、超时…）
//   3. 输出候选清单到 markdown，供人工标注（不再只打印样本）

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
function readSession(file) {
  const buf = fs.readFileSync(file);
  const starts = [];
  let i = buf.indexOf(MAGIC);
  while (i !== -1) { starts.push(i); i = buf.indexOf(MAGIC, i + 4); }
  const out = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length;
    try { out.push(zlib.zstdDecompressSync(buf.subarray(starts[k], end))); } catch { /* skip */ }
  }
  return Buffer.concat(out).toString('utf8');
}
function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.jsonl.zstd')) acc.push(p);
  }
  return acc;
}

/** 这些错误不是"工具失败了"，是用户/系统打断 */
const NOT_A_FAILURE = new Set(['AbortError', 'TimeoutError', '__aborted__']);

/** 报告里出现这些 = 它承认了有问题（v2 扩充） */
const FAIL_WORDS = new RegExp([
  '失败', '出错', '报错', '错误', '异常', '挂了', '超时',
  '没成功', '没有成功', '未成功', '未通过', '没有通过', '不通',
  '退出码', 'exit code', '不认参数', '没生效', '未生效', '没起来', '起不来',
  '被拒', '拒绝', '不允许', '不存在', '找不到', '对不上', '不接受',
  '无法', '不能', '跑不起来', '编译不过',
].join('|'));

const files = walk(path.join(os.homedir(), '.dsh', 'sessions')).slice(0, 12);
let turnsWithReport = 0;
let turnsWithRealError = 0;
let silent = 0;
let skippedAbort = 0;
const candidates = [];

for (const f of files) {
  let raw;
  try { raw = readSession(f); } catch { continue; }
  const sid = path.basename(path.dirname(f));
  const errByTurn = new Map();
  const reportByTurn = new Map();

  for (const line of raw.split('\n')) {
    if (!line.includes('"tool/') && !line.includes('"assistant/message"'))
      continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }

    if (o.type === 'tool/result') {
      const turn = o.data?.turn;
      const name = o.data?.error?.name || null;
      const isErr = o.data?.message?.isError === true || Boolean(o.data?.error);
      if (!isErr || turn === undefined)
        continue;
      if (name && NOT_A_FAILURE.has(name)) {
        skippedAbort += 1;
        continue;                        // ← 修正 1：中断不算失败
      }
      const arr = errByTurn.get(turn) || [];
      arr.push({ name: name || 'isError', callId: o.data?.message?.toolCallId || null });
      errByTurn.set(turn, arr);
      continue;
    }

    if (o.type === 'assistant/message') {
      const turn = o.data?.turn;
      const content = o.data?.message?.content;
      if (turn === undefined || !Array.isArray(content))
        continue;
      const text = content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
      if (text)
        reportByTurn.set(turn, (reportByTurn.get(turn) || '') + '\n' + text);
    }
  }

  for (const [turn, report] of reportByTurn) {
    turnsWithReport += 1;
    const errs = errByTurn.get(turn);
    if (!errs || !errs.length)
      continue;
    turnsWithRealError += 1;
    if (FAIL_WORDS.test(report)) {
      continue;                          // 报告承认了
    }
    silent += 1;
    candidates.push({ sid, turn, errs, report });
  }
}

console.log(`扫描 ${files.length} 个会话`);
console.log(`有报告的轮次              ${turnsWithReport}`);
console.log(`真的出现工具失败的轮次      ${turnsWithRealError}   （已剔除 AbortError 等 ${skippedAbort} 条）`);
console.log(`失败但报告没提的            ${silent}   占出错轮次 ${turnsWithRealError ? ((silent / turnsWithRealError) * 100).toFixed(1) : 0}%，占全部轮次 ${turnsWithReport ? ((silent / turnsWithReport) * 100).toFixed(1) : 0}%`);

// ── 输出标注表 ────────────────────────────────────────────────────
const lines = [
  '# 待标注：失败未汇报候选（v2 规则）',
  '',
  `生成时间：${new Date().toISOString()}`,
  '',
  '每条只需在 `label` 里填 **TRUE**（确实是"失败了没说"）或 **FALSE**（误报）。',
  '',
  '判定提醒：',
  '- 报告里用别的说法承认了失败（"退出码 9"、"不认参数"）→ **FALSE**',
  '- 失败的是无关的探测命令，报告讲的是另一件事 → **FALSE**',
  '- 报告宣称成功/完成，而失败恰好是那个动作 → **TRUE**',
  '',
  '| # | 会话 | 轮次 | 失败工具 | label | 报告摘录 |',
  '|---|---|---|---|---|---|',
];
candidates.forEach((c, i) => {
  const excerpt = c.report.replace(/\s+/g, ' ').trim().slice(0, 120).replace(/\|/g, '\\|');
  lines.push(`| ${i + 1} | ${c.sid.slice(-8)} | ${c.turn} | ${[...new Set(c.errs.map((e) => e.name))].join('/')} |  | ${excerpt} |`);
});
lines.push('');
lines.push('## 完整报告（逐条）');
lines.push('');
candidates.forEach((c, i) => {
  lines.push(`### ${i + 1}. ${c.sid} · turn ${c.turn}`);
  lines.push('');
  lines.push(`失败工具：${c.errs.map((e) => e.name).join(', ')}`);
  lines.push('');
  lines.push('```');
  lines.push(c.report.trim().slice(0, 800));
  lines.push('```');
  lines.push('');
});

const out = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'docs', 'labels-silent-fail.md');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log(`\n标注表已写入：${path.resolve(out)}`);
