// attest.js —— 把「核验 + 记忆 + 回执」合成一条可举证的记录
//
// 目的（结合点②：回执 + 合规审计）：
//   agent 说"我做了 X"，我们给出一条**外部可独立验证**的记录：
//     · 判定：supported / contradicted / insufficient（来自确定性核验）
//     · 事实：当时的 actual / expected（成对字段）
//     · 记忆：这条事实写入真值记忆（供后续引用）
//     · 回执：Ed25519 签名 + 哈希链（可验、可排序、可追责）
//
// 关键原则：**记录不证明模型诚实，只证明"当时系统看到什么"**。

import fs from 'node:fs';
import path from 'node:path';
import { adjudicateStructured } from './adapter.js';
import { makeMemory } from './memory.js';
import { canonicalJson, sha256Hex, ensureKey } from './receipt.js';
import { loadOrCreateKeypair, keyidOf, signEd25519, verifyEd25519 } from './signing.js';
import { makeEnvelope, verifyEnvelope, chainDigest } from './envelope.js';

/**
 * 生成一条可举证的断言记录。
 * @param {{claim:{kind:string,target?:string}, facts:object}} input
 * @param {{dir:string, prevDigest?:string|null}} opts
 */
export function attest({ claim, facts }, { dir, prevDigest = null } = {}) {
  if (!dir)
    throw new Error('需要 dir（存放密钥与账本）');
  fs.mkdirSync(dir, { recursive: true });

  // ① 确定性判定
  const { verdict, detail } = adjudicateStructured(facts, claim);

  // ② 事实摘要（成对字段）
  const w = (facts.writes || [])[0];
  const t = facts.tests;
  const factsBrief = {
    kind: claim.kind,
    target: claim.target ?? null,
    actual: w ? (w.isError ? 'error' : 'ok') : (t ? t.passed : null),
    expected: w ? 'ok' : (t ? true : null),
    detail,
  };

  // ③ 记忆（只记 supported 的事实）
  const mem = makeMemory(path.join(dir, 'memory.jsonl'));
  if (verdict === 'supported') {
    try {
      mem.set({
        key: String(claim.target ?? claim.kind),
        value: factsBrief.actual,
        source: 'os',
        scope: 'project',
      });
    }
    catch { /* 记忆失败不影响回执 */ }
  }

  // ④ 回执（签名 + 链）
  const kp = loadOrCreateKeypair(dir);
  const body = {
    v: 1,
    at: new Date().toISOString(),
    claim: { kind: claim.kind, target: claim.target ?? null },
    verdict,
    facts: factsBrief,
    prevDigest,
  };
  const digest = sha256Hex(canonicalJson(body));
  const chain = chainDigest(prevDigest, digest);
  const signature = signEd25519(canonicalJson({ ...body, digest, chain }), kp.privateKey);
  const envelope = makeEnvelope({ ...body, digest, chain }, kp);

  return {
    ...body,
    digest,
    chain,
    signature,
    keyid: kp.keyid,
    envelope,
  };
}

/**
 * 独立验证一条记录（不需要信任生成方）。
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function verifyAttestation(record, { publicKey } = {}) {
  const reasons = [];
  if (!record || typeof record !== 'object')
    return { ok: false, reasons: ['记录为空'] };

  for (const f of ['at', 'claim', 'verdict', 'facts', 'digest', 'chain', 'signature'])
    if (record[f] === undefined)
      reasons.push(`缺少字段 ${f}`);

  if (reasons.length)
    return { ok: false, reasons };

  // 重算 digest
  const body = {
    v: record.v ?? 1,
    at: record.at,
    claim: record.claim,
    verdict: record.verdict,
    facts: record.facts,
    prevDigest: record.prevDigest ?? null,
  };
  const recomputed = sha256Hex(canonicalJson(body));
  if (recomputed !== record.digest)
    reasons.push('digest 不匹配（内容被改动）');

  // 验签
  if (publicKey) {
    const ok = verifyEd25519(
      canonicalJson({ ...body, digest: record.digest, chain: record.chain }),
      record.signature,
      publicKey,
    );
    if (!ok)
      reasons.push('签名无效');
  }

  // 链一致性
  const chain = chainDigest(record.prevDigest ?? null, record.digest);
  if (chain !== record.chain)
    reasons.push('链摘要不匹配');

  // 三分类合法性
  if (!['supported', 'contradicted', 'insufficient'].includes(record.verdict))
    reasons.push('verdict 非法');

  return { ok: reasons.length === 0, reasons };
}

/** 追加到账本（JSONL） */
export function appendAttestation(dir, record) {
  const file = path.join(dir, 'attestations.jsonl');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
  return file;
}

/** 读账本里的最后一条链摘要 */
export function lastDigest(dir) {
  const file = path.join(dir, 'attestations.jsonl');
  if (!fs.existsSync(file))
    return null;
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  if (!lines.length)
    return null;
  try { return JSON.parse(lines[lines.length - 1]).chain || null; } catch { return null; }
}
