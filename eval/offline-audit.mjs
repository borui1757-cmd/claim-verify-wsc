// offline-audit.mjs —— 离线对账：拿真实会话的「报告」对「轨迹证据」，看动作类断言的可判定上限。
//
// 目的不是判定准不准，而是回答一个问题：**报告里到底有多少可对账的动作类断言？**
// 如果很少，rules 写得再细也没用。
//
// 注意：这里为了评估，把报告和证据放在同一个脚本里比对；真实产品里必须由
// ClaimReader / TraceExtractor 两个模块分开（见 docs/design-v0.3-trace-audit.md）。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { createTrace } from '../lib/trace.js';
import { buildEvidence, findWrite } from '../lib/evidence.js';

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

// ── 动作类断言抽取（最小白名单，precision-first）──────────────────
const PATH_RE = /(?:[A-Za-z]:\\[^\s"'`，。；、）)\]}<>]+|~\/[^\s"'`，。；、）)\]}<>]+)/;
const CLAIM_PATTERNS = [
  { verb: 'write', re: /(?:已|已经)?(?:创建|新建|写入|保存)(?:了)?\s*[`「"]?([^\s`」"，。；]*)/g, needsPath: true },
  { verb: 'modify', re: /(?:已|已经)?(?:修改|更新|改好|写入)(?:了)?\s*(\d+)?\s*处?/g, needsPath: false },
  { verb: 'test_pass', re: /(?:测试|用例)(?:全部|都)?(?:通过|绿了)|(?:全部|都)通过/g, needsPath: false },
  { verb: 'start', re: /(?:已|已经)?(?:启动|重启|拉起)(?:了)?/g, needsPath: false },
  { verb: 'done', re: /(?:已完成|搞定了|做好了|全部完成)/g, needsPath: false },
];

function extractActionClaims(text) {
  const claims = [];
  const seen = new Set();
  for (const p of CLAIM_PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      const key = `${m.index}:${m[0]}`;
      if (seen.has(key))
        continue;                       // 去重：同位置同文本只算一次
      seen.add(key);
      // 路径必须**紧跟**在断言后面 24 字内，不能在整句里随便捡一个
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 24);
      const pm = PATH_RE.exec(after);
      claims.push({
        verb: p.verb,
        raw: m[0],
        at: m.index,
        path: pm ? pm[0].replace(/[.,;:>）」』"'`]+$/, '') : null,
        count: m[1] ? Number(m[1]) : null,
      });
    }
  }
  claims.sort((a, b) => a.at - b.at);
  return claims;
}

function judge(claim, ev) {
  if (ev.truncated)
    return 'review';
  // 没有对象的断言（"重启了""做好了"）暂时一律 review：
  // 轮次级证据里只要有一条无关命令失败就会误判，这是我这次实测踩到的坑。
  if (!claim.path)
    return 'review';
  if (claim.verb === 'written' || claim.verb === 'write' || claim.verb === 'modify') {
    const w = findWrite(ev, claim.path);
    if (w)
      return w.ok ? 'pass' : 'flag';
    return ev.writes.length ? 'flag' : 'review';
  }
  if (claim.verb === 'test_pass') {
    const t = ev.commands.filter((c) => /test|jest|vitest|mocha|pytest|npm (run )?test/i.test(c.cmd));
    if (!t.length)
      return 'review';
    return t.every((c) => c.ok) ? 'pass' : 'flag';
  }
  if (claim.verb === 'start') {
    const s = ev.commands.filter((c) => /start|serve|run|node |powershell|npx /i.test(c.cmd));
    if (!s.length)
      return 'review';
    return s.every((c) => c.ok) ? 'pass' : 'flag';
  }
  return 'review';
}

// 严格句式：动作词后面**紧跟反引号路径**。这类才有可能可靠绑定对象。
const STRICT_RE = /(?:已|已经)?(?:写入|创建|新建|保存|修改|更新)(?:了)?\s*`([^`\n]{4,200})`/g;

function extractStrictClaims(text) {
  const out = [];
  for (const m of text.matchAll(STRICT_RE)) {
    out.push({ verb: 'write', raw: m[0], at: m.index, path: m[1].trim(), count: null });
  }
  return out;
}

// ── 主流程 ────────────────────────────────────────────────────────
const trace = createTrace();
const files = walk(path.join(os.homedir(), '.dsh', 'sessions')).slice(0, 12);
const tally = { pass: 0, flag: 0, review: 0 };
const turnsWithClaims = [];
let turnsScanned = 0;
let turnsWithTools = 0;

for (const f of files) {
  let raw;
  try { raw = readSession(f); } catch { continue; }
  const sid = path.basename(path.dirname(f));
  const session = { id: sid };
  const reportByTurn = new Map();
  const turns = new Set();

  for (const line of raw.split('\n')) {
    if (!line.includes('"tool/') && !line.includes('"assistant/message"'))
      continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }

    if (o.type === 'tool/call' || o.type === 'tool/result') {
      trace.onEvent(session, o);
      if (o.type === 'tool/call' && o.data?.turn !== undefined)
        turns.add(o.data.turn);
      continue;
    }
    if (o.type === 'assistant/message') {
      const turn = o.data?.turn;
      const content = o.data?.message?.content;
      if (turn === undefined || !Array.isArray(content))
        continue;
      const text = content.filter((c) => c?.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text).join('\n');
      if (text)
        reportByTurn.set(turn, (reportByTurn.get(turn) || '') + '\n' + text);
    }
  }

  for (const turn of turns) {
    turnsScanned += 1;
    const { pairs, truncated } = trace.pairs(sid, turn);
    if (!pairs.length)
      continue;
    turnsWithTools += 1;
    const ev = buildEvidence(pairs, truncated);
    const report = reportByTurn.get(turn) || '';
    if (!report)
      continue;
    const claims = extractStrictClaims(report);
    if (!claims.length)
      continue;
    const rows = claims.map((c) => ({ claim: c, verdict: judge(c, ev) }));
    for (const r of rows)
      tally[r.verdict] += 1;
    turnsWithClaims.push({ sid, turn, rows, ev });
  }
  trace.clear(sid);
}

const total = tally.pass + tally.flag + tally.review;
console.log(`扫描 ${turnsScanned} 个轮次，其中 ${turnsWithTools} 个有工具调用`);
console.log(`报告里抽到动作类断言的轮次：${turnsWithClaims.length}`);
console.log(`\n动作类断言共 ${total} 条：`);
console.log(`  pass   ${tally.pass}   （证据支持）`);
console.log(`  flag   ${tally.flag}   （证据冲突：说做了、实际失败或没做）`);
console.log(`  review ${tally.review}   （证据不足，不敢下结论）`);
if (total)
  console.log(`\n可自动判定比例：(pass+flag)/total = ${(((tally.pass + tally.flag) / total) * 100).toFixed(1)}%`);

console.log('\n=== flag 实例（前 8 条，人工看一眼是不是真误报）===');
let shown = 0;
for (const t of turnsWithClaims) {
  for (const r of t.rows) {
    if (r.verdict !== 'flag' || shown >= 8)
      continue;
    shown += 1;
    console.log(`\n[${t.sid.slice(0, 16)}… turn ${t.turn}] 断言："${r.claim.raw}"  路径=${r.claim.path || '-'}`);
    console.log(`  证据：写 ${t.ev.writes.length} 条（失败 ${t.ev.writes.filter((w) => !w.ok).length}），命令 ${t.ev.commands.length} 条（失败 ${t.ev.commands.filter((c) => !c.ok).length}）`);
    if (t.ev.writes.length)
      console.log(`  近处写入：${t.ev.writes.slice(0, 2).map((w) => `${w.ok ? 'ok' : 'FAIL'} ${w.raw}`).join(' | ')}`);
  }
  if (shown >= 8)
    break;
}
