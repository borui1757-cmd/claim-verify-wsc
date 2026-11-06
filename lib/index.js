// dsh-claim-verify v0.1 —— 输出前核验「可核验断言」
//
// 挂载点：ctx.on('llm/stream', (options, next) => ...) —— 与 dsh-bill / dsh-discipline-guard
// 同一个 waterfall，能看到每一块 text-delta。
//
// 为什么要有它（2026-11-05）：
//   AGENTS.md 二·十 的「证据门」是写在 prompt 里的自检，模型可以绕过；
//   tools/hallu-suite.mjs 有真值，但只在发布前离线跑，拦不住对话里现编的结论。
//   这层把「可核验」的四类断言（端口 / 路径 / 模型 / 金额）在**输出时**现场比一次真值，
//   对不上就追加一条【核验】说明（改写原文会破坏流式与工具调用交错，这里只追加，不覆盖）。
//
// 真值来源（都不依赖模型）：
//   端口   —— 127.0.0.1 的 TCP connect 探活（DSH 自己的端口另比 DSH_WEB_URL）
//   路径   —— fs.existsSync
//   模型   —— $DSH_HOME/dsh-bill/records.jsonl 里本会话最后一条 provider/model
//   金额   —— 同一份 records.jsonl 里当天的 usd 汇总（按 30% 容差比）

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { extractProgramClaims, verifyProgramClaim, PROGRAM_KINDS } from './extra.js';
import { extractGrounding } from './grounding.js';
import { appendTrace, buildTrace } from './trace.js';
import { buildReceipt, extractClaimsBlock } from './receipt.js';
import { makeReportClaimsTool } from './report-tool.js';
import { loadOrCreateKeypair } from './signing.js';
import { makeEnvelope, chainDigest } from './envelope.js';
import { makeCase } from './cases.js';
import { BUILD_ID } from './build-id.js';
import { makeOutcomeLog } from './outcomes.js';
import { detectRedFlag } from './redflag.js';
import { declaredCoverage } from './coverage.js';
import { auditIsolated } from './isolated-audit.js';
import { resolveUncertain } from './claim-dsl.js';
import { validatePolicy, policyHash } from './policy.js';
import { sha256Hex } from './receipt.js';
import { canonicalJson } from './policy.js';

/** 从配置拼出执行前策略；写错就退回"全放行"并给出提示，不让配置错误变成静默拒绝。 */
export function buildPolicy(c) {
  const def = typeof c.dslPolicyDefault === 'string' && c.dslPolicyDefault ? c.dslPolicyDefault : 'allow';
  const deny = String(c.dslPolicyDeny || '').split(',').map((s) => s.trim()).filter(Boolean);
  const pending = String(c.dslPolicyPending || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rules = {};
  for (const name of deny)
    rules[name] = 'deny';
  for (const name of pending)
    rules[name] = 'pending';
  // 写操作的范围谓词：进了 pending 的 write_file 再套一层路径前缀（不在范围内 → deny）
  const prefix = String(c.dslPolicyWritePrefix || '').trim();
  if (prefix) {
    const base = typeof rules.write_file === 'string' ? rules.write_file : (rules.write_file?.decision || 'allow');
    rules.write_file = { decision: base === 'allow' ? 'pending' : base, allowPathPrefix: prefix };
  }
  const policy = { default: def, rules };
  const v = validatePolicy(policy);
  if (!v.ok) {
    console.warn('[claim-verify] dslPolicy 配置有误，退回全放行：' + v.errors.join('; '));
    return { default: 'allow', rules: {} };
  }
  return policy;
}
import { extractHostClaims, verifyHostClaim, HOST_KINDS } from './host.js';
import { createCascade, makeEscalationLogger } from './cascade.js';
import { INTERNAL_FLAG, makeLlmTransport } from './llm-transport.js';
import { createTrace } from './trace.js';
// 2026-11-06：模型自愿声明的承诺块（对齐 CLAIMRECEIPT 的三态判定）
import { parseCommitments, verifyCommitments, summarize as summarizeCommitments } from './commitments.js';
import { makeCommitClaimsTool } from './commit-tool.js';
import { readMany, readOnce, isStale } from './atomic-snapshot.js';
// 2026-11-06：告警策略（治 alert fatigue）与一致性登记册
import { createAlertPolicy } from './alert-policy.js';
import { createCoherence } from './coherence.js';
import { auditReport, summarize } from './sentence-audit.js';
import { checkPromises, summarizePromises, looksFailed } from './promise.js';
import { makeStat } from './state.js';
import { voteOnContradicted } from './vote.js';
import { buildFeedback, reproduceHint } from './feedback.js';
import { recordFact, lookupFact } from './worldmodel.js';
import { calibrationNote, repeatLiarNote } from './calibration.js';
import { inlineCheck, appendToToolContent, targetPathOf } from './inline.js';
import { aivsFields } from './aivs.js';

export const name = 'claim-verify-wsc';
export const VERSION = '0.5.0-experimental.1';

// cordis 要求插件显式声明依赖的服务，否则 ctx.llm 会抛
// "cannot get property "llm" without inject"。
export const inject = ['llm', 'tools'];

// DSH 才需要的配置模式放在 config.js 里（它 import 了 @deepseek-ai/schemastery）。
// 这里动态加载：在 DSH 之外（CLI / 其它框架）用不到 Config，也就不需要装 DSH 的包。
let Config;
try {
  ({ Config } = await import('./config.js'));
}
catch {
  Config = undefined;
}
export { Config };

function dshHome() {
  const env = process.env.DSH_HOME;
  if (env && env.trim())
    return env.trim();
  return path.join(os.homedir(), '.dsh');
}

function resolveConfig(raw) {
  const c = raw ?? {};
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  return {
    enable: c.enable !== false,
    // observe-first：只有显式写 annotate: true 才追加说明
    annotate: c.annotate === true,
    budgetMs: num(c.budgetMs, 1500),
    portTimeoutMs: Math.max(50, num(c.portTimeoutMs, 300)),
    moneyTolerance: Math.min(0.9, num(c.moneyTolerance, 0.3)),
    pagesDir: typeof c.pagesDir === 'string' ? c.pagesDir : '',
    buttonsFile: typeof c.buttonsFile === 'string' ? c.buttonsFile : '',
    cascadeEnabled: c.cascadeEnabled === true,
    cascadeProvider: typeof c.cascadeProvider === 'string' ? c.cascadeProvider : '',
    cascadeModel: typeof c.cascadeModel === 'string' ? c.cascadeModel : '',
    cascadeMax: Math.max(0, num(c.cascadeMax, 2)),
  sentenceAudit: c.sentenceAudit === true,
  structuralAudit: c.structuralAudit !== false,
  dslAudit: c.dslAudit === true,
  isolatedAudit: c.isolatedAudit === true,
  dslAuditMax: Math.max(1, Math.min(10, num(c.dslAuditMax, 3))),
  dslPolicy: buildPolicy(c),
  sentenceAuditMax: Math.max(1, num(c.sentenceAuditMax, 12)),
  sentenceAuditOnlyOnFailure: c.sentenceAuditOnlyOnFailure !== false,
  structuralFirst: c.structuralFirst !== false,
  voteOnContradicted: c.voteOnContradicted !== false,
  // 回写：把核验结论送回模型（off / failure / audit / both）
  feedbackMode: ['off', 'failure', 'audit', 'both'].includes(c.feedbackMode) ? c.feedbackMode : 'failure',
  feedbackLevel: ['soft', 'firm', 'block'].includes(c.feedbackLevel) ? c.feedbackLevel : 'firm',
  feedbackMaxPerTurn: Math.max(0, Math.min(5, num(c.feedbackMaxPerTurn, 2))),
  feedbackMaxPerTarget: Math.max(0, Math.min(10, num(c.feedbackMaxPerTarget, 2))),
  feedbackBudget: Math.max(0, Math.min(10, num(c.feedbackBudget, 3))),
  auditTurnWindow: Math.max(1, num(c.auditTurnWindow, 2)),
    logFile: typeof c.logFile === 'string' && c.logFile ? c.logFile : path.join(dshHome(), 'dsh-claim-verify', 'hits.jsonl'),
    debug: c.debug === true,
    receipts: c.receipts !== false,
  };
}

/** 读回执文件最后一条的 digest，用于线性哈希链。 */
function lastReceiptDigest(file) {  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const r = JSON.parse(lines[i]);
        if (r && typeof r.digest === 'string')
          return r.digest;
      }
      catch { /* 坏行跳过 */ }
    }
  }
  catch { /* 文件不存在 */ }
  return null;
}

function appendLog(file, entry) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  }
  catch { /* 日志失败不影响主流程 */ }
}

/** 读回执文件尾部：行数与最后一行的 AIVS row_hash（用于续链）。 */
function aivsTail(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    const last = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
    return { count: lines.length, head: (last && last.aivs && last.aivs.row_hash) || '' };
  }
  catch {
    return { count: 0, head: '' };
  }
}

// ────────────────────────── 断言抽取 ──────────────────────────

function hasAny(text, words) {
  return words.some((w) => text.includes(w));
}

// ────────────── 句级切分与极性判定（NegEx 精简版，2026-11-05 加） ──────────────
//
// 为什么按句：两次现场误报都出在「窗口越界 + 极性没判」上——
//   ① 「127.0.0.1:18080 本机没有服务在监听」被判成「在监听」：旧否定词表只收整词
//      「没有监听」，漏掉「没有服务在监听」这种中间夹宾语的写法；
//   ② 上一句的「比如」「没有」会串进下一句的判定窗口。
// 做法沿用临床 NLP 的 NegEx：不枚举整句，只认**线索词 + 作用域**（线索词到候选值的距离），
// 并把「不仅/不但」这类伪否定抹掉，避免反向误判。
// 参考：NegEx（191 条线索、含 11 条伪否定）https://dl.acm.org/doi/pdf/10.1145/2110363.2110443
//       cue-scope 标注 https://www.sciencedirect.com/science/article/pii/S0933365723001963
const SENT_END_RE = /[。！？!?；;\n]+/g;

function sentencesOf(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(SENT_END_RE)) {
    if (m.index > last)
      out.push({ start: last, end: m.index, text: text.slice(last, m.index) });
    last = m.index + m[0].length;
  }
  if (last < text.length)
    out.push({ start: last, end: text.length, text: text.slice(last) });
  return out;
}

function sentenceAt(sents, index) {
  for (const s of sents) {
    if (index >= s.start && index < s.end)
      return s;
  }
  return null;
}

/** 假设 / 举例 / 推测句：整句放过，不当断言（precision-first）。 */
const SPECULATIVE_RE = /比如|例如|譬如|假设|假如|要是|如果|样例|示例|可能|也许|大概|或许|按理|应该会|不妨/;

