// selfcheck-revision.mjs —— 不重启宿主，也能验证修订层整条链路。
//
// 做法：在临时目录里**真的走一遍 llm/stream 钩子**（不是调单元函数），造两轮合成对话：
//   A 轮：工具成功 + 目标真的存在 + 认账 → 应产出 1 条原子修订
//   B 轮：工具自称成功 + 目标不存在（假成功）+ 认账 → 只能进影子，且要能生成"只认不改"的点名
// 最后用 verify-revision 的同款审计确认没有违规。
//
// 退出码：0 全过 / 1 有任何一条不符。零模型调用、零网络。
//
// 用法：node tools\selfcheck-revision.mjs [--quiet]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../lib/index.js';
import { auditRevisions, REVISIONS_FILE, SHADOW_FILE } from '../lib/revision-log.js';
import { adviseFromRevisions } from '../lib/revision-advice.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass += 1; console.log('PASS  ' + name); }
  else { fail += 1; console.log('FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-selfcheck-'));
const logFile = path.join(dir, 'hits.jsonl');
const keyFile = path.join(dir, 'key');
process.env.CLAIM_VERIFY_KEY = keyFile;

const handlers = new Map();
apply({
  on(name, fn) { handlers.set(name, fn); },
  get() { return null; },
  llm: null,
}, { logFile, receipts: true, annotate: false, sentenceAudit: false, budgetMs: 300, debug: false });

const onEvent = handlers.get('session/event');
const stream = handlers.get('llm/stream');
check('钩子已挂上（llm/stream + session/event）', Boolean(stream && onEvent));

const readJsonl = (p) => fs.existsSync(p)
  ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean)
  : [];

async function turn(tag, { target, toolOk, say }) {
  const session = { id: 'session-selfcheck-' + tag };
  const seq = { n: 0 };
  onEvent(session, { type: 'tool/call', seq: (seq.n += 1), data: { turn: 1, step: 1, callId: 'c-' + tag, name: 'write', arguments: JSON.stringify({ file_path: target }) } });
  onEvent(session, {
    type: 'tool/result', seq: (seq.n += 1),
    data: {
      turn: 1, step: 1,
      message: { role: 'tool', toolCallId: 'c-' + tag, source: { kind: 'tool', callId: 'c-' + tag }, content: [{ type: 'text', text: toolOk ? 'created' : 'created' }], isError: false },
    },
  });
  const body = [say, '```claims', JSON.stringify([{ kind: 'write', target }]), '```'].join('\n');
  const next = () => (async function* () {
    yield { type: 'text-delta', index: 0, text: body.slice(0, 12) };
    yield { type: 'text-delta', index: 0, text: body.slice(12) };
    yield { type: 'finish', reason: 'stop' };
  })();
  for await (const _ of stream({ sessionId: session.id, provider: 'p', model: 'm' }, next)) { /* drain */ }
}

// ── A 轮：目标真的存在 → 期望原子修订 ──
const real = path.join(dir, 'written.txt');
fs.writeFileSync(real, 'x', 'utf8');
await turn('A', { target: real, toolOk: true, say: '我错了，已重写并验证。' });

const revA = readJsonl(path.join(dir, REVISIONS_FILE));
check('A 轮产出原子修订', revA.length === 1, revA);
check('原子行带 txid / ack=admitted / 三时钟', Boolean(revA[0]?.txid) && revA[0]?.ack === 'admitted' && revA[0]?.tAction && revA[0]?.tClaim && revA[0]?.tVerify, revA[0]);
check('原子行有时钟顺序 tAction ≤ tClaim ≤ tVerify', (() => {
  const r = revA[0];
  if (!r) return false;
  return Date.parse(r.tAction) <= Date.parse(r.tClaim) && Date.parse(r.tClaim) <= Date.parse(r.tVerify);
})(), revA[0]);

// ── B 轮：假成功（目标不存在）→ 只能进影子，且能生成点名 ──
const ghost = path.join(dir, 'never-written.txt');
await turn('B', { target: ghost, toolOk: true, say: '我错了，这次真的写好了。' });

const revB = readJsonl(path.join(dir, REVISIONS_FILE));
const shadowB = readJsonl(path.join(dir, SHADOW_FILE));
check('B 轮没有混进原子文件', revB.length === 1, revB);
check('B 轮进了影子', shadowB.length >= 1, shadowB.length);
const ghostRow = shadowB.find((r) => String(r.claimId || '').length > 0 && r.action && r.action.ok === false);
check('假成功被记成 action.ok=false', Boolean(ghostRow), shadowB.map((r) => r.action));
check('影子行带 shadow + usable_for_verdict=false', shadowB.every((r) => r.shadow === true && r.usable_for_verdict === false), shadowB[0]);

// ── 消费端：影子里的 ackOnly 应生成"只认不改"的点名 ──
const adv = adviseFromRevisions(dir, { limit: 8 });
check('消费端生成了点名', adv.lines.length >= 1, adv.lines);
check('点名说的是"只认不改"', adv.lines.some((l) => /只认不改/.test(l)), adv.lines);

// ── 审计：整条链路无违规 ──
const audit = auditRevisions(dir);
check('审计无违规（非原子未混入 / 时钟有序 / 影子不冒充证据）', audit.ok === true, audit.violations);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
