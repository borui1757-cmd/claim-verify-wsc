#!/usr/bin/env node
// 锚定当前回执链头（外部时间戳），防整份文件被重写。
//
// 用法：
//   node bin/anchor.mjs                 # 锚定一次（默认 DigiCert）
//   node bin/anchor.mjs --verify        # 校验最近一条锚点与当前链头是否一致
//   node bin/anchor.mjs --url <tsa>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anchorChain, appendAnchor, verifyAnchor } from '../lib/anchor.js';

const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : undefined;
};

const dir = path.join(os.homedir(), '.dsh', 'dsh-claim-verify');
const receiptsFile = path.join(dir, 'receipts.jsonl');
const anchorsFile = path.join(dir, 'anchors.jsonl');

const readReceipts = () => {
  try {
    const raw = fs.readFileSync(receiptsFile, 'utf8').trim();
    return raw ? raw.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  }
  catch { return []; }
};

if (args.includes('--verify')) {
  const rows = fs.existsSync(anchorsFile)
    ? fs.readFileSync(anchorsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    : [];
  if (!rows.length) {
    console.log('还没有锚点。先跑 node bin/anchor.mjs');
    process.exit(0);
  }
  const last = rows[rows.length - 1];
  const r = verifyAnchor(last, readReceipts());
  console.log(r.ok
    ? `锚点一致：head=${last.head.slice(0, 16)}…（${last.at}，${last.count} 条回执）`
    : `锚点不一致：${r.reason}\n  期望（锚点里）: ${last.head.slice(0, 16)}…\n  当前: ${r.current?.slice(0, 16)}…`);
  process.exit(r.ok ? 0 : 1);
}

const record = await anchorChain(receiptsFile, { tsaUrl: argOf('url') });
appendAnchor(anchorsFile, record);
if (record.ok) {
  console.log(`锚定成功：head=${record.head.slice(0, 16)}…  ${record.count} 条回执  时间戳 ${record.tokenB64?.length || 0} 字符`);
  console.log('已写入 ' + anchorsFile);
}
else {
  console.log('锚定失败：' + record.reason + '（锚点记录已保留，便于重试）');
  process.exit(1);
}
