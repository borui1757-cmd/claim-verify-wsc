#!/usr/bin/env node
// 给某条回执要一份 RFC 3161 时间戳（存在证明）。
//
// 用法：
//   node bin/timestamp.mjs --last            # 给回执文件最后一条盖章
//   node bin/timestamp.mjs --digest <hex>    # 给指定摘要盖章
//   node bin/timestamp.mjs --last --url https://freetsa.org/tsr
//
// 结果追加到 ~/.dsh/dsh-claim-verify/timestamps.jsonl；token 可交给外部审计方
// 用 openssl ts -verify 独立验证（本机没 openssl，v1 只存证不本地验签）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestTimestamp, DEFAULT_TSA } from '../lib/rfc3161.js';

const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : undefined;
};

const dir = path.join(os.homedir(), '.dsh', 'dsh-claim-verify');
const receiptsFile = path.join(dir, 'receipts.jsonl');
const outFile = path.join(dir, 'timestamps.jsonl');
const url = argOf('url') || DEFAULT_TSA;

let digest = argOf('digest');
if (!digest && args.includes('--last')) {
  const rows = fs.readFileSync(receiptsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  digest = rows[rows.length - 1].digest;
}
if (!digest) {
  console.error('用法：node bin/timestamp.mjs --last | --digest <sha256hex> [--url <tsa>]');
  process.exit(2);
}

const r = await requestTimestamp(digest, { url });
const line = {
  at: new Date().toISOString(),
  digest,
  url,
  ok: r.ok,
  status: r.status ?? null,
  tokenB64: r.tokenB64 ?? null,
  reason: r.reason ?? null,
};
fs.appendFileSync(outFile, JSON.stringify(line) + '\n');

if (r.ok) {
  console.log(`盖章成功：digest=${digest.slice(0, 16)}…  status=${r.status}  token=${(r.tokenB64 || '').length} 字符`);
  console.log('已写入 ' + outFile);
}
else {
  console.log(`盖章失败：${r.reason}`);
  console.log('（回执本身不受影响；可以换 --url 重试）');
  process.exit(1);
}
