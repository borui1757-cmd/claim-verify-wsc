// revision-log.js —— 三个埋点接进回执：认账 + 动作 + 证据 + 三时钟 → 原子修订。
//
// 移植自 Desktop\relational-proto\recorder.mjs + shadow.mjs（只读参考，不 import），2026-11-07。
//
// 分流规则（这是整个模块的骨头）：
//   ① 四项齐备且 ack=admitted 且动作成功 → commit 进 `revisions.jsonl`（原子，可用于判决）
//   ② 任何一项不齐 → 只进 `revisions-shadow.jsonl`，带 shadow:true + usable_for_verdict:false
//      **缺的字段一律 null，绝不猜值**（v1 里没有的就是没有）
//
// 为什么不在原文件里判：影子期要先量出"还差哪几个字段"，量准了再收紧。参考实现踩过的坑：
//   - console.assert 失败不抛错 → 这里全部自己抛
//   - null 时钟被当"倒序" → 走 incomplete，不是 violation
//   - 认罪措辞窄正则必漏 → ADMIT_RE 收"技术性认定失败"（无法证明已落盘 / 需重试）

import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA, commit, isAtomic, audit, txidOf, REQUIRED_CLOCKS } from './revision.js';

// 认罪：包含"技术性认定失败"——只说"未落盘"不说"我错了"也算认。
const ADMIT_RE = /(?:我(?:刚才|上一条|之前)?(?:说|写|判断|看|报)?错|错在|是我(?:的)?错|我错了|确实(?:是|不是|没)|抱歉|对不起|更正|纠正|我收回|说得不对|写得不对|判断有误|我看错|未真正落盘|没有落盘|未落盘|写入失败|没能写入|没有写入|需重试|无法(?:确认|证明|核实|验证)[^，。]{0,12}(?:落盘|写入|成功)|不能声称(?:写入)?成功)/;
// 辩护：路径语义 / 工具回执 / 我确认它存在
const DENY_RE = /(?:相对路径|绝对路径|路径语义|工具(?:报|返回)(?:了)?成功|我读到的是|我确认(?:它|该文件)?(?:确实)?存在|文件(?:确实|的确)存在|口径(?:不同|不一致)|环境不同|不是同一个)/;

export const REVISIONS_FILE = 'revisions.jsonl';
export const SHADOW_FILE = 'revisions-shadow.jsonl';

/** 从回复文本判定认/不认；必须带命中的规则，否则标签错了永远查不出来。 */
export function classifyAck(text) {
  const t = String(text || '');
  if (!t)
    return { ack: 'unclear', evidence: 'empty' };
  const a = t.match(ADMIT_RE);
  if (a)
    return { ack: 'admitted', evidence: 'admit:' + a[0] };
  const d = t.match(DENY_RE);
  if (d)
    return { ack: 'denied', evidence: 'deny:' + d[0] };
  return { ack: 'unclear', evidence: 'no-match' };
}

/** 从回执里的一条 claim 取出"动作 + 证据"。
 *
 * "改了" 分两层判：
 *   ① 工具自称成功（isError===false && resultSeen===true）—— 这只是必要条件；
 *   ② **动作留下可观测痕迹**（写类 claim → 目标路径真的存在）。
 * 只做 ① 会把「工具返回 ok、文件没落地」这种假成功记成原子修订 ——
 * 那正是本插件存在的理由，原子修订里不能留这个洞。
 * 两个字段缺一就判不成功，不猜。
 */
function actionOf(claim) {
  const kind = claim && claim.claim && claim.claim.kind;
  if (!kind)
    return { action: null, evidence: null, why: 'no-action' };
  const ev = (claim && claim.evidence) || {};
  if (!ev.callId)
    return { action: null, evidence: null, why: 'no-evidence' };

  const toolSaidOk = ev.isError === false && ev.resultSeen === true;
  const target = claim?.claim?.target ? String(claim.claim.target) : '';
  const isWrite = kind === 'write' || /^write/.test(String(ev.tool || '')) || /write_file|edit/.test(String(ev.tool || ''));

  let observed = null;
  if (isWrite && target) {
    try {
      observed = fs.existsSync(path.resolve(target));
    }
    catch {
      observed = null; // 路径不可解析 → 观测不到，不当作成功
    }
  }

  const ok = toolSaidOk && (observed === null ? !isWrite : observed);
  return {
    action: { type: String(kind), ok, ...(observed === null ? {} : { observed }) },
    evidence: { tool: String(ev.tool || ''), callId: String(ev.callId || ''), digest: ev.resultDigest || null },
    why: null,
  };
}

/**
 * 把一条 claim 变成 v2 候选；不合法就返回 shadow 候选（带原因），不抛。
 * @returns {{kind:'atomic'|'shadow', record:object, reason?:string}}
 */
