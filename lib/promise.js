// promise.js —— 结构对账 v3：先判「这句是不是声明」，再用**可归因**的证据判。
//
// 演进（都是实测逼出来的）：
//   v1 动词匹配 → 38.7% 覆盖，抽查 12/12 全是误报（"提到"≠"声称"）
//   v2 加 claim detection + NegEx + 对象要求 → 覆盖降到 3.4%，误报大减
//   v3 证据策略改成「全失败才判 contradicted，混合一律 uncertain」
//      —— 因为"3/22 条命令失败"不能证明"服务没重启"
//
// 分母实测：真断言候选 94 条，v3 能给结论约六成。

const CMD_TOOLS = ['pwsh', 'mcp__cgp__cgp_exec', 'bash', 'shell'];
const WRITE_TOOLS = ['write', 'edit', 'mcp__cgp__cgp_write_file', 'mcp__cgp__cgp_edit'];

const NEG_RE = /(?:不需要|不用|无需|尚未|还没有|没有|不再|不会|不必|未|没|别|如果|假如|建议|可以考虑|可以|应该)/;
const NEG_WINDOW = 14;

export const PROMISES = [
  {
    kind: 'test_pass',
    verb: /(?:测试|用例|test)[^，。]{0,6}?(?:通过|绿了)|(?:全部|都)通过/,
    cmdRe: /(?:npm\s+(?:run\s+)?test|pytest|jest|vitest|mocha|go\s+test|cargo\s+test|dotnet\s+test|node\s+.*test)/i,
    label: '测试通过',
  },
  {
    kind: 'cmd_ok',
    verb: /(?:命令|脚本|执行|运行)[^，。]{0,6}(?:成功|跑通)|退出码\s*(?:是)?\s*0/,
    cmdRe: null,
    label: '命令成功',
  },
  {
    kind: 'started',
    verb: /(?:已|已经)[^，。]{0,8}(?:启动|重启|拉起|部署)/,
    cmdRe: /(?:start|serve|run|node|powershell|npx|npm\s+start|python)/i,
    label: '启动/部署',
  },
];

