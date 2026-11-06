// rubric.js —— 任务级验收（从「断言对不对」到「交付成不成」）
//
// 为什么需要：我们一直在做断言级核验（路径存在吗、端口在听吗），
// 但用户要的是**任务级**回答（这次交付成不成）。
// 文献里这叫 granularity mismatch（arXiv 2510.03253）：步骤级太细、轨迹级太粗，
// 中间还需要"子任务/验收项"这一层。
//
// 结构照抄工业界实战（阿里云 AI Tutor Engine 的 Rubric 验收）：
//   ① required_evidence —— **程序化预检**：判定前需要哪些证据（用我们的 19 类原语）
//   ② pass_condition   —— **语义判断**：证据够了之后，达不达标（可接 LLM，也可先留空）
//   ③ weight           —— 参与评分
//   ④ role             —— 决定**有没有阻断权**（acceptance 能拦交付；theory/reflection 不能）
//
// 他们踩过的两个坑，我们照抄避让：
//   - evidence 与 condition 混为一谈 → 分开执行
//   - 字段存在≠生效（他们定义了 Task.evidence_required 却没人读）→ 这里每个字段都有消费者的测试

/** 可作硬门槛的证据类型 = 我们核验器支持的断言类型 */
export const EVIDENCE_KINDS = [
  'path', 'port', 'pid', 'filecount', 'size', 'lines', 'hash',
  'pkgversion', 'service', 'mem', 'disk', 'math',
];

/** 只作补充、不作硬门槛的证据（对齐工业界的 optional bonus） */
export const OPTIONAL_EVIDENCE = ['report', 'visual', 'deployment', 'issue', 'description'];

export const ROLES = ['acceptance', 'theory', 'reflection'];

/** 校验并规范化一条验收标准。非法证据类型当场拒绝（不留给运行时炸）。 */
export function normalizeRubric(raw) {
  if (!raw || typeof raw !== 'object')
    throw new Error('rubric 必须是对象');
  const id = String(raw.id || '').trim();
  if (!id)
    throw new Error('rubric.id 必填');
  const criterion = String(raw.criterion || '').trim();
  if (!criterion)
    throw new Error(`rubric ${id}: criterion 必填`);

  const role = ROLES.includes(raw.role) ? raw.role : 'acceptance';

  const ev = Array.isArray(raw.required_evidence) ? raw.required_evidence.map((x) => String(x)) : [];
  for (const e of ev) {
    if (!EVIDENCE_KINDS.includes(e) && !OPTIONAL_EVIDENCE.includes(e))
      throw new Error(`rubric ${id}: 未知证据类型 "${e}"（合法：${EVIDENCE_KINDS.join('/')} 或可选 ${OPTIONAL_EVIDENCE.join('/')}）`);
  }

  const weight = raw.weight === undefined ? 1 : Number(raw.weight);
  if (!Number.isFinite(weight) || weight < 0)
    throw new Error(`rubric ${id}: weight 必须是 >=0 的数字`);

  return {
    id,
    criterion,
    description: String(raw.description || ''),
    required_evidence: [...new Set(ev)],
    pass_condition: String(raw.pass_condition || '').trim(),
    weight,
    role,
  };
}

/** 硬门槛证据 = required_evidence 里刨掉可选类型 */
export function hardEvidence(rubric) {
  return rubric.required_evidence.filter((e) => !OPTIONAL_EVIDENCE.includes(e));
}

/**
 * 证据预检：只判断"有没有进入评审的资格"，不判断达标。
 * @param {object} rubric
 * @param {Set<string>|string[]} available 当前拿到的证据类型
 * @returns {{passable:boolean, missing:string[]}}
 */
export function evidencePrecheck(rubric, available) {
  const have = available instanceof Set ? available : new Set(available || []);
  // theory/reflection 不因缺证据被拦（它们没有阻断权，拦了也没意义）
  if (rubric.role !== 'acceptance')
    return { passable: true, missing: [] };
  const missing = hardEvidence(rubric).filter((e) => !have.has(e));
  return { passable: missing.length === 0, missing };
}

