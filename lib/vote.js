// vote.js —— 三票制：规则票 + 状态票 + 模型票，≥2 票一致才给决定性判定。
//
// 依据：dos-kernel 的 overclaim 基准用三个独立检测器（lexical / write-verb / witness）
// 交叉验证，收敛到同一批 34 条，用「≥2 同意」防止单一启发式漂移。
// 我们的单规则层误报率过高（元讨论、引用、无关命令），所以引入表决。
//
// 现状：
//   规则票 = promise.js（已含状态票的强否定：文件不存在直接 contradicted）
//   模型票 = sentence-audit.js 的句子级三分类
// 表决只对 contradicted 生效——supported 不需要额外成本，uncertain 保持原样。

const norm = (s) => String(s || '').replace(/[`*_~#>|\s]/g, '').slice(0, 60);

/** 在模型判定里找同一句（规范化后包含即算命中） */
export function findModelVerdict(sentence, verdicts) {
  const key = norm(sentence);
  if (!key || !Array.isArray(verdicts))
    return null;
  for (const v of verdicts) {
    const vk = norm(v.sentence);
    if (!vk)
      continue;
    if (vk.includes(key) || key.includes(vk))
      return v;
  }
  return null;
}

/**
 * 表决：规则判 contradicted 的条目，必须有第二票（模型也判 contradicted）才保留。
 * @returns {{results: Array, confirmed: number, downgraded: number}}
 */
export function voteOnContradicted(ruleResults, verdicts) {
  const out = [];
  let confirmed = 0;
  let downgraded = 0;
  for (const r of ruleResults || []) {
    if (r.verdict !== 'contradicted') {
      out.push(r);
      continue;
    }
    const mv = findModelVerdict(r.sentence, verdicts);
    if (mv && mv.verdict === 'contradicted') {
      confirmed += 1;
      out.push({ ...r, votes: 2, reason: mv.reason || r.evidence });
      continue;
    }
    downgraded += 1;
    out.push({
      ...r,
      verdict: 'uncertain',
      confidence: Math.min(r.confidence ?? 0.5, 0.4),
      evidence: `${r.evidence}｜模型未确认${mv ? `（模型判 ${mv.verdict}）` : '（模型漏答）'}`,
      votes: 1,
    });
  }
  return { results: out, confirmed, downgraded };
}
