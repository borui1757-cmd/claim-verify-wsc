// receipt-hook.mjs —— 端到端：带 ```claims 块的一轮对话，应该在 finish 时生成回执文件。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../lib/index.js';
import { verifyReceipt } from '../lib/receipt.js';
import { verifyRecord } from '../lib/envelope.js';
import { loadOrCreateKeypair } from '../lib/signing.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-receipt-hook-'));
const logFile = path.join(dir, 'hits.jsonl');
const keyPath = path.join(dir, 'key');

const handlers = new Map();
const ctx = {
  on(name, fn) { handlers.set(name, fn); },
  get() { return null; },
  llm: null,
};

process.env.CLAIM_VERIFY_KEY = keyPath;
apply(ctx, { logFile, receipts: true, annotate: false, sentenceAudit: false, budgetMs: 300, debug: false });

const onEvent = handlers.get('session/event');
const stream = handlers.get('llm/stream');
if (!stream || !onEvent) {
  console.error('FAIL 没有挂上 llm/stream 或 session/event');
  process.exit(1);
}

const session = { id: 'session-receipt-test' };
const sid = session.id;

// 轨迹：一次成功写入 + 一次失败命令
onEvent(session, { type: 'tool/call', seq: 1, data: { turn: 1, step: 1, callId: 'w1', name: 'write', arguments: JSON.stringify({ file_path: 'C:\\tmp\\a.txt' }) } });
onEvent(session, { type: 'tool/result', seq: 2, data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'w1', source: { kind: 'tool', callId: 'w1' }, content: [{ type: 'text', text: 'created' }], isError: false } } });
onEvent(session, { type: 'tool/call', seq: 3, data: { turn: 1, step: 2, callId: 'c1', name: 'pwsh', arguments: JSON.stringify({ command: 'npm test' }) } });
onEvent(session, { type: 'tool/result', seq: 4, data: { turn: 1, step: 2, message: { role: 'tool', toolCallId: 'c1', source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'FAIL' }], isError: true }, error: { name: 'CmdError' } } });

const body = [
  '做完了。',
  '```claims',
  JSON.stringify([
    { kind: 'write', target: 'C:\\tmp\\a.txt' },
    { kind: 'cmd', target: 'npm test' },
    { kind: 'write', target: 'C:\\tmp\\never.txt' },
  ]),
  '```',
].join('\n');

function next() {
  return (async function* () {
    for (const part of [body.slice(0, 10), body.slice(10)])
      yield { type: 'text-delta', index: 0, text: part };
    yield { type: 'finish', reason: 'stop' };
  })();
}

for await (const _ of stream({ sessionId: sid, provider: 'p', model: 'm' }, next)) { /* drain */ }

const receiptFile = path.join(dir, 'receipts.jsonl');
const okFile = fs.existsSync(receiptFile);
let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

check('生成了 receipts.jsonl', okFile);
if (okFile) {
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8').trim().split('\n').pop());
  check('3 条声明', receipt.summary.total === 3, JSON.stringify(receipt.summary));
  check('0 支持（单源证据按补强规则降级）', receipt.summary.supported === 0);
  check('1 反驳', receipt.summary.contradicted === 1);
  check('2 无证据（1 条本来无证据 + 1 条单源降级）', receipt.summary.insufficient === 2);
  // 新格式：带 envelope（Ed25519）就用信封验；旧格式退回 HMAC
  const envOk = receipt.envelope
    ? verifyRecord(receipt, loadOrCreateKeypair(path.dirname(logFile)).publicKey).ok
    : verifyReceipt(receipt, { keyPath }).ok;
  check('回执自验通过', envOk === true, receipt.envelope ? 'envelope' : 'hmac');
  if (receipt.envelope) {
    check('信封里的 keyid 是 16 位 hex', /^[0-9a-f]{16}$/.test(receipt.envelope.signatures[0].keyid));
    check('带链值', typeof receipt.chain === 'string' && receipt.chain.length === 32, String(receipt.chain));
  }
  check('有签名', typeof receipt.sig === 'string' && receipt.sig.length === 64);
}

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败无所谓 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
