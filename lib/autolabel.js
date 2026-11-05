// autolabel.js —— 脚本化标注：标签不是人给的，是"程序执行结果 + 有效性规则"给的。
//
// 一条样本可自动标注，必须同时满足：
//   ① stage === 'run'（真的执行了，不是翻译/见证失败）
//   ② 结果明确（supported / contradicted）
//   ③ 不是"无法评估"（读不到文件、权限不足等）
//   ④ 不是被策略拦下的（deny/pending）
//   ⑤ 不涉及跨轮瞬态（时序对不上）
// 不满足的进 labels-todo.jsonl，交人工；满足的进 labels-auto.jsonl。

import crypto from 'node:crypto';

const UUID = () => crypto.randomBytes(8).toString('hex');

/** 判断一条 audit 记录里的某个 dsl detail 能不能自动标注。 */
export function classifyDetail(detail, { policyBlocked = false } = {}) {
  const d = detail || {};
  const verdict = d.verdict;
  const stage = d.stage;
  const reason = String(d.reason || '');
  if (policyBlocked || /策略未放行/.test(reason))
    return { ok: false, why: 'policy-blocked' };
  if (stage !== 'run')
    return { ok: false, why: `stage-${stage || 'unknown'}` };
  if (verdict !== 'supported' && verdict !== 'contradicted')
    return { ok: false, why: `verdict-${verdict || 'unknown'}` };
  if (/无法评估|读不到|权限|超时/.test(reason))
    return { ok: false, why: 'unevaluable' };
  return { ok: true, why: 'program-truth' };
}

/** 从 audit.jsonl 的行里收集可自动标注的样本。 */
export function collectAutoLabels(auditRows) {
  const auto = [];
  const todo = [];
  const seen = new Set();
  for (const row of auditRows || []) {
    const details = row?.dsl?.details || [];
    for (const d of details) {
      const sentence = String(d.sentence || '');
      if (!sentence)
        continue;
      const id = crypto.createHash('sha1').update(sentence + '|' + JSON.stringify(d.plan || {})).digest('hex').slice(0, 12);
      if (seen.has(id))
        continue;
      seen.add(id);
      const v = classifyDetail(d);
      const rec = {
        id,
        at: row.at,
        sentence,
        plan: d.plan || null,
        verdict: d.verdict,
        stage: d.stage,
        reason: String(d.reason || '').slice(0, 200),
        policyHash: row.policyHash || null,
        source: v.ok ? 'auto' : 'todo',
        valid: v.ok,
        why: v.why,
      };
      (v.ok ? auto : todo).push(rec);
    }
  }
  return { auto, todo };
}

/** Cohen's kappa：两个标注者的一致性（扣掉偶然一致）。 */
export function cohenKappa(pairs) {
  const rows = (pairs || []).filter((p) => p && p.a !== undefined && p.b !== undefined);
  const n = rows.length;
  if (!n)
    return { n: 0, agreement: null, kappa: null };
  let both = 0;
  let agree = 0;
  const aCount = {};
  const bCount = {};
  for (const { a, b } of rows) {
    aCount[a] = (aCount[a] || 0) + 1;
    bCount[b] = (bCount[b] || 0) + 1;
    if (a === b)
      agree += 1;
    both += 1;
  }
  const po = agree / both;
  const labels = new Set([...Object.keys(aCount), ...Object.keys(bCount)]);
  let pe = 0;
  for (const l of labels)
    pe += ((aCount[l] || 0) / both) * ((bCount[l] || 0) / both);
  const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
  return { n, agreement: Number(po.toFixed(3)), kappa: Number(kappa.toFixed(3)) };
}

export { UUID };
