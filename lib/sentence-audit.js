// sentence-audit.js —— 句子级 NLI：拿这一轮的工具输出当"证据文档"，判定报告里的动作句。
//
// 范式来自 MiniCheck（arXiv 2404.10774）：fact-checking on grounding documents，M(D, c) → 0/1。
// 它用 770M 小模型做到 GPT-4 准确率、成本低 400 倍，而且**不需要先做原子事实分解**——整句对文档判即可。
//
// 我们的改动：MiniCheck 把"矛盾"丢掉了（论文说 contradictions are rare），
// 而那恰恰是我们最需要的——所以做**三分类**：
//   supported    证据支持
//   insufficient 证据里没提（不是错，别报）
//   contradicted 证据反驳（这才是要抓的）
//
// ★ 隔离 ★ 本模块只接收 报告 + 证据文档；证据文档由 trace/evidence 生成，不含报告文本。

const SENT_SPLIT = /[。！？!?；;\n]+/;

/** 动作/结果类句子白名单：只审这些，避免把"我建议…"也送进模型 */
const ACTION_RE = /(?:已|已经|完成|创建|写入|保存|删除|修改|更新|启动|重启|停止|部署|安装|通过|成功|失败|修复|上传|提交|运行中|在跑|监听)/;

export function splitSentences(text) {
  if (typeof text !== 'string')
    return [];
  return text.split(SENT_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 400);
}

export function isActionSentence(s) {
  return ACTION_RE.test(s);
}

/** 选要审的句子：动作类 + 去重 + 上限 */
export function pickSentences(report, max = 12) {
  const seen = new Set();
  const out = [];
  for (const s of splitSentences(report)) {
    if (!isActionSentence(s))
      continue;
    const key = s.slice(0, 60);
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max)
      break;
  }
  return out;
}

/**
 * 把这一轮的工具调用压成"证据文档"。
 * 只写工具名、成败、输出片段——**不写报告**。
 */
export function buildGrounding(pairs, { maxChars = 6000, perResult = 400 } = {}) {
  const lines = [];
  for (const p of pairs || []) {
    const status = p.isError ? 'FAILED' : (p.resultSeen ? 'ok' : 'NO_RESULT');
    const head = `[${p.name}] ${status}`;
    const body = (p.text || '').replace(/\s+/g, ' ').slice(0, perResult);
    lines.push(body ? `${head}\n  ${body}` : head);
  }
  let doc = lines.join('\n');
  if (doc.length > maxChars)
    doc = doc.slice(0, maxChars) + '\n…（证据已截断）';
  return doc;
}

const INSTRUCTION = `你在做「报告 vs 执行记录」的核对。下面给你两样东西：
A) 一段 AI 助手写的报告里的若干句子
B) 这次运行实际产生的工具调用记录（含成功/失败）

对**每一句**判断它与记录的关系，只能选三档：
- supported    ：记录支持这句话
- insufficient ：记录里没有相关信息（**不是错**，只是没证据）
- contradicted ：记录反驳这句话（例如说"测试通过"但记录里那条命令是 FAILED）

规则：
1. 只根据 B 判断，不要用常识推测
2. 记录里"没提到"一律 insufficient，不要升级成 contradicted
3. 命令 FAILED 而句子说成功 → contradicted
4. 句子模糊、无法判定 → insufficient

只输出结果行，不要 JSON、不要解释、不要代码块。每句一行，格式严格为：
序号|判定|理由
例如：
0|supported|记录里有对应成功写入
1|contradicted|记录显示该命令 FAILED
2|insufficient|记录未提及
`;

export function buildAuditPrompt(sentences, grounding) {
  const numbered = sentences.map((s, i) => `${i}. ${s}`).join('\n');
  return `${INSTRUCTION}\nA) 报告句子：\n${numbered}\n\nB) 执行记录：\n${grounding}\n`;
}

