// receipt.mjs —— 「结构化声明 + 证据回执」的离线测试（不联网、不调模型）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildReceipt, verifyReceipt, judgeDeclaredClaims, extractClaimsBlock } from '../lib/receipt.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const mk = (name, args, { isError = false, resultSeen = true, text = 'ok', callId = 'c1', turn = 1 } = {}) => ({
  name, callId, turn, args, isError, resultSeen, text,
});

// 1. 写文件：成功 / 失败 / 无证据
const pairs = [
  mk('write', { file_path: 'C:\\Users\\x\\a.txt', content: '1' }, { callId: 'w1' }),
  mk('write', { file_path: 'C:\\Users\\x\\b.txt', content: '1' }, { callId: 'w2', isError: true, text: 'EACCES' }),
];
const r1 = judgeDeclaredClaims([
  { kind: 'write', target: 'C:/Users/x/a.txt' },
  { kind: 'write', target: 'C:\\Users\\x\\b.txt' },
  { kind: 'write', target: 'C:\\Users\\x\\missing.txt' },
], pairs);
check('单源写入 → insufficient（补强证据规则）', r1[0]?.verdict === 'insufficient', JSON.stringify(r1[0]));
check('单源写入带 independent=1', r1[0]?.independent === 1, r1[0]?.independent);
check('失败的写入 → contradicted', r1[1]?.verdict === 'contradicted', JSON.stringify(r1[1]));
check('没调用过 → insufficient', r1[2]?.verdict === 'insufficient');

// 1b. 两个独立调用支持同一断言 → supported
const pairs2 = [
  mk('write', { file_path: 'C:\\Users\\x\\c.txt', content: '1' }, { callId: 'w3' }),
  mk('write', { file_path: 'C:\\Users\\x\\c.txt', content: '1' }, { callId: 'w4' }),
];
const r1b = judgeDeclaredClaims([{ kind: 'write', target: 'C:\\Users\\x\\c.txt' }], pairs2);
check('两个独立来源 → supported', r1b[0]?.verdict === 'supported', JSON.stringify(r1b[0]));
check('independent=2', r1b[0]?.independent === 2, r1b[0]?.independent);

// 2. 命令：成功 / 失败
const r2 = judgeDeclaredClaims([
  { kind: 'cmd', target: 'npm test' },
], [mk('pwsh', { command: 'npm test' }, { isError: true, text: 'exit 1' })]);
check('命令失败 → contradicted', r2[0]?.verdict === 'contradicted');

// 3. 回执：摘要稳定 + 签名可验 + 篡改可发现
const keyPath = path.join(os.tmpdir(), 'cv-receipt-test-' + Date.now() + '.key');
const args = { sessionId: 's1', claims: [{ kind: 'write', target: 'C:\\Users\\x\\a.txt' }], pairs, at: '2026-11-05T00:00:00.000Z', keyPath };
const a = buildReceipt(args);
const b = buildReceipt(args);
check('同输入 → 同摘要', a.digest === b.digest);
check('签名存在', typeof a.sig === 'string' && a.sig.length === 64);
check('验签通过', verifyReceipt(a, { keyPath }).ok === true);
const tampered = JSON.parse(JSON.stringify(a));
tampered.claims[0].verdict = 'contradicted';
const v = verifyReceipt(tampered, { keyPath });
check('篡改 verdict → 验签失败', v.ok === false, JSON.stringify(v));

// 4. 声明块解析
const block = '做完如下：\n```claims\n[{"kind":"cmd","target":"npm test"}]\n```\n以上。';
check('能从 ```claims 块解析声明', Array.isArray(extractClaimsBlock(block)) && extractClaimsBlock(block).length === 1);
check('没有声明块 → null', extractClaimsBlock('纯文本，没有代码块') === null);

try { fs.unlinkSync(keyPath); } catch { /* 清理失败无所谓 */ }
// 2026-11-07：原子修订的四个键 + 三个时间戳（来自另一个会话的诊断）
const atomic = buildReceipt({
  sessionId: 'session-atomic-test',
  claims: [{ kind: 'write', target: 'C:\\Users\\x\\a.txt' }],
  pairs: [mk('write', { file_path: 'C:\\Users\\x\\a.txt', content: '1' }, { callId: 'w1' })],
  keyPath: null,
  clocks: { tAction: Date.now() - 60000, tClaim: Date.now() - 30000 },
});
check('回执带三时钟', Boolean(atomic.clocks && atomic.clocks.tAction && atomic.clocks.tClaim && atomic.clocks.tVerify), atomic.clocks);
check('claim 带 txid', typeof atomic.claims[0].txid === 'string' && atomic.claims[0].txid.length > 3, atomic.claims[0].txid);
check('claim 带 ack 字段（默认 false，不伪造）', atomic.claims[0].ack === false);
check('claim 带 tClaim/tAction/tVerify', Boolean(atomic.claims[0].tClaim && atomic.claims[0].tAction && atomic.claims[0].tVerify));
check('三个时刻互不相同', new Set([atomic.claims[0].tAction, atomic.claims[0].tClaim, atomic.claims[0].tVerify]).size === 3);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
