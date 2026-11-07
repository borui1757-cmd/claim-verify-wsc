// completeness.js —— 清单完备性：分母有没有被低估。
//
// 为什么需要（2026-11-07 缺口）：
// 覆盖率 = 有回执的清单项 / 清单项。这个式子有个隐含前提——**清单本身是完备的**。
// 如果实际做了 10 件事、清单只承诺了 6 件，那覆盖率可以轻松 100%，而漏掉的 4 件
// 永远不可见。这正是 ClaimReceipt (arXiv 2609.01992) 说的：
//   "claim verification requires both claim-sufficient evidence and
//    a committed universe against which omissions become visible."
//
// 我们做的是**反向检查**：拿回执里已发生的动作，去反查清单里有没有这一项。
//   进了清单  → committed
//   没进清单  → uncommitted（做了但没承诺，分母被低估的证据）
//
// 诚实的边界：这只能发现「做了却没承诺」。
// 「该做却根本没做」在没有独立任务分解的前提下不可观测——不要假装能测。

import { matchItem } from './manifest.js';

/** 取回执里"真的发生过、且有回执证据"的 claim。 */
function observableClaims(receipts) {
  const out = [];
  for (const r of Array.isArray(receipts) ? receipts : []) {
    for (const c of (r && r.claims) || []) {
      if (!c || !c.evidence || !c.evidence.callId)
        continue; // 没回执证据的动作不算"可核验的已发生事项"
      if (c.verdict === 'contradicted')
        continue; // 被系统反驳的不算做成的活
      out.push(c);
    }
  }
  return out;
}

/**
 * 承诺完备性（下界）。
 * @returns {{committed:number, uncommitted:Array, total:number, completeness:number, verdict:string, boundary:string}}
 */
export function computeCommitmentCompleteness(manifest, receipts) {
  const items = (manifest && manifest.items) || [];
  const claims = observableClaims(receipts);

  const uncommitted = [];
  const seen = new Set();
  for (const c of claims) {
    const key = JSON.stringify([c.claim?.kind, c.claim?.value ?? c.claim?.target]);
    if (seen.has(key))
      continue;
    seen.add(key);
    // 这条已发生的动作，清单里有没有对应项？
    const hit = items.find((it) => matchItem(it, [c]));
    if (!hit)
      uncommitted.push({ kind: c.claim?.kind ?? null, target: c.claim?.value ?? c.claim?.target ?? null, verdict: c.verdict });
  }

  const committed = items.length;
  const total = committed + uncommitted.length;
  const completeness = total ? committed / total : 0;
  const verdict = committed === 0 ? 'NO_MANIFEST'
    : uncommitted.length ? 'UNCOMMITTED_ACTIONS'
      : 'COMPLETENESS_OK';

  return {
    committed,
    uncommitted,
    total,
    completeness,
    verdict,
    // 写进输出，避免把"下界"当成"全貌"
    boundary: '只能发现"做了却没承诺"；"该做却没做"不可观测',
  };
}

/** 人话报告 */
export function renderCompleteness(cmp) {
  if (!cmp || cmp.committed === 0)
    return '';
  if (cmp.verdict === 'COMPLETENESS_OK')
    return `【完备性】清单 ${cmp.committed} 项，已发生的可核验动作全部在清单里。`;
  const names = cmp.uncommitted.slice(0, 3).map((u) => `${u.kind || '?'}:${String(u.target ?? '').slice(0, 40)}`).join('；');
  return `【清单不完备】已发生 ${cmp.uncommitted.length} 个动作不在清单里：${names}${cmp.uncommitted.length > 3 ? ' 等' : ''}。`
    + `覆盖率的分母被低估了（${cmp.committed}/${cmp.total}）。`;
}
