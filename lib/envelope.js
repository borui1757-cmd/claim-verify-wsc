// envelope.js —— 用「标准形状的信封」装回执，而不是裸 JSON + 一个 sig 字段。
//
// 形状对齐 DSSE / SCITT 的 Signed Statement：
//   { payloadType, payload(base64), signatures: [{ keyid, sig(base64) }] }
// 好处：别人不用读我们的实现，就能按标准验；后续要接透明度日志也省得改格式。
//
// 另加一条**线性哈希链**：每条回执带 prevDigest，串起来能证明"没被插队/倒填"。
// 这不是完整的 Merkle 日志，但足以为本地证据提供顺序保证。

import crypto from 'node:crypto';
import { sha256Hex, canonicalJson } from './receipt.js';
import { signEd25519, verifyEd25519, keyidOf } from './signing.js';

export const PAYLOAD_TYPE = 'application/vnd.claim-verify.receipt+json';

/**
 * 造信封。
 * @param {object} body  回执正文（不含 digest/sig）
 * @param {{privateKey:string, publicKey:string}} keypair
 */
export function makeEnvelope(body, keypair) {
  const payloadBytes = Buffer.from(canonicalJson(body), 'utf8');
  const payload = payloadBytes.toString('base64');
  const sig = signEd25519(payloadBytes, keypair.privateKey);
  return {
    payloadType: PAYLOAD_TYPE,
    payload,
    signatures: [{ keyid: keyidOf(keypair.publicKey), sig }],
  };
}

/**
 * 验信封。
 * @returns {{ok:boolean, reason?:string, body?:object, keyid?:string}}
 */
export function verifyEnvelope(envelope, publicKeyPem) {
  if (!envelope || typeof envelope !== 'object')
    return { ok: false, reason: '信封不是对象' };
  if (envelope.payloadType !== PAYLOAD_TYPE)
    return { ok: false, reason: 'payloadType 不认识：' + String(envelope.payloadType) };
  const sigEntry = Array.isArray(envelope.signatures) ? envelope.signatures[0] : null;
  if (!sigEntry || typeof sigEntry.sig !== 'string')
    return { ok: false, reason: '没有签名' };
  let bytes;
  try {
    bytes = Buffer.from(String(envelope.payload), 'base64');
  }
  catch {
    return { ok: false, reason: 'payload 不是合法 base64' };
  }
  if (!verifyEd25519(bytes, sigEntry.sig, publicKeyPem))
    return { ok: false, reason: '验签失败（内容改过，或不是这把公钥）' };
  try {
    return { ok: true, body: JSON.parse(bytes.toString('utf8')), keyid: sigEntry.keyid };
  }
  catch {
    return { ok: false, reason: 'payload 不是 JSON' };
  }
}

/** 去掉 envelope 字段后的记录（签名对象）。 */
export function stripEnvelope(record) {
  const { envelope, ...rest } = record || {};
  return rest;
}

/**
 * 校验一条完整记录：信封签名 + 链值。
 * @returns {{ok:boolean, reason?:string}}
 */
export function verifyRecord(record, publicKeyPem) {
  if (!record || typeof record !== 'object')
    return { ok: false, reason: '记录不是对象' };
  if (!record.envelope)
    return { ok: false, reason: '没有信封（旧格式回执，请用 HMAC 验）' };
  const env = verifyEnvelope(record.envelope, publicKeyPem);
  if (!env.ok)
    return env;
  const signed = stripEnvelope(record);
  // 信封里的 payload 应与去掉 envelope 后的记录一致
  if (canonicalJson(env.body) !== canonicalJson(signed))
    return { ok: false, reason: '信封里的内容与记录不一致' };
  const wantChain = chainDigest(record.prevDigest, record.digest);
  if (record.chain !== wantChain)
    return { ok: false, reason: '链值不符（被改过或顺序不对）' };
  return { ok: true };
}

/** 链值：把上一条的摘要混进来，形成线性链。 */
export function chainDigest(prevDigest, digest) {
  return sha256Hex(String(prevDigest || '') + '|' + String(digest || '')).slice(0, 32);
}

/**
 * 校验整条链（按 receipts.jsonl 的顺序）。
 * @param {Array} receipts 按写入顺序
 * @param {{publicKey?:string, verifyFn?:(env:object)=>boolean}} opts
 */
export function verifyChain(receipts, opts = {}) {
  const problems = [];
  let prev = null;
  receipts.forEach((r, i) => {
    const body = r && r.body ? r.body : r;
    const digest = body && body.digest;
    if (!digest) {
      problems.push(`#${i}: 没有 digest`);
      return;
    }
    const wantChain = chainDigest(prev, digest);
    // 旧格式记录没有 chain 字段（prevDigest 恒为 null）：跳过链校验，但仍计入前一条摘要
    if (body.chain === undefined || body.prevDigest === null) {
      prev = digest;
      return;
    }
    if (body.chain && body.chain !== wantChain)
      problems.push(`#${i}: 链值不符（顺序被改过或插入了新记录）`);
    if (body.prevDigest !== undefined && body.prevDigest !== prev)
      problems.push(`#${i}: prevDigest 不符`);
    prev = digest;
  });
  return { ok: problems.length === 0, problems };
}
