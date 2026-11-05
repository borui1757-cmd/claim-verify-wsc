#!/usr/bin/env node
// 校验 receipts.jsonl 的 AIVS 链（与 IETF draft-stone-aivs-01 同算法）。
//
// 用法：node bin/aivs-verify.mjs [--file <path>]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyAivsChain } from '../lib/aivs.js';

const args = process.argv.slice(2);
const argOf = (k) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = argOf('file') || path.join(os.homedir(), '.dsh', 'dsh-claim-verify', 'receipts.jsonl');

if (!fs.existsSync(file)) {
  console.error('找不到 ' + file);
  process.exit(2);
}
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const withAivs = rows.filter((r) => r.aivs);
console.log(`回执 ${rows.length} 条，其中带 AIVS 字段 ${withAivs.length} 条`);

const r = verifyAivsChain(rows);
if (r.ok) {
  console.log(`AIVS 链完整：${r.count} 行，head=${r.head ? r.head.slice(0, 16) : '（空）'}…`);
  process.exit(0);
}
console.log(`AIVS 链断开于 row_id=${r.brokenAt}：${r.reason || 'row_hash 不匹配'}`);
process.exit(1);
