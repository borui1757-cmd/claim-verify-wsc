// envelope.mjs —— 信封（Ed25519）+ 线性哈希链的测试
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeEnvelope, verifyEnvelope, verifyRecord, verifyChain, chainDigest, stripEnvelope } from '../lib/envelope.js';
import { loadOrCreateKeypair, keyidOf } from '../lib/signing.js';
import { canonicalJson } from '../lib/receipt.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-env-'));
const kp = loadOrCreateKeypair(dir);
const kp2 = loadOrCreateKeypair(path.join(dir, 'other'));

check('生成了 Ed25519 私钥/公钥', typeof kp.privateKey === 'string' && kp.privateKey.includes('PRIVATE KEY'));
check('keyid 是 16 位 hex', /^[0-9a-f]{16}$/.test(kp.keyid) && keyidOf(kp.publicKey) === kp.keyid);

const body = { v: 1, at: '2026-11-05T00:00:00Z', summary: { total: 1, supported: 1, contradicted: 0, insufficient: 0 }, claims: [{ verdict: 'supported' }] };
const env = makeEnvelope(body, kp);

check('信封有 payloadType/payload/signatures', env.payloadType && env.payload && Array.isArray(env.signatures) && env.signatures.length === 1);
const v = verifyEnvelope(env, kp.publicKey);
check('用对公钥验签通过', v.ok === true, JSON.stringify(v));

const wrong = verifyEnvelope(env, kp2.publicKey);
check('用错公钥验签失败', wrong.ok === false && /验签失败/.test(wrong.reason));

const tampered = JSON.parse(JSON.stringify(env));
const tb = JSON.parse(Buffer.from(tampered.payload, 'base64').toString('utf8'));
tb.summary.contradicted = 1;
tampered.payload = Buffer.from(JSON.stringify(tb)).toString('base64');
check('改 payload 后验签失败', verifyEnvelope(tampered, kp.publicKey).ok === false);

// 链：两条记录串起来
const r1 = { ...body, digest: 'digest-1', prevDigest: null };
r1.chain = chainDigest(null, r1.digest);
r1.envelope = makeEnvelope(r1, kp);
check('单条记录 verifyRecord 通过', verifyRecord(r1, kp.publicKey).ok === true, JSON.stringify(verifyRecord(r1, kp.publicKey)));

const r2 = { ...body, digest: 'digest-2', prevDigest: r1.digest };
r2.chain = chainDigest(r1.digest, r2.digest);
r2.envelope = makeEnvelope(r2, kp);
check('两条链 verifyChain 通过', verifyChain([r1, r2]).ok === true, JSON.stringify(verifyChain([r1, r2]).problems));

const swapped = [r2, r1];
check('顺序被换 → 链报错', verifyChain(swapped).ok === false);

const tamperChain = { ...r2, chain: 'deadbeef' };
check('改 chain 值 → verifyRecord 报错', verifyRecord(tamperChain, kp.publicKey).ok === false);

const legacy = { v: 1, digest: 'd', sig: 's' };
check('旧格式（无信封）→ verifyRecord 明确拒绝并提示用 HMAC', verifyRecord(legacy, kp.publicKey).ok === false && /旧格式/.test(verifyRecord(legacy, kp.publicKey).reason));
check('stripEnvelope 去掉信封', stripEnvelope(r1).envelope === undefined && canonicalJson(stripEnvelope(r1)).length > 0);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败无所谓 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