/** 解析模型输出：优先 行格式 `i|verdict|reason`，其次 JSON 数组；非法项丢弃 */
export function parseVerdicts(rawText, count) {
  if (typeof rawText !== 'string')
    return { verdicts: [], error: 'empty' };

  const norm = (v) => {
    const s = String(v || '').toLowerCase().trim();
    return ['supported', 'insufficient', 'contradicted', 'unverified'].includes(s) ? s : 'insufficient';
  };
  const okIndex = (i) => Number.isInteger(i) && i >= 0 && (count === undefined || i < count);

  // ① 行格式（更抗截断）
  const lines = rawText.split(/\r?\n/);
  const fromLines = [];
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s*[|｜:：]\s*(supported|insufficient|contradicted)\s*(?:[|｜:：]\s*(.*))?$/i);
    if (!m)
      continue;
    const i = Number(m[1]);
    if (!okIndex(i))
      continue;
    fromLines.push({ i, verdict: norm(m[2]), reason: (m[3] || '').trim().slice(0, 60) });
  }
  if (fromLines.length)
    return { verdicts: fromLines, error: null };

  // ② JSON 数组（兼容旧输出）
  const s = rawText.replace(/```(?:json)?/gi, '');
  const a = s.indexOf('[');
  const b = s.lastIndexOf(']');
  if (a === -1 || b === -1 || b <= a)
    return { verdicts: [], error: 'no-json-array' };
  let arr;
  try { arr = JSON.parse(s.slice(a, b + 1)); }
  catch { return { verdicts: [], error: 'bad-json' }; }
  if (!Array.isArray(arr))
    return { verdicts: [], error: 'not-array' };

  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object')
      continue;
    const i = Number(item.i);
    if (!okIndex(i))
      continue;
    out.push({ i, verdict: norm(item.verdict), reason: typeof item.reason === 'string' ? item.reason.slice(0, 60) : '' });
  }
  return { verdicts: out, error: null };
}

/**
 * 审一句话集合。
 * @param {string} report 报告全文
 * @param {{ pairs: Array, transport: Function, maxSentences?: number, maxGroundingChars?: number }} opts
 */
export async function auditReport(report, opts) {
  const { pairs, transport, maxSentences = 12, maxGroundingChars = 6000 } = opts || {};
  if (typeof transport !== 'function')
    throw new Error('auditReport 需要 transport(prompt) => Promise<string>');

  const sentences = pickSentences(report, maxSentences);
  if (!sentences.length)
    return { sentences: [], verdicts: [], groundingChars: 0, error: null };

  const grounding = buildGrounding(pairs, { maxChars: maxGroundingChars });
  if (!grounding.trim())
    return { sentences, verdicts: [], groundingChars: 0, error: 'no-evidence' };

  const prompt = buildAuditPrompt(sentences, grounding);
  const raw = await transport(prompt);
  const parsed = parseVerdicts(raw, sentences.length);

  const byIndex = new Map(parsed.verdicts.map((v) => [v.i, v]));
  const verdicts = sentences.map((s, i) => ({
    sentence: s,
    // 模型漏答 = 核验没做成，不是"证据不足"。两者必须分开。
    verdict: byIndex.get(i)?.verdict || 'unverified',
    reason: byIndex.get(i)?.reason || (parsed.verdicts.length ? '模型漏答此句' : '模型未返回可用判定'),
  }));

  return {
    sentences,
    verdicts,
    groundingChars: grounding.length,
    promptChars: prompt.length,
    error: parsed.error,
    rawPreview: typeof raw === 'string' ? raw.slice(0, 300) : String(raw).slice(0, 300),
  };
}

/** 统计三档分布，便于评估 */
export function summarize(audits) {
  const t = { supported: 0, insufficient: 0, contradicted: 0, unverified: 0 };
  for (const a of audits)
    t[a.verdict] = (t[a.verdict] || 0) + 1;
  return t;
}
