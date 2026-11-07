// revision.js —— 原子修订（revision/v2）：把「认 + 改 + 证据」绑成一个事务。
//
// 移植自 Desktop\relational-proto\revision.mjs（只读参考，不 import），2026-11-07。
// 背景（docs/HANDOFF-2026-11-07-原子修订.md 实测）：37 条 claim 里 txid 7/37、
// 三时钟 0/37、tAction 0/37 —— 结构上表达不了原子修订，于是
// 「认了没改」（顺从型认罪）与「改了没认」（静默变更）无法区分。
//
// 规则（照抄参考实现，别自作聪明放宽）：
//   1. 一次修订 = 一条记录，含 ack + action + evidence + txid + 三个时刻。
//   2. 任一缺失 → 抛错，**一个字节都不写**（all-or-nothing 在入口完成，不靠回滚）。
//   3. 时钟必须有序：tAction ≤ tClaim ≤ tVerify —— 违反即「时钟不可信」，拒绝落盘。
//   4. 只有 ack 为 admitted 才算「认」。denied / unclear 不构成修订事务。
//
// 兼容：v1 回执没有这些字段，用 toV2() 标 legacy:true，不伪造数据。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SCHEMA = 'revision/v2';
export const ACK_VALUES = ['admitted', 'denied', 'unclear'];
const ACK_SET = new Set(ACK_VALUES);
export const REQUIRED_CLOCKS = ['tAction', 'tClaim', 'tVerify'];

function assert(cond, msg) {
  if (!cond)
    throw new Error('revision: ' + msg);
}

const ms = (v) => {
  const t = Date.parse(v);
  assert(Number.isFinite(t), `时间不可解析：${v}`);
  return t;
};

/** 同一内容 → 同一 txid（内容定地址，重复提交同号）。 */
export function txidOf(body) {
  const pick = {
    claimId: body.claimId ?? null,
    ack: body.ack ?? null,
    action: body.action ?? null,
    evidence: body.evidence ?? null,
    tAction: body.tAction ?? null,
    tClaim: body.tClaim ?? null,
    tVerify: body.tVerify ?? null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(pick)).digest('hex').slice(0, 16);
}

/** 校验并规范化一条修订；不合法直接抛错。 */
export function makeRevision({ claimId, ack, action, evidence, tAction, tClaim, tVerify }) {
  assert(typeof claimId === 'string' && claimId, 'claimId 必填');
  assert(ACK_SET.has(ack), `ack 必须是 ${ACK_VALUES.join('|')}`);
  assert(action && typeof action.type === 'string', 'action.type 必填');
  assert(typeof action.ok === 'boolean', 'action.ok 必须是布尔');
  assert(evidence && typeof evidence.callId === 'string' && evidence.callId, 'evidence.callId 必填');
  assert(typeof evidence.tool === 'string' && evidence.tool, 'evidence.tool 必填');

  const clocks = { tAction, tClaim, tVerify };
  for (const k of REQUIRED_CLOCKS)
    assert(typeof clocks[k] === 'string' && clocks[k], `缺少时刻 ${k}`);

  const [ta, tc, tv] = [ms(tAction), ms(tClaim), ms(tVerify)];
  assert(ta <= tc, `时钟倒序：tAction(${tAction}) 晚于 tClaim(${tClaim})`);
  assert(tc <= tv, `时钟倒序：tClaim(${tClaim}) 晚于 tVerify(${tVerify})`);

  const body = { claimId, ack, action, evidence, tAction, tClaim, tVerify };
  return { schema: SCHEMA, txid: txidOf(body), ...body };
}

/** 原子落盘：校验通过才写，且只写一行。 */
export function commit(file, rev) {
  const record = makeRevision(rev); // 校验在写之前
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n'); // 单次 append，不拼接
  return record;
}

/** 原子性谓词：四项齐备且认了，才算一次合法修订。 */
export function isAtomic(r) {
  return Boolean(r)
    && r.schema === SCHEMA
    && r.ack === 'admitted'
    && r.action && r.action.ok === true
    && r.evidence && r.evidence.callId
    && r.txid
    && REQUIRED_CLOCKS.every((k) => typeof r[k] === 'string');
}

/** 审计一份 jsonl：区分原子 / 只认不改 / 只改不认 / 无事务 / legacy / 不完整。 */
export function audit(file) {
  const out = { total: 0, atomic: 0, ackOnly: 0, actOnly: 0, none: 0, legacy: 0, incomplete: 0, clockViolations: 0, rows: [] };
  if (!fs.existsSync(file))
    return out;
  for (const line of fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)) {
    let r;
    try { r = JSON.parse(line); }
    catch { continue; }
    out.total += 1;
    if (r.legacy || r.schema !== SCHEMA) { out.legacy += 1; continue; }
    const hasAllClocks = REQUIRED_CLOCKS.every((k) => typeof r[k] === 'string' && r[k]);
    if (!hasAllClocks) {
      out.incomplete += 1; // 缺时刻 = 不完整，**不是**时钟倒序
    }
    else {
      const [ta, tc, tv] = [Date.parse(r.tAction), Date.parse(r.tClaim), Date.parse(r.tVerify)];
      if (!(ta <= tc && tc <= tv))
        out.clockViolations += 1;
    }
    if (isAtomic(r))
      out.atomic += 1;
    else if (r.ack === 'admitted' && !(r.action && r.action.ok))
      out.ackOnly += 1;
    else if (!(r.ack === 'admitted') && r.action && r.action.ok)
      out.actOnly += 1;
    else
      out.none += 1;
    out.rows.push({ txid: r.txid, ack: r.ack, ok: r.action?.ok, atomic: isAtomic(r) });
  }
  return out;
}

/** v1 → v2 迁移：只标 legacy，不编造缺失值。 */
export function toV2(claim) {
  return { ...claim, schema: SCHEMA, legacy: true, ack: null, txid: null };
}