/** 祈使句不是事实断言。实测漏网：「3. 删驱动文件 C:\Windows\...\360FsFlt.sys」被当成"这个文件在"。 */
const IMPERATIVE_RE = /^\s*(?:[-*•]\s*|\d+[.、)]\s*)?\s*(?:请|先|再|然后)?\s*(?:删除|删掉|删|移除|执行|运行|打开|复制|粘贴|安装|卸载|重启|关闭|停掉|杀掉|启动(?!后|完|时|之|的))/;

/**
 * 附加疑问句（tag question）：靠**句尾语气词**表疑问，不靠问号，所以 /[?？]$/ 抓不到。
 * 「…这个页面吧」「…是这样吗」「…要不要我重启」都算；但「文件还在呢」是陈述（呢表持续），不能误杀。
 * 2026-11-05 真实语料 #30 实测。
 */
const TAG_TAIL_RE = /(?:吧|吗)$|(?:好不好|对不对|行不行|可不可以|要不要|能不能|是不是|有没有)$/;
const NOT_QUESTION_TAIL = new Set(['什么', '这么', '那么', '怎么', '多么', '要么', '干么']);

function isTagQuestion(sentence) {
  const t = sentence.trim();
  if (TAG_TAIL_RE.test(t))
    return true;
  if (t.endsWith('呢'))
    return !/(?:还|正|仍|在)呢$/.test(t);   // 「还在呢」「正在呢」是陈述
  if (t.endsWith('么'))
    return !NOT_QUESTION_TAIL.has(t.slice(-2));
  return false;
}

/** 否定线索词（NegEx 精简版）。命中即「否定断言」，核验时期望值取反。 */
const NEG_CUES = ['没有', '没在', '没跑', '没监听', '没启动', '没开', '不在', '未', '不是', '并非', '无法', '不能', '不存在', '已停', '停了', '挂了', '关了'];

/**
 * 各类断言**专属**的否定线索：必须说的是「它不存在 / 没在监听」才算否定。
 * 「X 不在 Y 里」不算——2026-11-05 真实语料 #12：`~/.dsh` 不在工作区里，
 * 被通用线索「不在」读成「该路径不存在」，于是报了「其实存在，与你说的相反」。
 */
const NEG_CUES_BY_KIND = {
  port: ['没有监听', '没监听', '未监听', '不在监听', '没有在跑', '没在跑', '未启动', '没有启动', '没启动',
    '不在跑', '没起', '不在线', '没有在线', '已停', '停了', '挂了', '关了', '没有任何服务', '没有服务', '没有东西',
    // 2026-11-05 实测补：说的是"它连不上/没起来"，同样是否定断言
    '没有运行', '没运行', '没有起来', '没起来', '根本没', '不通', '连不上', '不可用', '没有开启', '未开启'],
  path: ['不存在', '找不到', '并不存在', '没有这个', '没有该', '不是文件', '没有对应', '已删除', '被删了', '已被删除'],
};

/** 讨论「句子本身」的元文本（解释语法、引用原句）不是事实断言。2026-11-05 实测。 */
// 2026-11-06 补：引用**核验器自己的报错**也算元文本。
// 实测误报：我复述「【实时核验】…这个路径不存在」时，整句被当成本人的事实断言。
const PLACEHOLDER_PATH = /__[a-z0-9_]+__|no_such|nonexistent|dummy|placeholder|示例路径|占位/i;
const META_RE = /句尾|原句|这句话|引号内|引用原文|上面那句|刚才那句|贴出来|误报|原话|引用|上一条|报错/;

/**
 * 时态线索（2026-11-06 实测）：瞬态断言（端口/进程/服务）只在"说现在"时才可核。
 * 「当时起了 3099」「之前跑在 3210」是历史叙述，拿现在的探活去否它，等于拿明天考今天的卷。
 */
const PAST_WORDS = ['当时', '之前', '原来', '上次', '昨天', '前天', '以前', '刚才', '早先', '那时候', '历史', '曾经'];
const NOW_WORDS = ['现在', '目前', '当前', '此刻', '这会儿', '刚刚', '仍', '还在', '正在'];
const PAST_RE = new RegExp(PAST_WORDS.join('|'));
const NOW_RE = new RegExp(NOW_WORDS.join('|'));

/**
 * 候选值所在分句说的是"现在"还是"过去"：取**离候选值最近**的那类线索。
 * 「当时端口是 3099，现在改成 3210」——3099 归 past（最近的线索在它左边），3210 归 now。
 */
function tenseAt(sentText, relIndex) {
  let best = null;
  for (const [kind, words] of [['past', PAST_WORDS], ['now', NOW_WORDS]]) {
    for (const w of words) {
      let at = sentText.indexOf(w);
      while (at !== -1) {
        const d = Math.abs(at - relIndex);
        if (best === null || d < best.d)
          best = { kind, d };
        at = sentText.indexOf(w, at + 1);
      }
    }
  }
  return best ? best.kind : null;
}

/** 命令行本身不是断言：「adb connect localhost:5555   // 连接引擎」。2026-11-05 实测。 */
const CMD_LINE_RE = /^\s*(?:adb|npm|npx|pnpm|yarn|node|git|curl|wget|powershell|pwsh|cmd|netstat|taskkill|tasklist|sc|reg|del|copy|xcopy|move|cd|dir|ls|cat|type)\s/i;
/** 伪否定：命中不算否定（NegEx 的 pseudo-negation）。不排除会把「不仅…还」判反。 */
const PSEUDO_NEG = ['不仅', '不但', '不只', '不光', '不外乎', '不得不', '不可避免', '未尝', '毫无疑问', '没有问题', '没错', '未来', '未雨绸缪'];

function stripPseudo(s) {
  let out = s;
  for (const p of PSEUDO_NEG)
    out = out.split(p).join('□'.repeat(p.length));
  return out;
}

/**
 * 候选值在句内的极性：'neg' 表示这句话在说「它没有 / 不是 / 不在」。
 * 只看句内，线索词与候选值距离不超过 24 字；
 * 「不是 A，是 B」这种对比句里，线索词与 B 之间隔着「是」时不传染，否则 B 也会被判成否定。
 */
function polarityOf(sentText, relIndex, length, kind) {
  const own = NEG_CUES_BY_KIND[kind];
  const cues = own || NEG_CUES;
  const scopeStart = Math.max(0, relIndex - 24);
  const scopeEnd = Math.min(sentText.length, relIndex + length + 24);
  const scope = stripPseudo(sentText.slice(scopeStart, scopeEnd));
  const vFrom = relIndex - scopeStart;
  const vTo = vFrom + length;
  for (const cue of cues) {
    let at = scope.indexOf(cue);
    while (at !== -1) {
      const cueEnd = at + cue.length;
      const between = cueEnd <= vFrom
        ? scope.slice(cueEnd, vFrom)
        : scope.slice(Math.min(vTo, scope.length), at);
      // 专属线索自带谓词（「没有监听」「不存在」），不需要「是」守卫；
      // 通用线索才要防「不是 A，是 B」传染。
      if (own || !between.includes('是'))
        return 'neg';
      at = scope.indexOf(cue, at + 1);
    }
  }
  return 'pos';
}

// 模型断言只认真 provider / 像样的模型 ID。否则 provider/model 那条正则会误抓
// plugins/dsh-claim-verify、qq-bridge/config.json、notes/00-ideas.md、provider/model 这类文本
//（2026-11-05 hits.jsonl 里 6 次误报全是这个）。
const PROVIDER_LIKE = /^(?:deepseek-account|deepseek|qnaigc|smart|openrouter|openai|anthropic|google|moonshot|zhipu|dashscope|xai|siliconflow|groq|mistral|together|lmstudio|ollama)$/i;
const MODEL_LIKE = /flash|pro|chat|reasoner|turbo|mini|max|vl|vision|sonnet|opus|haiku|gemini|gpt|claude|deepseek|qwen|kimi|glm|ling|doubao|\d/i;
const FILE_EXT_RE = /\.(?:json|jsonl|md|mjs|cjs|js|ts|tsx|jsx|ya?ml|txt|ps1|py|sh|bat|cmd|log|html?|css|toml|ini|cfg)$/i;
const PLACEHOLDER_RE = /^(?:provider|model|prov|llm)$/i;
/** 目录名 / 路径段：`plugins/x`、`notes/y` 这种不是 provider/model。 */
const DIR_LIKE = /^(?:plugins?|notes?|vendor|src|lib|test|dist|relay|auths|sessions|profiles|tools?|docs?|node_modules|config|data|logs?|out|build|qq-bridge|qq-tool-preset)$/i;

/**
 * 从模型输出里抽出四类可核验断言。
 * 只收「像在陈述现状」的，疑问句、举例、假设一律放过（宁漏不误伤）。
 */
