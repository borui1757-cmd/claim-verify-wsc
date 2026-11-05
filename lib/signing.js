// signing.js —— Ed25519 签名/验签（私钥本机，公钥可分发）。
//
// 目的：让「不是我本机的人」也能验回执——私钥签名、公钥验签。
// 注意边界：签名证明"这段内容自签出后没被改过"，**不证明内容本身是真的**。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PRIV = 'claim-verify-ed25519.key.pem';
const PUB = 'claim-verify-ed25519.pub.pem';

/** 读/建密钥对；私钥 0600。返回 {privateKey, publicKey, keyid}。 */
export function loadOrCreateKeypair(dir) {
  const privPath = path.join(dir, PRIV);
  const pubPath = path.join(dir, PUB);
  try {
    const privateKey = fs.readFileSync(privPath, 'utf8');
    const publicKey = fs.readFileSync(pubPath, 'utf8');
    return { privateKey, publicKey, keyid: keyidOf(publicKey), privatePath: privPath, publicPath: pubPath };
  }
  catch { /* 不存在就生成 */ }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(pubPath, publicKey, { mode: 0o644 });
  return { privateKey, publicKey, keyid: keyidOf(publicKey), privatePath: privPath, publicPath: pubPath };
}

/** 公钥指纹（sha256 前 16 位 hex），用作 keyid。 */
export function keyidOf(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export function signEd25519(bytes, privateKeyPem) {
  return crypto.sign(null, Buffer.from(bytes), crypto.createPrivateKey(privateKeyPem)).toString('base64');
}

export function verifyEd25519(bytes, sigB64, publicKeyPem) {
  try {
    return crypto.verify(null, Buffer.from(bytes), crypto.createPublicKey(publicKeyPem), Buffer.from(String(sigB64), 'base64'));
  }
  catch {
    return false;
  }
}