/**
 * 评估一个任务。
 * @param {object} input
 * @param {object[]} input.rubrics 已 normalize 的验收标准
 * @param {Set<string>|string[]} input.available 当前证据类型
 * @param {(rubric:object)=>(Promise<{ok:boolean,detail?:string}|null>|{ok:boolean,detail?:string}|null)} [input.judge]
 *        语义判断器：返回 {ok} / null（无法判定）。不给就一律 INCONCLUSIVE（缺证据）
 * @returns {{verdict:'PASS'|'INVALID'|'INCONCLUSIVE', score:number, results:object[], gaps:object[], forced:object[]}}
 */
export async function evaluateTask({ rubrics, available, judge }) {
  const list = (rubrics || []).map(normalizeRubric);
  const results = [];
  const forced = [];
  const gaps = [];

  for (const r of list) {
    const pre = evidencePrecheck(r, available);
    if (!pre.passable) {
      // 证据不全 → 强制复核，且**不能**算通过（对齐工业界 NEED_REVIEW）
      forced.push({ id: r.id, missing: pre.missing, reason: '缺少必要证据，无法自动判定' });
      results.push({ id: r.id, role: r.role, weight: r.weight, status: 'FORCED', ok: false, detail: '缺证据：' + pre.missing.join(',') });
      continue;
    }

    let verdict = null;
    if (typeof judge === 'function') {
      try { verdict = await judge(r); }
      catch { verdict = null; }
    }

    if (!verdict) {
      // 证据齐了但没人判（或判不了）→ 不能算通过
      results.push({ id: r.id, role: r.role, weight: r.weight, status: 'UNJUDGED', ok: false, detail: '证据齐全，但缺少判定器' });
      if (r.role === 'acceptance')
        forced.push({ id: r.id, missing: [], reason: '证据齐全但无法判定' });
      continue;
    }

    results.push({ id: r.id, role: r.role, weight: r.weight, status: verdict.ok ? 'PASS' : 'FAIL', ok: Boolean(verdict.ok), detail: verdict.detail || '' });
    if (!verdict.ok && r.role !== 'acceptance')
      gaps.push({ id: r.id, role: r.role, detail: verdict.detail || '' });
  }

  // 评分只算 acceptance 中**被判定**的（forced/unjudged 不进分母，避免用无法判定的项拉低分数）
  const acc = results.filter((x) => x.role === 'acceptance');
  const judged = acc.filter((x) => x.status === 'PASS' || x.status === 'FAIL');
  const totalW = judged.reduce((s, x) => s + x.weight, 0);
  const passedW = judged.filter((x) => x.ok).reduce((s, x) => s + x.weight, 0);
  const score = totalW > 0 ? Math.round((passedW / totalW) * 100) : 0;

  // 结论：任一 acceptance 判定失败 → INVALID；否则有 forced → INCONCLUSIVE；否则 PASS
  const anyFail = acc.some((x) => x.status === 'FAIL');
  const verdict = anyFail ? 'INVALID' : (forced.length ? 'INCONCLUSIVE' : 'PASS');

  return { verdict, score, results, gaps, forced };
}

/** 渲染成一行给人看 */
export function summarizeTask(result) {
  const { verdict, score, results, forced } = result || {};
  const acc = (results || []).filter((r) => r.role === 'acceptance');
  const pass = acc.filter((r) => r.status === 'PASS').length;
  const head = `验收 ${verdict}（评分 ${score}，acceptance ${pass}/${acc.length}）`;
  if (verdict === 'PASS')
    return head;
  // 「未通过」只列 acceptance —— theory/reflection 失败不阻断交付，
  // 混进来会让人误以为交付被卡住（工业界那个 Rubric 文章专门强调的分桶）。
  const bad = (results || []).filter((r) => r.status === 'FAIL' && r.role === 'acceptance').map((r) => r.id);
  const miss = (forced || []).map((f) => f.id + (f.missing && f.missing.length ? `（缺 ${f.missing.join(',')}）` : ''));
  return head + (bad.length ? `；未通过: ${bad.join(',')}` : '') + (miss.length ? `；待复核: ${miss.join(',')}` : '');
}
