#!/usr/bin/env node
// 证据回执命令行：把「结构化声明 + 工具轨迹」变成一份可验签的回执。
//
// 用法：
//   node bin/receipt.mjs --claims claims.json --pairs pairs.json --out receipt.json
//   node bin/receipt.mjs --verify receipt.json        # 校验摘要与签名
//
// claims.json 形如：[{"kind":"write","target":"C:\\a.txt"},{"kind":"cmd","target":"npm test"}]
// pairs.json  形如：[{"name":"write","callId":"w1","args":{"file_path":"C:\\a.txt"},"isError":false,"resultSeen":true,"text":"ok"}]

import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildReceipt, verifyReceipt } from '../lib/receipt.js';

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const KEY = process.env.CLAIM_VERIFY_KEY || path.join(os.homedir(), '.dsh', 'claim-verify-receipt.key');

if (args.includes('--verify')) {
  const file = argOf('--verify');
  const receipt = JSON.parse(readFileSync(file, 'utf8'));
  const r = verifyReceipt(receipt, { keyPath: KEY });
  console.log(r.ok ? '回执有效' : '回执无效：' + r.reason);
  process.exit(r.ok ? 0 : 1);
}

const claimsFile = argOf('--claims');
const pairsFile = argOf('--pairs');
if (!claimsFile || !pairsFile) {
  console.error('用法：node bin/receipt.mjs --claims <claims.json> --pairs <pairs.json> [--out <receipt.json>]');
  process.exit(2);
}

const claims = JSON.parse(readFileSync(claimsFile, 'utf8'));
const pairs = JSON.parse(readFileSync(pairsFile, 'utf8'));
const receipt = buildReceipt({
  sessionId: argOf('--session') || 'cli',
  claims: Array.isArray(claims) ? claims : claims.claims,
  pairs,
  keyPath: KEY,
});
const out = argOf('--out');
if (out)
  writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt.summary));
console.log('digest=' + receipt.digest.slice(0, 16) + '…  sig=' + String(receipt.sig).slice(0, 16) + '…');
if (out)
  console.log('已写入 ' + out);
process.exit(receipt.summary.contradicted ? 1 : 0);
