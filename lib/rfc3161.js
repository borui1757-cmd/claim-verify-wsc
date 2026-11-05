// rfc3161.js —— 给回执要一份「存在证明」：RFC 3161 时间戳。
//
// 做什么：把回执摘要（sha256）发给时间戳权威（TSA），拿回一个签名过的 TimeStampToken。
// 为什么有用：纯签名的回执只能证明"内容没被改"，不能证明"什么时候存在的"——
//            对方可以事后补签一条旧内容。时间戳把"存在时刻"钉在第三方身上。
//
// 诚实边界：
//  - 本机没有 openssl，v1 **不本地验证** TSA 签名，只存证；
//  - 外部审计方可用 `openssl ts -verify -data <digest> -in token.der` 独立验证；
//  - TSA URL 默认 freetsa（免费、无需鉴权），失败不影响回执本身。

import crypto from 'node:crypto';

const OID_SHA256 = Buffer.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
// 默认用 DigiCert（http，实测可用；freetsa 在这台机器上 fetch failed）。
// 注意：时间戳是可选步骤，失败不影响回执本身。
export const DEFAULT_TSA = 'http://timestamp.digicert.com';

function derLen(n) {
  if (n < 0x80)
    return Buffer.from([n]);
  const bytes = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function tlv(tag, content) {
  const c = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Buffer.concat([Buffer.from([tag]), derLen(c.length), c]);
}

const seq = (...parts) => tlv(0x30, Buffer.concat(parts));
const setOf = (b) => tlv(0x31, b);
function integer(buf) {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from([buf]);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80))
    b = b.subarray(1);
  if (b[0] & 0x80)
    b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
const nullDer = () => Buffer.from([0x05, 0x00]);
const boolTrue = () => Buffer.from([0x01, 0x01, 0xff]);
const octet = (b) => tlv(0x04, b);

/** 把 hex 摘要编码成 TimeStampReq（DER）。 */
export function buildRequest(digestHex, nonceBytes = 8) {
  const digest = Buffer.from(String(digestHex).replace(/[^0-9a-f]/gi, ''), 'hex');
  if (digest.length !== 32)
    throw new Error('buildRequest: 需要 32 字节的 sha256 摘要');
  const algo = seq(tlv(0x06, OID_SHA256), nullDer());
  const imprint = seq(algo, octet(digest));
  const nonce = integer(crypto.randomBytes(nonceBytes));
  return seq(integer(Buffer.from([1])), imprint, nonce, boolTrue());
}

/** 极简 DER 读取：返回 {tag, len, content, end}。 */
export function readTlv(buf, offset = 0) {
  if (offset + 2 > buf.length)
    throw new Error('DER 越界');
  const tag = buf[offset];
  let len = buf[offset + 1];
  let p = offset + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i += 1)
      len = (len << 8) | buf[p + i];
    p += n;
  }
  return { tag, len, content: buf.subarray(p, p + len), end: p + len };
}

/**
 * 解析 TimeStampResp：拿 status 和 token 是否存在。
 * @returns {{status:number, granted:boolean, hasToken:boolean, raw?:Buffer}}
 */
export function parseResponse(der) {
  const outer = readTlv(der, 0);
  if (outer.tag !== 0x30)
    throw new Error('不是 SEQUENCE，可能不是 RFC3161 响应');
  const first = readTlv(outer.content, 0); // PKIStatusInfo SEQUENCE
  if (first.tag !== 0x30)
    throw new Error('PKIStatusInfo 缺失');
  const statusTlv = readTlv(first.content, 0);
  const status = statusTlv.content.reduce((a, b) => (a << 8) | b, 0);
  const hasToken = outer.content.length > first.end;
  return { status, granted: status === 0 || status === 1, hasToken };
}

/**
 * 向 TSA 要时间戳。
 * @returns {Promise<{ok:boolean, status?:number, tokenB64?:string, url:string, reason?:string}>}
 */
export async function requestTimestamp(digestHex, { url = DEFAULT_TSA, timeoutMs = 15000 } = {}) {
  const req = buildRequest(digestHex);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/timestamp-query', 'cache-control': 'no-cache' },
      body: req,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok)
      return { ok: false, url, reason: `HTTP ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    const parsed = parseResponse(buf);
    if (!parsed.granted)
      return { ok: false, url, status: parsed.status, reason: `TSA 拒绝（status=${parsed.status}）` };
    return { ok: true, url, status: parsed.status, hasToken: parsed.hasToken, tokenB64: buf.toString('base64') };
  }
  catch (e) {
    return { ok: false, url, reason: String(e && e.message).slice(0, 120) };
  }
}