export function extractClaims(text) {
  const claims = [];
  if (typeof text !== 'string' || text.length < 4)
    return claims;
  // 注意：这里曾是 < 8，结果「今天是星期三。」（7 字）整句被跳过 —— 2026-11-05 金集评测抓到的漏检。
  // 代码块里的端口/路径多半是示例，不当断言（保长度以维持上下文偏移）
  text = text.replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length));
  // 2026-11-06 误报：引用块（Markdown 的 > 开头）是在复述别人/历史的话。
  // 实测：我引用「现在启动第二个实例（端口 3099）」时被抽成"3099 在监听"。
  text = text.replace(/^[ \t]{0,3}>.*$/gm, (m) => ' '.repeat(m.length));
  // 2026-11-06 自污染：核验器自己追加的【核验】/【实时核验】说明会被下一轮当成"我的断言"，
  // 于是"它说我不对"又被判一次不对 —— 无限自指。整行剔除（保长度以维持偏移）。
  text = text.replace(/^[^\n]*【[^】]*核验[^】]*】[^\n]*$/gm, (m) => ' '.repeat(m.length));

  // 句内作用域：断言词必须与候选值同句；假设句 / 问句整句放过。
  // 旧版用固定字符窗口，上一句的「比如」「没有」会串到下一句（2026-11-05 修）。
  const sents = sentencesOf(text);
  const scopeOf = (index, length, kind) => {
    const s = sentenceAt(sents, index);
    if (!s || META_RE.test(s.text) || CMD_LINE_RE.test(s.text) || SPECULATIVE_RE.test(s.text) || IMPERATIVE_RE.test(s.text) || isTagQuestion(s.text) || /[?？]\s*$/.test(s.text.trim()))
      return null;
    return { ctx: s.text, polarity: polarityOf(s.text, index - s.start, length, kind), start: s.start };
  };

  // 1) 端口：host:port 形式，或「端口 X」且上下文有「在跑/监听/当前」类断言词
  const portRe = /(?:127\.0\.0\.1|localhost|0\.0\.0\.0)[:：](\d{2,5})|(?<!\d)端口\s*(?:号|是|为|[:：])?\s*(\d{2,5})(?!\d)/g;
  for (const m of text.matchAll(portRe)) {
    const port = Number(m[1] ?? m[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      continue;
    // URL 里的 host:port 不是「端口在监听」的断言。
    // 2026-11-05 第 2 次误报：TRAE 登录链接里出现 127.0.0.1:18080/authorize?...，
    // 被抽成「18080 在监听」。
    const after1 = text.slice(m.index + m[0].length, m.index + m[0].length + 1);
    const before1 = text.slice(Math.max(0, m.index - 8), m.index);
    if (after1 === '/' || /(?:https?:\/\/|%2f%2f|\/\/)$/i.test(before1))
      continue;
    const sc = scopeOf(m.index, m[0].length, 'port');
    if (!sc)
      continue;
    // 2026-11-06：历史分句不核（见 tenseAt 注释）。
    if (tenseAt(sc.ctx, m.index - (sc.start ?? 0)) === 'past')
      continue;
    const explicit = m[1] !== undefined;
    // 否定式不再直接丢弃，而是记成**否定断言**、核验时期望值取反：
    // 「18080 没有服务在监听」→ 探活为 false 才算对（2026-11-05 误报 1 次）。
    const asserted = explicit
      || hasAny(sc.ctx, ['在跑', '在跑着', '在线', '活着', '监听', '已启动', '启动在', '当前', '实际', '现在', '通的', '可达', '能访问', '能连']);
    if (!asserted)
      continue;
    claims.push({ kind: 'port', value: port, raw: m[0], ctx: sc.ctx, polarity: sc.polarity });
  }

  // 2) 路径：反引号里的 Windows 路径可以带空格（`C:\Program Files (x86)\...`），
  //    先用专门的正则收一遍；裸路径正则要跳过"已收长路径的前缀"，否则会多出一条 C:\Program。
  //    （2026-11-05 真实语料评测抓到 2 次：Program Files 被空格截断）
  const longPaths = [];
  for (const m of text.matchAll(/`([A-Za-z]:\\[^`\n]{3,}|~\/[^`\n]{3,})`/g)) {
    const value = m[1]
      .split(/[“”‘’「」『』]/)[0]          // 中文引号内才是路径，引号后是解释
      .replace(/[.,;:>）」』"']+$/, '')
      .replace(/#L\d+(?:-L\d+)?$/, '')   // Markdown 行号锚点不是路径的一部分
      .replace(/[\\/]+$/, '');           // 目录尾斜杠去掉，existsSync 两种都认，但别写进断言值
    if (value.length < 4)
      continue;
    const sc = scopeOf(m.index, m[0].length, 'path');
    if (!sc)
      continue;
    if (!hasAny(sc.ctx, ['在', '是', '路径', '文件', '目录', '配置', '备份', '日志', '插件', '脚本', '读', '不存在', '找不到', '写到', '写进', '写入', '生成', '保存', '输出到', '放在']))
      continue;
    // 2026-11-06：`C:\Users\19156\$p1` 这种变量拼接不是真实路径（同 bare 分支）。
    if (/[$<>]/.test(value))
      continue;
    if (PLACEHOLDER_PATH.test(value))
      continue;
    longPaths.push(value);
    claims.push({ kind: 'path', value, raw: m[0], ctx: sc.ctx, polarity: sc.polarity });
  }

  // 完整性类断言：目录里有多少个条目。
  // 依据 No Trace, No Claim (arXiv 2610.09286)：它抓到的一类典型失败是
  // "把当前页的数量当成全量数量报出来"，靠完整性传播才能发现。
  for (const m of text.matchAll(/(?:目录|文件夹)\s*`?([A-Za-z]:\\[^\s`'"，。；）+]+|\/[^\s`'"，。；）+]+)`?[^\n]{0,14}?(?:下|里|中)?\s*(?:有|共|一共|包含)\s*(\d+)\s*个/gi)) {
    const dir = m[1].replace(/[.。,;:）」』"'`]+$/, '').replace(/[\\/]+$/, '');
    if (dir.length < 4)
      continue;
    if (/[$<>]/.test(dir) || PLACEHOLDER_PATH.test(dir))
      continue;
    const sc = scopeOf(m.index, m[0].length, 'path');
    if (!sc)
      continue;
    claims.push({ kind: 'filecount', value: { dir, n: Number(m[2]) }, raw: m[0], ctx: sc.ctx, polarity: 'pos' });
  }

  const pathRe = /(?:(?<![A-Za-z])[A-Za-z]:[\\/][^\s"'`，。；、）)\]}<>“”‘’「」『』]+|~[\\/][^\s"'`，。；、）)\]}<>“”‘’「」『』]+)/g;
  for (const m of text.matchAll(pathRe)) {
    if (longPaths.some((v) => v.startsWith(m[0])))
      continue;
    // 2026-11-06 误报：命令里的 PowerShell 变量（C:\Users\19156\$p1）和提示符片段
    // （C:\Users\19156\>）都被当成了路径，核验时当然"不存在"。
    // 真实路径里几乎不会出现 $ 或尖括号，直接按非路径放过（precision-first）。
    if (/[$<>]/.test(m[0]))
      continue;
    if (PLACEHOLDER_PATH.test(m[0]))
      continue;
    // 尾部标点清洗：反引号/引号/中文标点/尖括号都不算路径的一部分
    const value = m[0]
      .split(/[“”‘’「」『』]/)[0]
      .replace(/[.,;:>）」』"'`]+$/, '')
      .replace(/[<]+$/, '')
      .replace(/#L\d+(?:-L\d+)?$/, '')
      .replace(/[\\/]+$/, '');
    if (value.length < 4)
      continue;
    const sc = scopeOf(m.index, m[0].length, 'path');
    if (!sc)
      continue;
    if (!hasAny(sc.ctx, ['在', '是', '路径', '文件', '目录', '配置', '备份', '日志', '插件', '脚本', '读', '不存在', '找不到', '写到', '写进', '写入', '生成', '保存', '输出到', '放在']))
      continue;
    claims.push({ kind: 'path', value, raw: m[0], ctx: sc.ctx, polarity: sc.polarity });
  }

  // 完整性类断言：目录里有多少个条目。
  // 依据 No Trace, No Claim (arXiv 2610.09286)：它抓到的一类典型失败是
  // "把当前页的数量当成全量数量报出来"，靠完整性传播才能发现。
  for (const m of text.matchAll(/(?:目录|文件夹)\s*`?([A-Za-z]:\\[^\s`'"，。；）+]+|\/[^\s`'"，。；）+]+)`?[^\n]{0,14}?(?:下|里|中)?\s*(?:有|共|一共|包含)\s*(\d+)\s*个/gi)) {
    const dir = m[1].replace(/[.。,;:）」』"'`]+$/, '').replace(/[\\/]+$/, '');
    if (dir.length < 4)
      continue;
    if (/[$<>]/.test(dir) || PLACEHOLDER_PATH.test(dir))
      continue;
    const sc = scopeOf(m.index, m[0].length, 'path');
    if (!sc)
      continue;
    claims.push({ kind: 'filecount', value: { dir, n: Number(m[2]) }, raw: m[0], ctx: sc.ctx, polarity: 'pos' });
  }

  // 3) 模型：provider/model 或带版本号的已知家族 ID；只收「当前在用」类断言
  const modelRe = /\b([a-z][a-z0-9_.\-]{2,})\/([a-z0-9][\w.\-]{1,})\b|\b((?:deepseek|glm|ling|qwen|gpt|claude|kimi|doubao)[\w.\-]*\d[\w.\-]*)\b/gi;
  for (const m of text.matchAll(modelRe)) {
    const sc = scopeOf(m.index, m[0].length);
    if (!sc)
      continue;
    if (!hasAny(sc.ctx, ['当前', '实际', '我在用', '我跑', '本会话', '正在用', '默认模型', '模型是', '这个会话']))
      continue;
    if (m[1] !== undefined) {
      const prov = m[1].toLowerCase();
      const mod = m[2].toLowerCase();
      // 「plugins/dsh-claim-verify」「notes/00-ideas.md」这类是目录/文件名，不是 provider/model
      if (DIR_LIKE.test(prov) || DIR_LIKE.test(mod))
        continue;
      if (PLACEHOLDER_RE.test(prov) || PLACEHOLDER_RE.test(mod))
        continue;
      if (FILE_EXT_RE.test(mod))
        continue;
      if (!PROVIDER_LIKE.test(prov) && !MODEL_LIKE.test(mod))
        continue;
    }
    const value = m[1] !== undefined ? `${m[1]}/${m[2]}` : m[3];
    const provider = m[1] !== undefined ? m[1].toLowerCase() : null;
    claims.push({ kind: 'model', value: value.toLowerCase(), provider, raw: m[0], ctx: sc.ctx });
  }

  // 4) 金额：$X / ¥X / X 元；上下文必须有花费类词
  const moneyRe = /(?:[$¥￥]\s?(\d+(?:\.\d+)?))|(?:(\d+(?:\.\d+)?)\s*(?:美元|美金|元|块钱|块))/g;
  for (const m of text.matchAll(moneyRe)) {
    const amount = Number(m[1] ?? m[2]);
    if (!Number.isFinite(amount) || amount <= 0)
      continue;
    const sc = scopeOf(m.index, m[0].length);
    if (!sc)
      continue;
    const ctx = sc.ctx;
    // 配置值/单价/上限不是「花了多少」，别把参数当花费（2026-11-05 误报一次）
    if (hasAny(ctx, ['上限', '额度', '护栏', '预算', '配置', '参数', '单价', '定价', '阈值', '每M', '/M', '每百万']))
      continue;
    // 真值口径是「今天累计花了多少」。只核今天/累计口径，单次/每会话/配置参数口径一律放过，
    // 否则 perConversationCny: 0.01 这种配置值会被判成"今天只花了 0.01"（2026-11-05 实见）。
    const scopeTotal = hasAny(ctx, ['今天', '今日', '累计', '总共', '一共', '合计']);
    const scopeOther = hasAny(ctx, ['本会话', '这次', '单次', '每次', '每条', '每会话', 'perConversation', 'perDay', 'price', 'quota', 'budget', '会话']);
    if (!scopeTotal || scopeOther)
      continue;
    if (!hasAny(ctx, ['花', '花费', '成本', '账单', '累计', '总花', '用了', '烧了', '花费']))
      continue;
    const unit = m[1] !== undefined ? (m[0].includes('¥') || m[0].includes('￥') ? 'cny' : 'usd') : (m[0].includes('美元') || m[0].includes('美金') ? 'usd' : 'cny');
    claims.push({ kind: 'money', value: amount, unit, raw: m[0], ctx });
  }

  // 5) 程序类（时间 / 日期 / 计数 / 算式）：真值由 extra.js 里的函数算，不经过模型
  claims.push(...extractProgramClaims(text));

  // 6) 主机类（进程 PID / 文件行数 / 文件大小 / 文件哈希）：真值来自本机系统调用
  claims.push(...extractHostClaims(text));

  // 同一断言重复出现（正文 + 表格）只核一次
  // 置信分层：金额/模型/计数 三种口径歧义最大（2026-11-05 实测误报 30/30），只记不报
  const LOW_CONFIDENCE = new Set(['money', 'model', 'count']);
  for (const c of claims)
    c.confidence = LOW_CONFIDENCE.has(c.kind) ? 'low' : 'high';

  const seen = new Set();
  return claims.filter((c) => {
    // 2026-11-06：对象型 value（{dir,n} / {path,bytes} …）直接拼字符串会全变成
    // "[object Object]"，把不同断言当成重复丢掉。统一序列化。
    const v = typeof c.value === 'object' && c.value !== null ? JSON.stringify(c.value) : String(c.value);
    const key = `${c.kind}:${v}`;
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}

// ────────────────────────── 真值 ──────────────────────────

/** 127.0.0.1:port 上有没有东西在监听。 */
export function probePort(port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (listening) => {
      if (done)
        return;
      done = true;
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try {
      socket.connect(port, '127.0.0.1');
    }
    catch {
      finish(false);
    }
  });
}

function expandPath(p) {
  let out = p;
  if (out.startsWith('~/'))
    out = path.join(os.homedir(), out.slice(2));
  return out;
}

export function pathExists(p) {
  try {
    return fs.existsSync(expandPath(p));
  }
  catch {
    return false;
  }
}

/** 读 records.jsonl 尾部若干行，找本会话最后一条 provider/model。 */
export function lastSessionModel(sessionId, file = path.join(dshHome(), 'dsh-bill', 'records.jsonl')) {
  if (!sessionId)
    return null;
  try {
    const size = fs.statSync(file).size;
    const span = Math.min(size, 64 * 1024);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(span);
    fs.readSync(fd, buf, 0, span, size - span);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const rec = JSON.parse(lines[i]);
        if (rec.sessionId === sessionId && rec.provider && rec.model)
          return { provider: String(rec.provider), model: String(rec.model) };
      }
      catch { /* 跨行截断的行跳过 */ }
    }
  }
  catch { /* 文件不在就放弃 */ }
  return null;
}

/** 当天（本地时区）累计 usd。 */
export function todaySpendUsd(file = path.join(dshHome(), 'dsh-bill', 'records.jsonl')) {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const from = start.getTime();
    const raw = fs.readFileSync(file, 'utf8');
    let usd = 0;
    for (const line of raw.split('\n')) {
      if (!line)
        continue;
      let rec;
      try {
        rec = JSON.parse(line);
      }
      catch {
        continue;
      }
      if (typeof rec.time === 'number' && rec.time >= from && typeof rec.usd === 'number')
        usd += rec.usd;
    }
    return usd;
  }
  catch {
    return null;
  }
}

function dshPort() {
  // 2026-11-06：宿主由 launch-web.ps1 拉起时没有 DSH_WEB_URL，只有裸端口变量。
  // 多认几个来源，避免"自己的端口"永远取不到而退回 TCP 探活。
  for (const name of ['DSH_WEB_URL', 'DSH_PORT', 'DSH_WEB_PORT']) {
    const raw = process.env[name];
    if (!raw)
      continue;
    const m = /(\d{2,5})/.exec(raw);
    if (m)
      return Number(m[1]);
  }
  return null;
}

// ────────────────────────── 核验 ──────────────────────────

const CNY_PER_USD = 7.2;

// 告警策略（模块级：跨轮保留冷却记录，每轮重置限额）
const alertPolicy = createAlertPolicy({ cooldownMs: 60_000, maxPerTurn: 3 });

/**
 * 核验一批断言，返回 { checked, bad: [{claim, expect}] }。
 * 任何一类真值取不到，就按 unknown 放过，绝不猜。
 */
export async function verifyClaims(claims, sessionId, cfg, deps = {}) {
  // 每轮独立的主机工具预算与真值缓存（spawn 有成本，见 host.js）
  deps = { ...deps, __host: { spawns: 0, cache: new Map() } };
  const probe = deps.probePort ?? probePort;
  const exists = deps.pathExists ?? pathExists;
  const lastModel = deps.lastSessionModel ?? lastSessionModel;
  const spend = deps.todaySpendUsd ?? todaySpendUsd;
  const ownPort = deps.dshPort ?? dshPort;

  const bad = [];
  let checked = 0;
  // 本轮内的一致性登记册：同一端口/同一条断言不重复探测
  const memo = createCoherence();

  for (const c of claims) {
    if (HOST_KINDS.has(c.kind)) {
      // 2026-11-06：文件类断言（lines/size/hash）**只读一次**，三条断言共用同一份字节快照。
      // 否则三次独立读取之间文件可能变，行数/大小/哈希会自相矛盾（TOCTOU），
      // 更糟的是"验证通过的字节"和"你声称的字节"可能不是同一份。
      if (!deps.__fileSnap) {
        const paths = claims
          .filter((x) => x.kind === 'lines' || x.kind === 'size' || x.kind === 'hash')
          .map((x) => x.value && x.value.path)
          .filter(Boolean);
        deps.__fileSnap = paths.length ? readMany(paths) : new Map();
      }
      // 2026-11-06：快照**失效检测**——同一批断言里文件可能被改写多次，
      // 不能拿入口那份快照一直用（那会把"后来的值"错判成"当时的撒谎"）。
      // 发现过期就重读这一条，保证用到的永远是最新的真实字节。
      const p0 = c.value && c.value.path;
      if (p0 && deps.__fileSnap && deps.__fileSnap.has(p0) && isStale(deps.__fileSnap.get(p0), p0)) {
        deps.__fileSnap.set(p0, readOnce(p0));
        deps.__snapRefreshed = (deps.__snapRefreshed || 0) + 1;
      }
      const hostDeps = deps.fileSnapshot === undefined ? { ...deps, fileSnapshot: deps.__fileSnap } : deps;
      const verdict = await verifyHostClaim(c, cfg, hostDeps);
      if (verdict === null)
        continue;
      checked += 1;
      if (!verdict.ok)
        bad.push({ claim: c, expect: verdict.expect });
      continue;
    }

    if (PROGRAM_KINDS.has(c.kind)) {
      const verdict = await verifyProgramClaim(c, cfg, deps);
      if (verdict === null)
        continue;
      checked += 1;
      if (!verdict.ok)
        bad.push({ claim: c, expect: verdict.expect });
      continue;
    }

    if (c.kind === 'port') {
      // 2026-11-06 接线：同一轮内对同一端口的探测结果复用（coherence 登记册）。
      // 依据 cache coherence：本轮之内"世界版本"没变，就没有理由再探一次。
      const memoKey = 'port|' + c.value;
      let listening;
      const memoized = memo.peek(memoKey);
      if (memoized) {
        listening = memoized.verdict === 'up';
      }
      else {
        listening = await probe(c.value, cfg.portTimeoutMs);
        // 只有"没探测到"才复核（最容易被误判成 INVALID 的方向）
        if (!listening) {
          await new Promise((r) => setTimeout(r, 120));
          const again = await probe(c.value, cfg.portTimeoutMs);
          if (again !== listening)
            continue;
          listening = again;
        }
        memo.put(memoKey, listening ? 'up' : 'down', listening ? 'up' : 'down');
      }
      const verified = listening;
      checked += 1;
      // 否定断言取反核验：「18080 没有服务在监听」→ 探活为 false 才算对
      if (c.polarity === 'neg') {
        if (!verified)
          continue;
        bad.push({ claim: c, expect: `127.0.0.1:${c.value} 上确实有服务在监听，与你说的相反` });
        continue;
      }
      if (verified)
        continue;
      const own = ownPort();
      const nearDsh = hasAny(c.ctx ?? '', ['DSH', 'dsh', 'GUI', '宿主', '网页版']);
      // 2026-11-06 实测：同一句「DSH 实际端口是 64164」被记录 312 次，全部判错。
      // 原因不是抽取错，而是宿主进程里没有 DSH_WEB_URL（launch-web.ps1 起的时候没传），
      // ownPort() 返回 null，于是退回 TCP 探活 → 得到「127.0.0.1 上这个端口没有监听」。
      // 拿不到自己的端口就不要猜：按 unknown 放过（与本文件开头的"绝不猜"一致）。
      if (nearDsh && !own)
        continue;
      const expect = nearDsh ? `DSH 实际端口是 ${own}` : '127.0.0.1 上这个端口没有监听';
      bad.push({ claim: c, expect });
      continue;
    }

    if (c.kind === 'path') {
      const there = exists(c.value);
      checked += 1;
      if (c.polarity === 'neg') {
        if (!there)
          continue;
        bad.push({ claim: c, expect: '这个路径其实存在，与你说的相反' });
        continue;
      }
      if (there)
        continue;
      bad.push({ claim: c, expect: '这个路径不存在' });
      continue;
    }

    // 完整性类：目录条目数。取不到（目录不在）就放过，绝不猜。
    if (c.kind === 'filecount') {
      let n = null;
      try { n = fs.readdirSync(c.value.dir).length; } catch { n = null; }
      if (n === null)
        continue;
      checked += 1;
      if (n === c.value.n)
        continue;
      bad.push({ claim: c, expect: `该目录下实际有 ${n} 个条目，不是 ${c.value.n} 个` });
      continue;
    }

    if (c.kind === 'model') {
      const actual = lastModel(sessionId);
      if (!actual)
        continue;
      checked += 1;
      const claimed = String(c.value).toLowerCase();
      const actualFull = `${actual.provider}/${actual.model}`.toLowerCase();
      const ok = claimed === actualFull || claimed === actual.model.toLowerCase()
        || (c.provider && c.provider === actual.provider.toLowerCase() && claimed === `${actual.provider}/${actual.model}`.toLowerCase());
      if (ok)
        continue;
      bad.push({ claim: c, expect: `本会话实际跑 ${actual.provider}/${actual.model}` });
      continue;
    }

    if (c.kind === 'money') {
      const usd = spend();
      if (usd === null || usd <= 0)
        continue;
      checked += 1;
      const claimedUsd = c.unit === 'cny' ? c.value / CNY_PER_USD : c.value;
      const tol = Math.max(0.05, usd * cfg.moneyTolerance);
      if (Math.abs(claimedUsd - usd) <= tol)
        continue;
      bad.push({ claim: c, expect: `今天实际 $${usd.toFixed(4)}（约 ¥${(usd * CNY_PER_USD).toFixed(2)}）` });
    }
  }

  // 低置信类只记不报；但计数类一旦配了 pagesDir/buttonsFile，真值就可靠了，升为硬判定
  for (const b of bad) {
    const countTrusted = b.claim.kind === 'count' && Boolean(cfg && (cfg.pagesDir || cfg.buttonsFile));
    // 2026-11-06 实测：长回复里写「现在 08:35」，核验可能在十几分钟后才跑，
    // 5 分钟容差必然判错 —— 时间是"写下那一刻"的断言，拿"读到的现在"去否它不成立。
    // 时钟类一律降为 soft（只记日志，不进【核验】），与 low-confidence 同档处理。
    const clockSensitive = b.claim.kind === 'time' || b.claim.kind === 'date';
    b.soft = clockSensitive || (b.claim.confidence === 'low' && !countTrusted);
  }

  // 2026-11-06 新增：把**每条断言**的结论都返回，而不只是 bad。
  // 训练/标定需要正样本（+1），只记「不一致」会导致数据集全负、无法做 PRM。
  // ok 的含义：这条断言被核对了，且与系统真值一致。
  const badKeys = new Set(bad.map((b) => b.claim.kind + '|' + JSON.stringify(b.claim.value)));
  const evaluated = [];
  for (const c of claims) {
    const k = c.kind + '|' + JSON.stringify(c.value);
    const hit = badKeys.has(k);
    const badItem = hit ? bad.find((b) => b.claim === c || (b.claim.kind === c.kind && b.claim.value === c.value)) : undefined;
    evaluated.push({
      kind: c.kind,
      value: c.value,
      reward: hit ? -1 : 1,
      expect: badItem ? badItem.expect : '',
      soft: Boolean(badItem && badItem.soft),
    });
  }

  return { checked, bad, evaluated };
}

/** 每条断言在【核验】里的显示名。新增类别必须在这里登记，否则会掉进"金额"这个兜底分支。 */
const KIND_LABEL = {
  port: (v) => `端口 ${v}`,
  path: (v) => `路径 ${v}`,
  filecount: (v) => `目录条目数 ${v && v.dir}（说 ${v && v.n} 个）`,
  model: (v) => `模型 ${v}`,
  pid: (v) => `进程 PID ${v}`,
  lines: (v) => `行数 ${v && v.path}（说 ${v && v.n} 行）`,
  size: (v) => `文件大小 ${v && v.path}（说 ${v && v.raw}）`,
  hash: (v) => `文件哈希 ${v && v.path}（说 ${v && v.prefix}）`,
  pkgversion: (v) => `依赖版本 ${v && v.name}@${v && v.version}`,
  mem: () => '可用内存',
  disk: (v) => `${v && v.drive} 盘可用空间`,
  service: (v) => `服务 ${v && v.name}（说${v && v.want === 'STOPPED' ? '已停止' : '在运行'}）`,
  registry: (v) => `注册表 ${v && v.key} 的 ${v && v.name}`,
  task: (v) => `计划任务 ${v && v.name}`,
};

/** 把核验结果拼成一段追加说明；没有「硬」不符就返回空串（低置信类只记日志）。 */
export function buildNote(result) {
  // 2026-11-06 双保险：时钟类断言永远不进【核验】。
  // 它们是"写下那一刻"的断言，核验跑在几分钟后，拿现在的钟去否它本来就不成立。
  const hard = (result && result.bad ? result.bad : [])
    .filter((b) => !b.soft && b.claim && b.claim.kind !== 'time' && b.claim.kind !== 'date');
  if (!hard.length)
    return '';
  const lines = hard.map((b) => {
    const fn = KIND_LABEL[b.claim.kind];
    const what = b.claim.label ? b.claim.label : fn ? fn(b.claim.value) : `${b.claim.kind} ${b.claim.raw}`;
    return `- ${what} → ${b.expect}`;
  });
  return `\n\n【核验】本条回复有 ${hard.length} 处断言与实际不符（程序刚跑的，不是模型判断）：\n${lines.join('\n')}\n以上一处按「我改了没验」处理。`;
}

// ────────────────────────── 对外程序化 API ──────────────────────────

/**
 * 不依赖任何框架的核验入口：给它一段文本，它还你「抽到了哪些断言 + 哪些与实际不符」。
 *
 * DSH 只是其中一个适配器（下面的 apply 把它挂到 llm/stream 上）。
 * 想接别的框架（CLI / OpenAI 代理 / LangChain callback / MCP server），直接用这个函数。
 *
 * @param {string} text 待核验的文本
 * @param {object} [opts] { config, sessionId, deps }，deps 用于注入假真值（测试）
 * @returns {Promise<{claims: object[], checked: number, bad: object[]}>}
 */
export async function verifyText(text, opts = {}) {
  const cfg = resolveConfig(opts.config ?? {});
  const claims = extractClaims(text);
  const result = await verifyClaims(claims, opts.sessionId ?? null, cfg, opts.deps ?? {});
  return { claims, ...result };
}

/** 把核验结果渲染成给人看的一段说明（就是追加在回答末尾的那段）。 */
export function renderNote(result) {
  return buildNote(result);
}

/** 回写消息：形状对齐 dsh-llm 的 user message（role + content + source）。 */
function feedbackMessage(text) {
  return {
    role: 'user',
    id: `claim-verify-fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    content: [{ type: 'text', text }],
    source: { kind: 'claim-verify', form: 'notice', summary: '核验回写' },
  };
}

/**
 * 从工具输出里挑一句"最有信息量"的失败摘要。
 * 顺序：错误行 → 退出码行 → 首个非空行。2026-11-05 实测：直接取首行会拿到「(no output)」。
 */
export function failureBrief(text) {
  const lines = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length)
    return '工具返回错误（无输出）';
  const err = lines.find((l) => /(?:^|\s)(?:Error|ERROR|EACCES|EPERM|ENOENT|FAIL|FAILED|npm ERR!|Traceback|panic:)/.test(l));
  const code = lines.find((l) => /\[exit code: [1-9]\d*\]/.test(l));
  return String(err || code || lines[0]).slice(0, 180);
}

// ────────────────────────── 挂载 ──────────────────────────

export function apply(ctx, config) {
  const cfg = resolveConfig(config);
  // 已经落过回执的 report_claims 调用（防止同一份声明在后续轮次被重复落盘）
  const usedReportCalls = new Set();
  // 每个会话最近一次执行前策略的哈希（回执引用它，证明"这次执行发生在哪版策略下"）
  const policyHashes = new Map();

  // ── 回写队列：把核验结论在下一步之前送回模型（§3.5.1）──
  const feedbackQueue = new Map();
  const outcomes = makeOutcomeLog(path.join(path.dirname(cfg.logFile), 'outcomes.jsonl'));
  const fbEnabled = cfg.feedbackMode !== 'off';
  const fbUsesFailure = cfg.feedbackMode === 'failure' || cfg.feedbackMode === 'both';
  const fbUsesAudit = cfg.feedbackMode === 'audit' || cfg.feedbackMode === 'both';
  const MUTATING = new Set(['write', 'edit', 'mcp__cgp__cgp_write_file', 'mcp__cgp__cgp_edit', 'pwsh', 'mcp__cgp__cgp_exec', 'bash', 'shell']);
  // 防"空转"：同一目标最多回写 N 次，再失败就升级；每轮总量也有上限
  const fbTargetCounts = new Map();
  const fbTurnBudget = new Map();
  const ESCALATE_ONCE = new Set();
  function targetKeyOf(name, txt) {
    const first = String(txt || '').split('\n').find((l) => l.trim()) || '';
    return `${name || 'tool'}|${first.slice(0, 100)}`;
  }
  function queueFeedback(sid, text, { target, turn } = {}) {
    if (!fbEnabled || !text)
      return;
    const key = sid || lastSessionId || 'default';
    // 每轮预算
    const budgetKey = key + '#' + (turn ?? 'na');
    const used = fbTurnBudget.get(budgetKey) || 0;
    if (used >= cfg.feedbackBudget)
      return;
    // 同一目标次数上限 → 升级一次，之后静默
    if (target) {
      const tKey = key + '|' + target;
      const n = fbTargetCounts.get(tKey) || 0;
      if (n >= cfg.feedbackMaxPerTarget) {
        if (!ESCALATE_ONCE.has(tKey)) {
          ESCALATE_ONCE.add(tKey);
          const list = feedbackQueue.get(key) || [];
          list.push({ text: `【核验·升级】同一操作已连续失败 ${n} 次（${target}）。不要再重复重试；请向用户说明失败原因、已尝试的方案，或请其介入。`, at: Date.now(), turn });
          feedbackQueue.set(key, list);
          fbTurnBudget.set(budgetKey, used + 1);
        }
        return;
      }
      fbTargetCounts.set(tKey, n + 1);
    }
    const list = feedbackQueue.get(key) || [];
    if (list.some((x) => x.text === text))
      return; // 同一条不重复塞
    list.push({ text, at: Date.now(), turn });
    while (list.length > cfg.feedbackMaxPerTurn)
      list.shift();
    fbTurnBudget.set(budgetKey, used + 1);
    feedbackQueue.set(key, list);
    // 结果回填：记录这次干预，等用户下一步动作关联（§借鉴 outcome 行）
    try { outcomes.intervention(key, { target, text }); } catch { /* 忽略 */ }
  }
  function takeFeedback(sid) {
    const key = sid || lastSessionId || 'default';
    const list = feedbackQueue.get(key) || [];
    if (!list.length)
      return null;
    feedbackQueue.delete(key);
    return list.map((x) => x.text).join('\n');
  }

  const receiptKeyPath = process.env.CLAIM_VERIFY_KEY || path.join(dshHome(), 'claim-verify-receipt.key');  appendLog(path.join(path.dirname(cfg.logFile), 'loads.jsonl'), {
    event: 'loaded', at: new Date().toISOString(), pid: process.pid, version: VERSION, buildId: BUILD_ID, enable: cfg.enable,
  });
  if (cfg.debug)
    appendLog(path.join(path.dirname(cfg.logFile), 'debug.jsonl'), {
      at: new Date().toISOString(), step: 'config', pid: process.pid, version: VERSION, buildId: BUILD_ID,
      enable: cfg.enable, annotate: cfg.annotate, cascadeEnabled: cfg.cascadeEnabled,
      sentenceAudit: cfg.sentenceAudit, sentenceAuditMax: cfg.sentenceAuditMax,
    });
  if (!cfg.enable)
    return;

  // 注册 report_claims 工具：把声明做成结构化工具调用（跨模型通用），没有 tools 服务就跳过
  if (cfg.receipts) {
    try {
      const tools = (ctx && ctx.tools) || (typeof ctx.get === 'function' ? ctx.get('tools') : null);
      if (tools && typeof tools.register === 'function') {
        const tool = makeReportClaimsTool({
          getPairs: (sid) => (sid ? (trace.pairs(sid).pairs || []) : []),
        });
        if (tool)
          tools.register(tool);
      }
    }
    catch (e) {
      console.warn('[claim-verify] report_claims 注册失败：' + (e && e.message));
    }
  }

  // 2026-11-06：承诺工具 commit_claims。
  // 为什么用工具而不是让模型写 ```claims 代码块：schema 由工具参数强制，模型没法把格式写歪；
  // "在散文里输出 JSON 再解析" 是公认反模式。判定结果当场返回给模型，它还有机会改口。
  try {
    const tools = (ctx && ctx.tools) || (typeof ctx.get === 'function' ? ctx.get('tools') : null);
    if (tools && typeof tools.register === 'function') {
      const commitTool = makeCommitClaimsTool({
        verifyClaims,
        verifyHostClaim,
        verifyCommitments,
        summarize: summarizeCommitments,
        cfg,
        onResult: (rec) => appendLog(path.join(path.dirname(cfg.logFile), 'commitments.jsonl'), {
          at: new Date().toISOString(),
          source: 'tool',
          ...rec,
        }),
      });
      if (commitTool)
        tools.register(commitTool);
    }
  }
  catch (e) {
    console.warn('[claim-verify] commit_claims 注册失败：' + (e && e.message));
  }

  // 级联触发：失败记账 → 下一次请求换模型。挂在 agent/request 上（llm/stream 换不了模型）。
  const cascade = createCascade({
    enabled: cfg.cascadeEnabled,
    provider: cfg.cascadeProvider,
    model: cfg.cascadeModel,
    maxEscalations: cfg.cascadeMax,
  }, makeEscalationLogger(path.join(path.dirname(cfg.logFile), 'escalations.jsonl')));

  if (cfg.cascadeEnabled) {
    ctx.on('agent/request', async (payload, next) => {
      // fail-open：路由选择失败绝不能阻断请求
      let seed;
      try {
        seed = await next();
      }
      catch (e) {
        throw e;
      }
      try {
        const target = cascade.decide(null, seed);
        if (!target)
          return seed;
        return { ...seed, provider: target.provider, model: target.model };
      }
      catch {
        return seed;
      }
    });
  }

  // ── 工具轨迹缓冲（v0.3 证据层）────────────────────────────────
  const trace = createTrace();
  // 真实轮次里 options.sessionId 可能没有，所以从 session/event 的 session 对象上记一个
  let lastSessionId = null;
  // 工具结果处理器需要自己的调试器：dbg 是 scheduleAudit 内部的局部变量，在这里不可见。
  const toolDebugFile = path.join(path.dirname(cfg.logFile), 'debug.jsonl');
  const dbgTool = cfg.debug
    ? (o) => appendLog(toolDebugFile, { at: new Date().toISOString(), sessionId: lastSessionId, ...o })
    : () => {};
  // 自己的 call→result 配对队列：原生工具事件常没有 callId（trace.js 会直接丢弃），
  // 所以实时核验不依赖 trace，而按「先进先出」自己配对。
  const pendingCalls = [];
  const pushPending = (d) => {
    const rawArgs = d && (d.arguments ?? d.args);
    let parsed = null;
    try { parsed = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs; } catch { parsed = null; }
    pendingCalls.push({ name: String((d && (d.name ?? d.tool ?? d.toolName)) || 'unknown'), args: parsed, at: Date.now() });
    if (pendingCalls.length > 20)
      pendingCalls.shift();
  };
  ctx.on('session/event', (session, event) => {
    try {
      const sid = session && (session.id || session.sessionId);
      if (sid)
        lastSessionId = sid;
      trace.onEvent(session, event);
      // 结果回填：用户发消息 → 结掉最近一次干预
      if (event && event.type === 'user/message') {
        try { outcomes.userMessage(sid); } catch { /* 忽略 */ }
      }
      if (event && event.type === 'tool/call')
        pushPending(event.data);
      // 观测：确认 tool/result 事件到底有没有到达（debug 打开时才写）
      if (event && String(event.type || '').includes('tool'))
        dbgTool({ step: 'tool-event-seen', type: event.type, hasMessage: Boolean(event.data && event.data.message) });
      // 回写（failure 档）：工具失败时立刻攒一条反馈，下一步之前送进模型
      if (fbUsesFailure && event && event.type === 'tool/result') {
        const msg = event.data && event.data.message;
        if (msg) {
          const callId = (msg.source && msg.source.callId) || msg.toolCallId || msg.tool_call_id;
          const pairsAll = sid ? (trace.pairs(sid).pairs || []) : [];
          // 精确匹配：失败回写只认 callId 对得上的那条，避免误判工具名。
          const pairExact = callId ? pairsAll.find((p) => p.callId === callId) : null;
          // 兜底：原生工具（如 pwsh）的结果消息常没有 callId，实时核验需要 args，
          // 就取「最近一条尚无结果的 pair」——必须是最近的，否则会拿旧调用的参数去核验。
          const pairFallback = pairExact
            || [...pairsAll].reverse().find((p) => p.resultSeen !== true)
            || pairsAll[pairsAll.length - 1]
            || null;
          const name = pairExact && pairExact.name;
          const txt = Array.isArray(msg.content)
            ? (msg.content.filter((c) => c && typeof c.text === 'string').map((c) => c.text).join('\n'))
            : '';
          // 注意：DSH 对「退出码非 0」并不置 isError（实测 false），失败体现在正文的
          // [exit code: N] 标记里。反过来，**成功的命令也可能在输出里打印 FAIL/Error**
          // （比如跑测试套件），所以不能只看关键词，必须优先看退出码。
          // 2026-11-05 实测踩到两次：退出码 0 但输出含 "FAIL" 被误判为失败并回写。
          const codeMatch = /\[exit code: (\d+)\]/.exec(txt);
          const failedNow = msg.isError === true
            || (codeMatch ? Number(codeMatch[1]) >= 1 : false);
          if (failedNow && name !== 'report_claims') {
            const brief = failureBrief(txt);
            const target = targetKeyOf(name, txt);
            queueFeedback(sid, `【核验】上一步工具调用失败${name ? `（${name}）` : ''}：${brief}\n不要声称该操作已完成；先修正或重试，再向用户报告结果。`, { target, turn: event.data?.turn });
          }
          else if (!failedNow) {
            // 实时核验（软件本体感觉）：写类工具返回成功后，立刻问 OS "它在不在"。
            // 依据：回合结束才反馈时信念已形成（§7.6.8 C/D 臂），故必须在动作发生那一刻介入。
            try {
              // 用自己维护的队列配对（原生工具事件无 callId，trace 会丢弃它们）
              const cur = pendingCalls.shift() || null;
              const args = cur && cur.args;
              const inName = cur && cur.name;
              dbgTool({ step: 'inline-enter', name: inName, hasArgs: Boolean(args && Object.keys(args).length), keys: args ? Object.keys(args).join(',') : '' });
              const note = inlineCheck(inName, args, msg);
              if (note) {
                // 首选：把提示并进工具结果本身（观测通道）。
                // 实测：宿主把 message 设为只读（Cannot assign to read only property 'content'），
                // 改动会抛错 → 降级为用户消息。
                let mode = 'user_message';
                try {
                  const appended = appendToToolContent(msg.content, note);
                  if (appended !== null) {
                    msg.content = appended;
                    mode = 'tool_result';
                  }
                }
                catch { mode = 'user_message'; }
                if (mode !== 'tool_result')
                  queueFeedback(sid, note, { target: targetKeyOf(inName, txt), turn: event.data?.turn });
                dbgTool({ step: 'inline', mode, name: inName, target: targetPathOf(args) || (args && (args.command || args.cmd))?.slice(0, 60) });
              }
              else {
                dbgTool({ step: 'inline-noop', name: inName, hasArgs: Boolean(args && Object.keys(args).length), cmd: String((args && (args.command || args.cmd || args.path)) || '').slice(0, 100), isError: msg.isError === true });
              }
            }
            catch (e) { dbgTool({ step: 'inline-error', err: String(e && e.message).slice(0, 160) }); }
          }
        }
      }
    }
    catch { /* 缓冲失败绝不影响会话 */ }
  });

  // 记下当前用的 provider/model，句子级核验的内部调用要用
  let lastRoute = null;

  // ── 回写注入点：每一步开始前，把攒下的核验反馈作为一条 user 消息追加 ──
  // （与 dsh-agent 的 modelSwitchNotice 同一机制：改 decision.messages，不改模型输出）
  if (fbEnabled) {
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next();
      if (!decision || decision.kind === 'reject')
        return decision;
      try {
        const agent = payload && payload.agent;
        const sid = (agent && agent.session && agent.session.id) || (agent && agent.id) || lastSessionId;
        const fb = takeFeedback(sid);
        if (!fb)
          return decision;
        // 审计：把"回写了什么"落盘，事后能查（不记录时会说不清）
        try {
          appendLog(path.join(path.dirname(cfg.logFile), 'feedback.jsonl'), {
            at: new Date().toISOString(),
            sessionId: sid || null,
            step: payload && payload.step,
            level: cfg.feedbackLevel,
            text: String(fb).slice(0, 1000),
          });
        }
        catch { /* 落盘失败不影响注入 */ }
        const messages = Array.isArray(decision.messages) ? decision.messages : [];
        return { ...decision, messages: [...messages, feedbackMessage(fb)] };
      }
      catch {
        return decision;
      }
    });
  }

  /** 句子级三分类核验：只写 audit.jsonl，不改输出、不阻塞流 */
  async function scheduleAudit(sessionId, reportText) {
    const dbgFile = path.join(path.dirname(cfg.logFile), 'debug.jsonl');
    // 默认关闭：每条审计都写，一天能长到十几 MB。排查问题时把 debug 打开。
    const dbg = cfg.debug ? (o) => appendLog(dbgFile, { at: new Date().toISOString(), sessionId, ...o }) : () => {};
    dbg({ step: 'enter', sentenceAudit: cfg.sentenceAudit, reportLen: reportText.length, route: lastRoute });
    try {
      const { pairs: all, truncated } = trace.pairs(sessionId);
      dbg({ step: 'pairs', total: all.length });
      if (!all.length)
        return;
      const turns = all.map((p) => p.turn).filter((t) => Number.isInteger(t));
      const maxTurn = turns.length ? Math.max(...turns) : undefined;
      // 报告经常总结"上一轮"做的事，所以证据窗口取最近 N 轮（默认 2）
      const window = Math.max(1, cfg.auditTurnWindow || 2);
      const windowTurns = new Set();
      for (const t of turns) {
        if (maxTurn !== undefined && t > maxTurn - window)
          windowTurns.add(t);
      }
      const pairs = windowTurns.size
        ? all.filter((p) => windowTurns.has(p.turn))
        : all;
      const turn = maxTurn;
      dbg({ step: 'turn', turn, count: pairs.length, window: [...windowTurns] });
      if (!pairs.length)
        return;

      // 成本闸门：默认只在「本轮有工具失败」时才调模型（省掉 5 秒/轮）
      if (cfg.sentenceAuditOnlyOnFailure && !pairs.some((p) => looksFailed(p))) {
        dbg({ step: 'skip-no-failure', turn, count: pairs.length });
        return;
      }

      // 结构对账优先：零成本、零延迟；命中就不调模型
      const structural = checkPromises(reportText, pairs, { truncated, claimTurn: turn, stat: makeStat() });      dbg({ step: 'structural', covered: structural.covered, counts: summarizePromises(structural.results) });
      // 案例留档：报告 + 证据快照（零模型调用），供以后离线复算精度。不论走哪条分支都留。
      try {
        appendLog(path.join(path.dirname(cfg.logFile), 'cases.jsonl'), makeCase({ sessionId, turn, report: reportText, pairs }));
      }
      catch { /* 留档失败不影响判定 */ }
      if (cfg.structuralFirst && structural.results.length) {
        let finalResults = structural.results;
        const flagged = structural.results.filter((r) => r.verdict === 'contradicted');
        // 三票制：要对外说"它撒谎"之前，先让模型当第二票（≥2 票才保留 contradicted）
        if (flagged.length && cfg.voteOnContradicted && cfg.sentenceAudit) {
          try {
            const t2 = makeLlmTransport({ ctx, route: () => lastRoute });
            const audited = await auditReport(reportText, { pairs, transport: t2, maxSentences: cfg.sentenceAuditMax });
            const voted = voteOnContradicted(structural.results, audited.verdicts);
            finalResults = voted.results;
            dbg({ step: 'voted', confirmed: voted.confirmed, downgraded: voted.downgraded });
          }
          catch (e) {
            dbg({ step: 'vote-failed', err: String(e && e.message) });
            finalResults = structural.results.map((r) => (r.verdict === 'contradicted'
              ? { ...r, verdict: 'uncertain', confidence: 0.3, evidence: `${r.evidence}｜第二票失败，降级` }
              : r));
          }
        }
        // DSL 编译器：把 uncertain 的句子翻成只读检查，交给程序判（比让模型判更保精度）
        let dslInfo = null;
        if (cfg.dslAudit && finalResults.some((r) => r.verdict === 'uncertain')) {
          try {
            const t3 = makeLlmTransport({ ctx, route: () => lastRoute });
            const dsl = await resolveUncertain(finalResults, { transport: t3, max: cfg.dslAuditMax, policy: cfg.dslPolicy });
            finalResults = dsl.results;
            dslInfo = { resolved: dsl.resolved, changed: dsl.changed, details: dsl.details };
            policyHashes.set(sessionId || lastSessionId, policyHash(cfg.dslPolicy));
            // pending 的计划落盘，等人工用 bin/approve.mjs 放行（执行前授权：pending 不执行）
            try {
              for (const d of dsl.details || []) {
                const pending = (d.policy?.decisions || []).filter((x) => x.decision === 'pending');
                if (!pending.length || !d.plan)
                  continue;
                appendLog(path.join(path.dirname(cfg.logFile), 'pending-plans.jsonl'), {
                  at: new Date().toISOString(),
                  digest: sha256Hex(canonicalJson(d.plan)).slice(0, 32),
                  sessionId: sessionId || lastSessionId,
                  turn,
                  sentence: d.sentence,
                  policyHash: policyHash(cfg.dslPolicy),
                  plan: d.plan,
                  status: 'pending',
                });
              }
            }
            catch { /* 落盘失败不影响判定 */ }
            dbg({ step: 'dsl', resolved: dsl.resolved, changed: dsl.changed });
          }
          catch (e) {
            dslInfo = { error: String(e && e.message).slice(0, 160) };
            dbg({ step: 'dsl-failed', err: String(e && e.message) });
          }
        }
        appendLog(path.join(path.dirname(cfg.logFile), 'audit.jsonl'), {
          at: new Date().toISOString(),
          sessionId,
          turn,
          mode: 'structural',
          provider: lastRoute?.provider ?? null,
          model: lastRoute?.model ?? null,
          counts: summarizePromises(finalResults),
          ...(dslInfo ? { dsl: dslInfo } : {}),
          ...(dslInfo && policyHashes.has(sessionId || lastSessionId) ? { policyHash: policyHashes.get(sessionId || lastSessionId) } : {}),
          contradicted: finalResults
            .filter((r) => r.verdict === 'contradicted')
            .map((r) => ({ sentence: r.sentence.slice(0, 200), reason: r.evidence, votes: r.votes ?? 1 })),
        });
        // 外部世界模型：把每条判定写进账本（长期可统计反驳率）
        try {
          for (const r of finalResults) {
            if ((r.verdict === 'supported' || r.verdict === 'contradicted') && r.target) {
              recordFact({
                kind: r.kind === 'write' ? 'file' : (r.kind === 'port' ? 'port' : 'other'),
                target: r.target,
                verdict: r.verdict,
                detail: String(r.evidence || r.reason || '').slice(0, 120),
              });
            }
          }
        }
        catch { /* 账本失败不影响主流程 */ }
        // 回写（audit 档）：把本轮判出的矛盾攒起来，下一轮开始前送给模型
        if (fbUsesAudit) {
          const bad = finalResults.filter((r) => r.verdict === 'contradicted');
          if (bad.length) {
            const fb = buildFeedback(
              bad.map((r) => {
                const prim = r.kind === 'write' ? 'path' : (r.kind === 'port' ? 'port' : null);
                const hintArgs = r.kind === 'write'
                  ? { path: r.target }
                  : (r.kind === 'port' ? { host: '127.0.0.1', port: Number(r.target) } : null);
                const hint = prim && hintArgs ? reproduceHint(prim, hintArgs, true) : null;
                // 账本里若有近期相反记录，一并给模型（长期记忆的价值）
                let ledgerNote = null;
                try {
                  if (r.target) {
                    const kind = r.kind === 'write' ? 'file' : (r.kind === 'port' ? 'port' : 'other');
                    const past = lookupFact({ kind, target: r.target });
                    if (past && !past.stale && past.verdict === 'supported')
                      ledgerNote = `${Math.round(past.ageMs / 60000)} 分钟前核验过该对象且当时成立，现在不成立——状态已变化`;
                  }
                }
                catch { /* 忽略 */ }
                // B/C：自校准与重复假声明（两者都只读账本，零模型调用）
                let calNote = null;
                try {
                  const ck = r.kind === 'write' ? 'file' : (r.kind === 'port' ? 'port' : 'other');
                  if (r.target)
                    calNote = repeatLiarNote(ck, r.target) || calibrationNote(ck, r.target);
                }
                catch { /* 忽略 */ }
                return { verdict: 'contradicted', target: r.sentence, reason: r.evidence, ...(hint ? { hint } : {}), ...(ledgerNote ? { ledgerNote } : {}), ...(calNote ? { calNote } : {}) };
              }),
              cfg.feedbackLevel,
            );
            queueFeedback(sessionId || lastSessionId, fb);
          }
        }
        return;
      }

      // 模型层必须显式开启（sentenceAudit）。这一行之前缺失，导致 sentenceAudit=false
      // 时也会因为 structuralAudit 打开而走到模型判定（成本泄漏，2026-11-05 修）。
      if (!cfg.sentenceAudit)
        return;

      let transport;
      try { transport = makeLlmTransport({ ctx, route: () => lastRoute }); }
      catch (e) { dbg({ step: 'no-transport', err: String(e && e.message) }); return; }

      // 报告隔离审计：模型只解析声明，证据与判定都是确定性的（依据 arXiv 2610.29609 的泄漏发现）
      if (cfg.isolatedAudit) {
        const iso = await auditIsolated(reportText, pairs, { transport, maxSentences: cfg.sentenceAuditMax });
        appendLog(path.join(path.dirname(cfg.logFile), 'audit.jsonl'), {
          at: new Date().toISOString(),
          sessionId,
          turn,
          mode: 'isolated',
          provider: lastRoute?.provider ?? null,
          model: lastRoute?.model ?? null,
          counts: iso.counts || { supported: 0, contradicted: 0, insufficient: 0 },
          error: iso.error || null,
          contradicted: (iso.results || [])
            .filter((r) => r.verdict === 'contradicted')
            .map((r) => ({ sentence: String(r.sentence).slice(0, 200), reason: r.reason })),
        });
        return;
      }

      const r = await auditReport(reportText, { pairs, transport, maxSentences: cfg.sentenceAuditMax });
      dbg({ step: 'audited', sentences: r.sentences.length, verdicts: r.verdicts.length, error: r.error, grounding: r.groundingChars, rawPreview: r.rawPreview });
      if (r.error === 'no-evidence' || !r.verdicts.length) {
        // 沉默失败最难查：模型层跑过但没产出，也要留一条，否则线上看起来像"没跑"
        appendLog(path.join(path.dirname(cfg.logFile), 'audit.jsonl'), {
          at: new Date().toISOString(),
          sessionId,
          turn,
          mode: 'llm',
          error: r.error || 'no-verdicts',
          sentences: r.sentences.length,
          counts: { supported: 0, contradicted: 0, insufficient: 0 },
          contradicted: [],
        });
        return;
      }
      appendLog(path.join(path.dirname(cfg.logFile), 'audit.jsonl'), {
        at: new Date().toISOString(),
        sessionId,
        turn,
        mode: 'llm',
        provider: lastRoute?.provider ?? null,
        model: lastRoute?.model ?? null,
        counts: summarize(r.verdicts),
        contradicted: r.verdicts
          .filter((v) => v.verdict === 'contradicted')
          .map((v) => ({ sentence: v.sentence.slice(0, 200), reason: v.reason })),
      });
    }
    catch (e) {
      dbg({ step: 'error', err: String(e && e.message) });
      try {
        appendLog(path.join(path.dirname(cfg.logFile), 'audit.jsonl'), {
          at: new Date().toISOString(), sessionId, turn, mode: 'error',
          error: String(e && e.message).slice(0, 300),
          counts: { supported: 0, contradicted: 0, insufficient: 0 }, contradicted: [],
        });
      }
      catch { /* 记不下来也无所谓 */ }
    }
  }

  ctx.on('llm/stream', (options, next) => {
    // 内部调用（句子级核验）直接放行：否则插件会去核验核验器的输出，无限套娃
    if (options && options[INTERNAL_FLAG])
      return next();
    if (options && typeof options.provider === 'string' && typeof options.model === 'string')
      lastRoute = { provider: options.provider, model: options.model };
    const sessionId = options && typeof options.sessionId === 'string' ? options.sessionId : null;

    async function* verifyStream() {
      const source = next();
      let text = '';
      const types = new Set();
      let sample = null;
      // 模型流按 block index 聚合。插件自己合成的 text-delta 必须带合法 index，
      // 否则内核 safeIndex 校验会抛 "text-delta index must be a non-negative safe integer"，整轮直接失败。
      let maxIndex = -1;
      for await (const chunk of source) {
        if (chunk && typeof chunk.type === 'string') {
          types.add(chunk.type);
          if (!sample && (typeof chunk.text === 'string' || chunk.delta || chunk.content))
            sample = chunk;
        }
        if (chunk && Number.isSafeInteger(chunk.index) && chunk.index > maxIndex)
          maxIndex = chunk.index;
        if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string')
          text += chunk.text;
        if (chunk && chunk.type === 'finish') {
          let note = '';
          const redFlagInfo = detectRedFlag(text);
          try {
            const claims = extractClaims(text);
            if (claims.length) {
              const result = await Promise.race([
                verifyClaims(claims, sessionId, cfg),
                new Promise((r) => setTimeout(() => r(null), cfg.budgetMs)),
              ]);
              // 每次核验都留一行（含没报的），用来统计覆盖与"核验过但没问题"的样本
              if (result)
                appendLog(path.join(path.dirname(cfg.logFile), 'checks.jsonl'), {
                  at: new Date().toISOString(), version: VERSION, buildId: BUILD_ID, sessionId,
                  checked: result.checked, bad: result.bad.length,
                  kinds: [...new Set(claims.map((c) => c.kind))],
                  // 措辞红旗：高精确低召回，只用于"优先核验/后验统计"，不作豁免依据
                  redFlag: redFlagInfo.redFlag, redFlagMarkers: redFlagInfo.markers,
                });
                // 2026-11-06：逐条断言落 `steps.jsonl`（**含正样本 +1**）。
                // 之前只记 bad，导致训练数据全负、没法做 PRM。这里按 PRM800K 三态记录：
                // +1 与真值一致 / -1 不一致 / 0 低置信（soft，只记不报）。
                if (result && Array.isArray(result.evaluated) && result.evaluated.length) {
                  const stepsFile = path.join(path.dirname(cfg.logFile), 'steps.jsonl');
                  for (const ev of result.evaluated) {
                    appendLog(stepsFile, {
                      at: new Date().toISOString(),
                      sessionId,
                      kind: ev.kind,
                      value: ev.value,
                      prediction: JSON.stringify(ev.value),
                      observation: ev.expect || '与系统真值一致',
                      reward: ev.soft ? 0 : ev.reward,
                    });
                  }
                }
                // ── 模型自愿声明的承诺块 ```claims [{"kind","value","expect"}] ──
                // 依据 CLAIMRECEIPT (NeurIPS 2026)：断言绑定证据、判定三态
                // PASS / INVALID / INCONCLUSIVE，而不是成功/失败两态。
                // 为什么要有这条：自然语言里可核验断言只有 1.4 条/100 句，
                // 让模型显式声明是唯一能把密度提上去的办法（ARC 也是这么做的）。
                try {
                  const { items } = parseCommitments(text);
                  if (items.length) {
                    const cs = await verifyCommitments(items, { verifyClaims, verifyHostClaim, cfg });
                    appendLog(path.join(path.dirname(cfg.logFile), 'commitments.jsonl'), {
                      at: new Date().toISOString(),
                      sessionId,
                      total: cs.total,
                      pass: cs.pass,
                      invalid: cs.invalid,
                      inconclusive: cs.inconclusive,
                      results: cs.results,
                    });
                    const line = summarizeCommitments(cs);
                    if (line)
                      note = (note ? note + '\n\n' : '') + line;
                  }
                }
                catch { /* 承诺块核验失败绝不打断对话 */ }
              if (result && result.bad.length) {
                // 2026-11-06 接线：告警策略（治 alert fatigue）。
                // 运维/IDS 的经验：告警的价值不是"抓多少"，而是"不打扰"——
                // 误报多了人就会关掉它，关掉之后真阳性一起失效。
                // 规则：同一断言 60s 内只报一次；每轮最多报 3 条；其余只写日志。
                alertPolicy.resetTurn();
                const kept = [];
                const suppressedKeys = [];
                for (const b of result.bad) {
                  const key = b.claim.kind + '|' + JSON.stringify(b.claim.value);
                  const decision = alertPolicy.shouldAlert({ key, severity: b.soft ? 'normal' : 'normal' });
                  if (decision.alert)
                    kept.push(b);
                  else
                    suppressedKeys.push(key);
                }
                const shownResult = { ...result, bad: kept };
                note = cfg.annotate && kept.length ? buildNote(shownResult) : '';
                // 只有「硬」不符（非低置信）才触发升级，避免拿噪音去换模型
                const hardCount = result.bad.filter((b) => !b.soft).length;
                if (hardCount)
                  cascade.noteFailure(sessionId, hardCount);
                appendLog(cfg.logFile, {
                  at: new Date().toISOString(),
                  version: VERSION,
                  sessionId,
                  provider: options?.provider ?? null,
                  model: options?.model ?? null,
                  checked: result.checked,
                  bad: result.bad.map((b) => ({ kind: b.claim.kind, claim: b.claim.value, expect: b.expect, soft: !!b.soft })),
                  // 原文片段：只留最近的 2000 字，供未来回归重放（2026-11-05 加）
                  text: text.slice(-2000),
                });
              }
            }
          }
          catch { /* 核验失败绝不打断对话 */ }
          // ── 结构化声明 → 证据回执（2026-11-05 第一期）────────────
          // 只有当本轮输出里带 ```claims 块时才生成；只写文件，不改输出、不阻塞。
          if (cfg.receipts && text) {
            try {
              const sid = sessionId || lastSessionId;
              const allPairs = sid ? (trace.pairs(sid).pairs || []) : [];
              const turns = allPairs.map((p) => p.turn).filter((t) => Number.isInteger(t));
              const maxTurn = turns.length ? Math.max(...turns) : undefined;
              // 优先取模型调用 report_claims 工具时传的声明（结构化、不会写歪）；
              // 只认本轮（maxTurn）的调用，避免把上一轮的旧声明重复落成新回执
              let declared = null;
              if (sid) {
                const ps = allPairs;
                const call = [...ps].reverse().find((p) => p.name === 'report_claims'
                  && p.args && Array.isArray(p.args.claims)
                  && !usedReportCalls.has(p.callId)
                  && (!Number.isInteger(p.turn) || maxTurn === undefined || p.turn === maxTurn));
                if (call) {
                  declared = call.args.claims;
                  if (call.callId)
                    usedReportCalls.add(call.callId);
                }
              }
              if (!declared)
                declared = extractClaimsBlock(text);
              if (declared) {
                const win = Math.max(1, cfg.auditTurnWindow || 2);
                const scope = maxTurn === undefined
                  ? allPairs
                  : allPairs.filter((p) => !Number.isInteger(p.turn) || p.turn > maxTurn - win);
                const receipt = buildReceipt({ sessionId: sid, claims: declared, pairs: scope, keyPath: receiptKeyPath });
                // 声明覆盖率：agent 实际动作里有多少被它声明了（只量化，不阻止）
                let cov = null;
                try {
                  const c = declaredCoverage({ pairs: scope, claims: declared });
                  cov = { actual: c.actual, declared: c.declared, matched: c.matched, coverage: c.coverage, undeclaredCount: c.undeclared.length };
                }
                catch { /* 覆盖率算不出来不影响回执 */ }
                // 信封（Ed25519 签名）+ 线性哈希链：外部可独立验签、可验顺序
                let record = receipt;
                try {
                  const dir = path.dirname(cfg.logFile);
                  const kp = loadOrCreateKeypair(dir);
                  const prev = lastReceiptDigest(path.join(dir, 'receipts.jsonl'));
                  const tail = aivsTail(path.join(dir, 'receipts.jsonl'));
                  const ph = policyHashes.get(sid);
                  record = { ...receipt, ...(ph ? { policyHash: ph } : {}), ...(cov ? { coverage: cov } : {}), prevDigest: prev, chain: chainDigest(prev, receipt.digest) };
                  // AIVS 对齐：行哈希 + 链（IETF draft-stone-aivs-01 第 3 节）
                  try {
                    record.aivs = aivsFields({ rowId: tail.count + 1, sessionId: sid, timestamp: Date.now() / 1000, prevHash: tail.head });
                  }
                  catch { /* AIVS 字段失败不影响回执本体 */ }
                  record.envelope = makeEnvelope(record, kp);
                }
                catch { /* 签名失败就退回只有 HMAC 的旧格式 */ }
                appendLog(path.join(path.dirname(cfg.logFile), 'receipts.jsonl'), record);
                console.log(`[claim-verify] 回执：${receipt.summary.supported} 支持 / ${receipt.summary.contradicted} 反驳 / ${receipt.summary.insufficient} 无证据`);
              }
            }
            catch { /* 回执失败不影响对话 */ }
          }
          // ── 对账（结构化层零模型调用；句子级模型核验是可选层）──────
          // 只记日志、不追加说明、不阻塞流：模型调用是异步的，fire-and-forget。
          // 2026-11-05 解耦：结构对账（promise/evidence/vote）不再被 sentenceAudit 挡住——
          // 之前它默认不跑，等于"轨迹证据核验"在线上是休眠的。
          if (cfg.sentenceAudit || cfg.structuralAudit) {
            const sid = sessionId || lastSessionId;
            if (cfg.debug) {
              const dbgFile0 = path.join(path.dirname(cfg.logFile), 'debug.jsonl');
              appendLog(dbgFile0, { at: new Date().toISOString(), step: 'finish-seen', sessionId, lastSessionId, sid, textLen: text.length, types: [...types].slice(0, 12), sample: sample ? JSON.stringify(sample).slice(0, 300) : null });
            }
            if (sid && text)
              scheduleAudit(sid, text).catch(() => {});
          }

          if (note) {
            // fail-open：合成 text-delta 失败绝不能打断流
            try {
              yield { type: 'text-delta', index: maxIndex + 1, text: note };
            }
            catch { /* 忽略 */ }
          }
        }
        yield chunk;
      }
    }

    return verifyStream();
  });
}
