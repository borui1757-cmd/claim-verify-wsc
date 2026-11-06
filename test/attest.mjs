// attest.mjs —— 核验 + 记忆 + 回执 的端到端可举证记录
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { attest, verifyAttestation, appendAttestation, lastDigest } from '../lib/attest.js';
import { loadOrCreateKeypair } from '../lib/signing.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-att-'));
const target = 'C:\\w\\f.txt';

// ① 成功写入 → supported，可验
const r1 = attest({ claim: { kind: 'write', target }, facts: { writes: [{ path: target, isError: false }] } }, { dir });
check('判定为 supported', r1.verdict === 'supported', r1.verdict);
check('有 digest', typeof r1.digest === 'string' && r1.digest.length === 64);
check('有签名', typeof r1.signature === 'string' && r1.signature.length > 20);
check('有链值', typeof r1.chain === 'string' && r1.chain.length === 32, `len=${r1.chain?.length}`);

const kp = loadOrCreateKeypair(dir);
const v1 = verifyAttestation(r1, { publicKey: kp.publicKey });
check('独立验证通过', v1.ok === true, JSON.stringify(v1.reasons));

// ② 篡改内容 → 验证失败
const tampered = { ...r1, verdict: 'contradicted' };
const v2 = verifyAttestation(tampered, { publicKey: kp.publicKey });
check('篡改被检出', v2.ok === false && v2.reasons.some((x) => x.includes('digest')), JSON.stringify(v2.reasons));

// ③ 失败写入 → contradicted
const r2 = attest({ claim: { kind: 'write', target }, facts: { writes: [{ path: target, isError: true }] } }, { dir, prevDigest: r1.chain });
check('失败判定为 contradicted', r2.verdict === 'contradicted', r2.verdict);
check('链接上前一条', r2.prevDigest === r1.chain);

// ④ 链不一致会被检出
const badChain = { ...r2, prevDigest: 'deadbeef' };
const v3 = verifyAttestation(badChain);
check('prevDigest 改动后链校验失败', v3.ok === false, JSON.stringify(v3.reasons));

// ⑤ 记忆只在 supported 时写入
const memFile = path.join(dir, 'memory.jsonl');
const memRows = fs.existsSync(memFile) ? fs.readFileSync(memFile, 'utf8').trim().split('\n') : [];
check('supported 写了记忆', memRows.length === 1, String(memRows.length));

// ⑥ 账本追加与 lastDigest
appendAttestation(dir, r1);
appendAttestation(dir, r2);
check('lastDigest 返回最后一条链', lastDigest(dir) === r2.chain);

// ⑦ 字段缺失的鲁棒性
const v4 = verifyAttestation({});
check('空记录不崩', v4.ok === false && v4.reasons.length > 0);
const v5 = verifyAttestation({ at: 'x', claim: {}, verdict: 'weird', facts: {}, digest: 'a', chain: 'b', signature: 'c' });
check('非法 verdict 被检出', v5.ok === false && v5.reasons.some((x) => x.includes('verdict')), JSON.stringify(v5.reasons));

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
