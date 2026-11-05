// structural-audit.mjs —— 结构对账应当在 sentenceAudit=false 时也跑（零模型调用）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../lib/index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-structural-'));
const logFile = path.join(dir, 'hits.jsonl');

const handlers = new Map();
const ctx = { on(n, f) { handlers.set(n, f); }, get() { return null; }, llm: null };
apply(ctx, { logFile, sentenceAudit: false, structuralAudit: true, annotate: false, budgetMs: 300, debug: false });

const onEvent = handlers.get('session/event');
const stream = handlers.get('llm/stream');

const session = { id: 'session-structural-test' };
const sid = session.id;

// 一次失败的命令（测试命令），报告却说"测试通过"
onEvent(session, { type: 'tool/call', seq: 1, data: { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: JSON.stringify({ command: 'npm test' }) } });
onEvent(session, { type: 'tool/result', seq: 2, data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1', content: [{ type: 'text', text: 'FAIL 2 tests failed' }], isError: true }, error: { name: 'CmdError' } } });

const body = '做完了，测试已通过，可以直接发布。';
function next() {
  return (async function* () {
    yield { type: 'text-delta', index: 0, text: body };
    yield { type: 'finish', reason: 'stop' };
  })();
}

for await (const _ of stream({ sessionId: sid, provider: 'p', model: 'm' }, next)) { /* drain */ }
// scheduleAudit 是 fire-and-forget，等一拍
await new Promise((r) => setTimeout(r, 1500));

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const auditFile = path.join(dir, 'audit.jsonl');
check('生成了 audit.jsonl', fs.existsSync(auditFile));
const casesFile = path.join(dir, 'cases.jsonl');
check('生成了 cases.jsonl（可离线重放）', fs.existsSync(casesFile));
if (fs.existsSync(casesFile)) {
  const c = JSON.parse(fs.readFileSync(casesFile, 'utf8').trim().split('\n').pop());
  check('案例里存了报告与证据', typeof c.report === 'string' && Array.isArray(c.pairs) && c.pairs.length >= 1, JSON.stringify({ len: c.report?.length, pairs: c.pairs?.length }));
}
if (fs.existsSync(auditFile)) {
  const rows = fs.readFileSync(auditFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = rows[rows.length - 1];
  check('mode 是 structural', last.mode === 'structural', JSON.stringify(last.mode));
  check('抓到「测试通过 vs 命令失败」', (last.counts.contradicted || 0) >= 1, JSON.stringify(last.counts));
}

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败无所谓 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