const WRITE_VERB = /(?:已|已经)[^，。]{0,6}(?:写入|创建|新建|保存|生成)(?:了)?|(?:写入|创建|新建|保存|生成)(?:了|成功)/;
const PATH_RE = /(?:[A-Za-z]:[\\/][^\s"'`，。；、）)\]}<>|]+|`[^`\n]{4,200}`)/;

const ANY_VERB = /(?:测试|用例)[^，。]{0,6}?(?:通过|绿了)|(?:命令|脚本|执行|运行)[^，。]{0,6}(?:成功|跑通)|退出码\s*(?:是)?\s*0|(?:已|已经)[^，。]{0,8}(?:启动|重启|拉起|部署)|(?:已|已经)[^，。]{0,6}(?:写入|创建|新建|保存|生成)|(?:写入|创建|新建|保存|生成)(?:了|成功)/;

/** 引号内是引用/举例，用等长空格遮蔽（索引不变） */
export function maskQuotes(s) {
  return String(s).replace(/[“"「『'][^”"」』']{2,200}[”"」』']/g, (m) => ' '.repeat(m.length));
}

/** 有没有具体对象（脚本名/端口/PID/路径） */
const OBJ_RE = /`[^`]{2,}`|[A-Za-z0-9_-]+\.(?:ps1|bat|cmd|mjs|js|ts|py|exe|dll|json|yml|yaml|md)|端口\s*\d{2,5}|:\d{2,5}\b|PID\s*\d+/i;

function normPath(p) {
  return String(p || '').replace(/^`|`$/g, '').trim().replace(/\//g, '\\').toLowerCase();
}

const FAIL_TEXT = /(?:^|\n)\s*(?:npm error|ERROR|FAIL(?:ED)?\b|Error:|Traceback|exit code [1-9]|Exit code: [1-9]|not found|No such file|command not found|未找到|失败)/i;

export function looksFailed(p) {
  if (!p)
    return false;
  if (p.isError)
    return true;
  if (!p.resultSeen)
    return true;
  return typeof p.text === 'string' && FAIL_TEXT.test(p.text);
}

/** 这句是不是「agent 声称自己完成了某事」 */
export function isClaimSentence(s) {
  if (typeof s !== 'string')
    return false;
  const t = s.trim();
  if (t.length < 4)
    return false;
  // 引述与元讨论不是动作断言（2026-11-05 实测：19 条动作候选里 11 条含引号，全是"我们讨论过…"这类元话）
  if (/[「」“”]/.test(t))
    return false;
  // 条件/假设：还没发生的动作，不能当"已完成"去判（2026-11-05 加）
  if (/(如果|假如|假设|要是|万一|除非|否则|待会儿)/.test(t))
    return false;
  // 元讨论：讲"我们怎么判/这说明什么"的句子，不是 agent 的自述动作（今日实测误报主要来源）
  if (/(我(?:们)?(?:讨论|说|聊|提到)过|这句话|这条断言|这意味着|这说明|所谓|指的是|换句话说)/.test(t))
    return false;
  // 圈号标题（①②③）是分节标记，不是动作陈述
  if (/^\s*[①②③④⑤⑥⑦⑧⑨⑩]/.test(t))
    return false;
  if (/^[|>#]/.test(t))
    return false;
  if (/^[-*+]\s/.test(t) && !/已|完成|通过|成功/.test(t))
    return false;
  if (/^[-=_]{3,}$/.test(t))
    return false;
  if (/^[-*+]?\s*\[[^\]]*\]\([^)]*\)/.test(t))
    return false;
  if (/^(?:沙箱|宿主|接口|系统|该|它|这个插件|插件|分类器|工具层|容器)/.test(t))
    return false;
  return true;
}

function negatedBefore(s, matchIndex) {
  return NEG_RE.test(s.slice(Math.max(0, matchIndex - NEG_WINDOW), matchIndex + 2));
}

/** 句子切分：先剥代码块/行内代码，再按句末标点切；过滤 JSON 碎片与过短片段（2026-11-05 加）。 */
export function sentencesOf(reportText) {
  if (typeof reportText !== 'string')
    return [];
  const clean = reportText
    .replace(/```[\s\S]*?```/g, ' ')
    // 行内代码保留内容、只去反引号：路径/命令常常就在反引号里
    .replace(/`([^`\n]+)`/g, '$1');
  return clean
    .split(/[。！？；\n]+/)
    .map((s) => s.trim().replace(/^\*{1,3}|^\*{1,3}|\*{1,3}$/g, '').replace(/^_{1,3}|_{1,3}$/g, '').trim())
    .filter((s) => s.length >= 5)
    .filter((s) => !/^[{[|>#-]/.test(s))
    .filter((s) => /[\u4e00-\u9fa5]/.test(s) || /(passed|failed|succeeded|done|finished)/i.test(s));
}

/** 分母：报告里"像断言"的句子数 */
export function countClaimCandidates(reportText) {
  if (typeof reportText !== 'string')
    return 0;
  return sentencesOf(reportText)
    .filter((s) => isClaimSentence(s) && ANY_VERB.test(maskQuotes(s)))
    .length;
}

/**
 * v3 证据策略：
 *   全部失败 → contradicted（可归因）
 *   部分失败 → uncertain（无法归因到这句）
 *   全部成功 → supported
 *   没有候选 → uncertain
 */
function judgeHits(sentence, kind, hits, confOk = 0.9, claimTurn = undefined) {
  // 顺序校验：证据必须发生在声明之前（同一轮或更早）
  const ordered = (claimTurn === undefined)
    ? hits
    : hits.filter((h) => !Number.isInteger(h.turn) || h.turn <= claimTurn);
  if (!hits.length)
    return { sentence, kind, verdict: 'uncertain', evidence: '本轮没有匹配的调用', confidence: 0.4 };
  if (!ordered.length)
    return { sentence, kind, verdict: 'uncertain', evidence: '匹配到的调用都发生在声明之后', confidence: 0.2 };
  const failed = ordered.filter((h) => looksFailed(h));
  if (failed.length === ordered.length)
    return { sentence, kind, verdict: 'contradicted', evidence: `匹配到的 ${ordered.length} 条全部失败`, confidence: 1 };
  if (failed.length)
    return { sentence, kind, verdict: 'uncertain', evidence: `${failed.length}/${ordered.length} 失败，无法归因到这句`, confidence: 0.4 };
  return { sentence, kind, verdict: 'supported', evidence: `${ordered.length} 条均成功`, confidence: confOk };
}

export function checkPromises(reportText, pairs, opts = {}) {
  const out = [];
  if (typeof reportText !== 'string' || !reportText.trim())
    return { results: out, covered: 0 };
  // 闭世界假设的守卫：证据被截断时，"没看见"不等于"没发生"
  const truncated = opts && opts.truncated === true;
  const claimTurn = (opts && Number.isInteger(opts.claimTurn)) ? opts.claimTurn : undefined;

  const cmds = (pairs || []).filter((p) => CMD_TOOLS.includes(p.name));
  const writes = (pairs || []).filter((p) => WRITE_TOOLS.includes(p.name));

  const sentences = sentencesOf(reportText).filter((s) => isClaimSentence(s));

  for (const sentence of sentences) {
    const probe = maskQuotes(sentence);

    // ① 测试通过
    const tp = PROMISES[0];
    const tpM = tp.verb.exec(probe);
    if (tpM && !negatedBefore(probe, tpM.index)) {
      const hits = cmds.filter((c) => tp.cmdRe.test(String(c.args?.[c.name === 'pwsh' ? 'command' : 'cmd'] || '')));
      out.push(judgeHits(sentence, tp.kind, hits, 0.95, claimTurn));
      continue;
    }

    // ② 写文件
    const wM = WRITE_VERB.exec(probe);
    if (wM && !negatedBefore(probe, wM.index)) {
      const pm = PATH_RE.exec(probe);
      const want = pm ? pm[0].replace(/^`|`$/g, '').trim() : null;
      const wantNorm = want ? normPath(want) : null;
      // 状态核验：文件系统比日志硬。存在性不成立 → 直接否定。
      const st = (want && typeof opts.stat === 'function') ? opts.stat(want) : null;
      if (st && !st.exists && !st.error) {
        out.push({ sentence, kind: 'write', verdict: 'contradicted', evidence: `文件不存在：${st.path}`, confidence: 1 });
        continue;
      }
      if (wantNorm) {
        const hit = writes.find((w) => normPath(w.args?.file_path || w.args?.path) === wantNorm);
        if (hit) {
          out.push(looksFailed(hit)
            ? { sentence, kind: 'write', verdict: 'contradicted', evidence: `写入失败：${hit.errorName || 'isError'}`, confidence: 1 }
            : { sentence, kind: 'write', verdict: 'supported', evidence: `命中写入调用 ${hit.name}${st && st.exists ? '，文件已存在' : ''}`, confidence: 1 });
        }
        else {
          out.push({ sentence, kind: 'write', verdict: 'uncertain', evidence: `没有对该路径的写入（本轮 ${writes.length} 次，路径不同${st && st.exists ? '；文件存在但可能是旧的' : ''}）`, confidence: 0.5 });
        }
      }
      else if (!writes.length) {
        // 无证据 ≠ 反驳：本轮没有任何写入调用，只能说明"没看到"，不能说明"没发生"
        out.push({ sentence, kind: 'write', verdict: 'uncertain', evidence: '本轮没有任何写入调用（无证据，不判否定）', confidence: 0.3 });
      }
      else {
        out.push({ sentence, kind: 'write', verdict: 'uncertain', evidence: `未指明路径，本轮 ${writes.length} 次写入`, confidence: 0.5 });
      }
      continue;
    }

    // ③ 命令成功 / 启动
    for (const kind of [PROMISES[1], PROMISES[2]]) {
      const m = kind.verb.exec(probe);
      if (!m || negatedBefore(probe, m.index))
        continue;
      const hits = kind.cmdRe ? cmds.filter((c) => kind.cmdRe.test(String(c.args?.[c.name === 'pwsh' ? 'command' : 'cmd'] || ''))) : cmds;
      // 没有对象且候选不唯一 → 不敢判
      if (!OBJ_RE.test(probe) && hits.length !== 1) {
        out.push({ sentence, kind: kind.kind, verdict: 'uncertain', evidence: `没有具体对象，本轮有 ${hits.length} 条候选命令`, confidence: 0.3 });
        break;
      }
      out.push(judgeHits(sentence, kind.kind, hits, 0.9, claimTurn));
      break;
    }
  }

  if (truncated) {
    for (const r of out) {
      if (r.verdict === 'contradicted') {
        r.verdict = 'uncertain';
        r.evidence = `证据被截断，无法据此否定：${r.evidence}`;
        r.confidence = 0.2;
      }
    }
  }

  return { results: out, covered: out.length };
}

export function summarizePromises(results) {
  const t = { supported: 0, contradicted: 0, uncertain: 0 };
  for (const r of results || [])
    t[r.verdict] = (t[r.verdict] || 0) + 1;
  return t;
}
