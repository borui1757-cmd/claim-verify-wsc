#!/usr/bin/env node
// 回执查看器。
//
// 用法：
//   node bin/receipts.mjs                     # 最近 10 条
//   node bin/receipts.mjs --limit 50          # 更多
//   node bin/receipts.mjs --session 21303bc2  # 按会话（id 片段即可）
//   node bin/receipts.mjs --today             # 只看今天
//   node bin/receipts.mjs --fail              # 只看含「反驳」的
//   node bin/receipts.mjs --verify            # 逐条验签
//   node bin/receipts.mjs --json              # 机器可读

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadReceipts, filterReceipts, formatReceipt, summarizeReceipts } from '../lib/receipts-view.js';
import { verifyReceipt } from '../lib/receipt.js';
import { verifyRecord, verifyChain } from '../lib/envelope.js';
import { loadOrCreateKeypair } from '../lib/signing.js';

const args = process.argv.slice(2);
const has = (n) => args.includes('--' + n);
const argOf = (n) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : undefined;
};

const FILE = process.env.CLAIM_VERIFY_RECEIPTS || path.join(os.homedir(), '.dsh', 'dsh-claim-verify', 'receipts.jsonl');
const KEY = process.env.CLAIM_VERIFY_KEY || path.join(os.homedir(), '.dsh', 'claim-verify-receipt.key');
const KEYDIR = path.dirname(FILE);

// 打印公钥后退出（分发用）
if (has('pubkey')) {
  const kp = loadOrCreateKeypair(KEYDIR);
  console.log(kp.publicKey.trim());
  console.log('# keyid=' + kp.keyid);
  process.exit(0);
}

function verifyOne(r) {
  if (r && r.envelope) {
    const kp = loadOrCreateKeypair(KEYDIR);
    return verifyRecord(r, kp.publicKey).ok;
  }
  return verifyReceipt(r, { keyPath: KEY }).ok;
}

const today = new Date();
today.setHours(0, 0, 0, 0);

const rows = filterReceipts(loadReceipts(FILE), {
  session: argOf('session'),
  since: has('today') ? today.getTime() : argOf('since'),
  limit: Number(argOf('limit') || 10),
  onlyContradicted: has('fail'),
});

if (has('json')) {
  const out = rows.map((r) => ({ ...r, verified: has('verify') ? verifyReceipt(r, { keyPath: KEY }).ok : undefined }));
  console.log(JSON.stringify({ file: FILE, summary: summarizeReceipts(rows), receipts: out }, null, 2));
  process.exit(0);
}

if (!rows.length) {
  console.log('没有匹配的回执。');
  console.log('文件：' + FILE);
  process.exit(0);
}

for (const r of rows) {
  let ok;
  if (has('verify'))
    ok = verifyOne(r);
  console.log(formatReceipt(r, { verify: ok }));
}

const t = summarizeReceipts(rows);
console.log(`\n共 ${t.receipts} 份回执 / ${t.claims} 条声明：${t.supported} 支持、${t.contradicted} 反驳、${t.insufficient} 无证据；其中 ${t.withContradiction} 份含反驳。`);
if (has('verify')) {
  console.log('（已逐条验签）');
  const chain = verifyChain(loadReceipts(FILE));
  console.log(chain.ok ? '链完整：顺序与链值一致' : '链有问题：\n  ' + chain.problems.join('\n  '));
}