export function revisionFromClaim({ receipt, claim, index = 0, ackText, tAction, tClaim, tVerify }) {
  const { action, evidence, why } = actionOf(claim);
  const ackInfo = ackText === undefined ? { ack: null, evidence: 'not-provided' } : classifyAck(ackText);
  const body = {
    claimId: String((claim && claim.txid) || `${receipt?.digest || 'r'}-${index}`),
    ack: ackInfo.ack,
    action,
    evidence,
    tAction: tAction || null,
    tClaim: tClaim || (claim && claim.tClaim) || null,
    tVerify: tVerify || (receipt && receipt.at) || null,
  };

  const shadow = (reason) => ({
    kind: 'shadow',
    reason,
    record: {
      schema: SCHEMA,
      shadow: true,
      usable_for_verdict: false,
      txid: txidOf(body),
      ...body,
      ackEvidence: ackInfo.evidence,
      sessionId: receipt?.sessionId ?? null,
      receiptDigest: receipt?.digest ?? null,
      provenance: {
        claimId: (claim && claim.txid) ? 'observed:claim.txid' : 'derived:receipt-index',
        ack: ackText === undefined ? 'absent:no-text' : 'observed:classifyAck',
        action: action ? 'observed:verdict' : (why === 'no-action' ? 'absent:insufficient' : 'absent'),
        evidence: evidence && evidence.callId ? 'observed:evidence' : 'absent',
        tAction: tAction ? 'observed:tool-call' : 'absent:no-stamp',
        tClaim: body.tClaim ? 'observed' : 'absent',
        tVerify: body.tVerify ? 'observed:receipt.at' : 'absent',
      },
      note: '影子记录：仅统计字段覆盖率，不得作为判决证据。',
    },
  });

  // 逐条如实拒：任何一项不齐都不许进 revisions.jsonl
  if (!action || !evidence || !evidence.callId)
    return shadow(why || 'missing-action-or-evidence');
  // 动作没成功 = 只认不改，绝不能算原子修订（参考实现的 isAtomic 要求的正是 ok===true，
  // 但 commit() 只校验类型不校验值 —— 少了这一句，ok=false 也会被写进原子文件）。
  if (action.ok !== true)
    return shadow('action-not-ok');
  if (ackInfo.ack !== 'admitted')
    return shadow(`ack=${ackInfo.ack}`);
  if (!body.tAction)
    return shadow('missing-tAction');
  for (const k of REQUIRED_CLOCKS) {
    if (!body[k])
      return shadow(`missing-${k}`);
  }
  const [ta, tc, tv] = [Date.parse(body.tAction), Date.parse(body.tClaim), Date.parse(body.tVerify)];
  if (!Number.isFinite(ta) || !Number.isFinite(tc) || !Number.isFinite(tv))
    return shadow('unparsable-clock');
  if (!(ta <= tc && tc <= tv))
    return shadow('clock-order-violation');

  return { kind: 'atomic', record: body };
}

/**
 * 记录一轮的修订：原子进 revisions.jsonl，其余进 revisions-shadow.jsonl。
 * @returns {{committed:number, shadowed:number, reasons:object}}
 */
export function recordRevision({ dir, receipt, ackText, tAction, tClaim, tVerify }) {
  const out = { committed: 0, shadowed: 0, reasons: {} };
  const claims = Array.isArray(receipt?.claims) ? receipt.claims : [];
  if (!dir || !claims.length)
    return out;

  const revFile = path.join(dir, REVISIONS_FILE);
  const shadowFile = path.join(dir, SHADOW_FILE);

  claims.forEach((claim, i) => {
    const r = revisionFromClaim({ receipt, claim, index: i, ackText, tAction, tClaim, tVerify });
    if (r.kind === 'atomic') {
      try {
        commit(revFile, r.record);
        out.committed += 1;
        return;
      }
      catch (e) {
        out.reasons[String(e && e.message)] = (out.reasons[String(e && e.message)] || 0) + 1;
      }
    }
    else {
      out.reasons[r.reason] = (out.reasons[r.reason] || 0) + 1;
    }
    // 落影子：单次 append，只写一行
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(shadowFile, JSON.stringify(r.record) + '\n');
    out.shadowed += 1;
  });

  return out;
}

/**
 * CI 谓词：revisions.jsonl 里不允许出现非原子/不完整/时钟倒序；
 * 影子文件里不允许有"冒充证据"的行（shadow!==true 或 usable_for_verdict!==false）。
 */
export function auditRevisions(dir) {
  const revFile = path.join(dir, REVISIONS_FILE);
  const shadowFile = path.join(dir, SHADOW_FILE);
  const a = audit(revFile);
  const violations = [];
  if (a.clockViolations)
    violations.push(`revisions.jsonl 有 ${a.clockViolations} 处时钟倒序`);
  if (a.incomplete)
    violations.push(`revisions.jsonl 有 ${a.incomplete} 条缺时刻（应只在影子文件里）`);
  if (a.total - a.atomic > 0)
    violations.push(`revisions.jsonl 有 ${a.total - a.atomic} 条非原子记录`);

  const shadow = { total: 0, fakeEvidence: 0, guessedFields: 0, reasons: {} };
  if (fs.existsSync(shadowFile)) {
    for (const line of fs.readFileSync(shadowFile, 'utf8').trim().split('\n').filter(Boolean)) {
      let r;
      try { r = JSON.parse(line); }
      catch { continue; }
      shadow.total += 1;
      if (r.shadow !== true || r.usable_for_verdict !== false)
        shadow.fakeEvidence += 1;
      const p = r.provenance || {};
      for (const k of ['claimId', 'ack', 'action', 'evidence', 'tAction', 'tClaim', 'tVerify']) {
        const v = p[k];
        // 影子期铁律：缺失必须是 absent*，不许用猜测顶替
        if (typeof v !== 'string' || !(v === 'observed' || v.startsWith('observed:') || v.startsWith('derived:') || v.startsWith('absent')))
          shadow.guessedFields += 1;
      }
      const reason = r.provenance?.ack === 'absent:no-text' ? 'no-text' : 'incomplete';
      shadow.reasons[reason] = (shadow.reasons[reason] || 0) + 1;
    }
    if (shadow.fakeEvidence)
      violations.push(`影子文件有 ${shadow.fakeEvidence} 行把影子当证据（shadow/usable_for_verdict 标记不对）`);
    if (shadow.guessedFields)
      violations.push(`影子文件有 ${shadow.guessedFields} 个字段 provenance 不合法（疑似猜值）`);
  }

  return { revisions: a, shadow, violations, ok: violations.length === 0 };
}

export { isAtomic, SCHEMA };
