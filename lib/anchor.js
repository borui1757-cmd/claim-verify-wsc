// anchor.js —— 链头外部锚定：防"把整份回执文件重写一遍"。
//
// 做法：取当前链头（所有回执摘要的累积哈希）→ 丢给 RFC3161 时间戳权威盖章 → 记进 anchors.jsonl。
// 这样即使有人改写了 receipts.jsonl，外部时间戳也证明"旧链头在某个时刻确实存在过"。
//
// 边界：锚定的是**链头存在性**，不是内容真实性；验证锚点需要 TSA 证书链（本机无 openssl，v1 存证）。

import fs from 'node:fs';
import crypto from 'node:crypto';
import { requestTimestamp } from './rfc3161.js';
import { canonicalJson } from './policy.js';

/** 从回执数组算链头：sha256(所有 digest 拼接)。缺失 digest 的条目跳过。 */
export function chainHead(receipts) {
  const digests = (receipts || []).map((r) => r && r.digest).filter((d) => typeof d === 'string');
  return crypto.createHash('sha256').update(digests.join('|')).digest('hex');
}

/**
 * 锚定当前链头。
 * @param {string} receiptsFile
 * @param {{tsaUrl?:string, now?:()=>string, stampFn?:(head:string)=>Promise<object>}} opts
 */
export async function anchorChain(receiptsFile, opts = {}) {
  const raw = fs.readFileSync(receiptsFile, 'utf8').trim();
  const receipts = raw ? raw.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const head = chainHead(receipts);
  const stampFn = opts.stampFn || ((h) => requestTimestamp(h, opts.tsaUrl ? { url: opts.tsaUrl } : {}));
  const stamped = await stampFn(head);
  return {
    at: (opts.now ? opts.now() : new Date().toISOString()),
    head,
    count: receipts.length,
    ok: stamped.ok === true,
    status: stamped.status ?? null,
    url: stamped.url ?? null,
    tokenB64: stamped.tokenB64 ?? null,
    reason: stamped.reason ?? null,
  };
}

/** 把锚点追加到 anchors.jsonl。 */
export function appendAnchor(file, record) {
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
}

/** 校验：某条锚点的 head 是否等于给定回执数组现在的链头。 */
export function verifyAnchor(anchor, receipts) {
  if (!anchor || typeof anchor.head !== 'string')
    return { ok: false, reason: '锚点里没有 head' };
  const current = chainHead(receipts);
  return current === anchor.head
    ? { ok: true }
    : { ok: false, reason: '链头已变（回执文件被改动或追加过）', current };
}
