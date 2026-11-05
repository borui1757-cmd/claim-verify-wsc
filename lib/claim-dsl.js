// claim-dsl.js —— 把自然语言断言「编译」成 DSL 检查计划，再由程序执行。
//
// 流程：
//   1. generatePlan(sentence)  模型只做翻译，输出 JSON 计划（受 dsl.js 白名单约束）
//   2. validatePlan(plan)      不合格直接丢弃（不执行、不瞎判）
//   3. runPlan(plan)           程序执行，得到 supported/contradicted/insufficient
//   4. checkConsistency()      可选：再问一次"这个计划是否真的在核对原句"，防"计划写歪" 
//
// 关键：最终判定来自**程序执行**，不是模型判断。模型只负责翻译。

import { PRIMS, validatePlan, runPlan } from './dsl.js';
import { makeWitness } from './witness.js';

/** 生成给模型的可用原语清单（自动从 PRIMS 派生，避免文档漂移）。 */
export function primitiveDocs() {
  return Object.entries(PRIMS).map(([name, def]) => {
    const params = Object.keys(def.params).join(', ');
    return `- ${name}(${params})`;
  }).join('\n');
}

const SCHEMA_HINT = `输出 JSON：{"all":[{"prim":"原语名","args":{...},"expect":true|false}]}
- expect 表示"这句话断言该检查为真(true)还是为假(false)"
- **默认 expect 一律为 true**；只有当句子明确断言否定（"不存在""没有""没在跑"）时才用 false
- 最多 6 条检查；做不了就输出 {"unsupported":"原因"}，**不要猜**

示例（与评测集不重叠的数值）：
"2500 乘以 4 等于 10000" → {"all":[{"prim":"math_eq","args":{"expr":"2500*4","value":10000},"expect":true}]}
"service.log 不存在" → {"all":[{"prim":"exists","args":{"path":"C:\\\\logs\\\\service.log"},"expect":false}]}
"public 目录下有 5 个 png" → {"all":[{"prim":"dir_count","args":{"dir":"C:\\\\public","ext":".png","count":5},"expect":true}]}
"服务在 4321 上监听" → {"all":[{"prim":"port","args":{"port":4321},"expect":true}]}`;

/** 构造生成提示词。 */
export function buildPrompt(sentence, { evidenceHint = '' } = {}) {
  return [
    '你是断言编译器。把下面这句话翻译成一组「只读检查」，用给定的原语表达。',
    '',
    '可用原语：',
    primitiveDocs(),
    '',
    '要求：',
    '- 只表达这句话**断言的事实**，不要扩展到无关内容',
    '- 路径必须是绝对路径（C:\\...）；不知道具体路径就 unsupported',
    '- 主观评价、建议、预测、因果解释 → unsupported',
    '- **若这句话描述的是过去发生的动作**（"我执行了/我写入了/我修改了"），必须用 trace_* 原语核对**当时的轨迹**，不要用 exists/path/port 去查当前状态：发生过 ≠ 现在还在',
    '',
    SCHEMA_HINT,
    evidenceHint ? `\n上下文（仅供定位，不要照抄）：\n${evidenceHint}` : '',
    '',
    `句子：${sentence}`,
  ].join('\n');
}

/** 从模型输出里取 JSON 计划（容忍前后废话）。 */
export function parsePlan(text) {
  if (typeof text !== 'string')
    return { plan: null, unsupported: null, error: '不是字符串' };
  const m = text.match(/\{[\s\S]*\}/);
  if (!m)
    return { plan: null, unsupported: null, error: '没找到 JSON' };
  let obj;
  try {
    obj = JSON.parse(m[0]);
  }
  catch {
    return { plan: null, unsupported: null, error: 'JSON 解析失败' };
  }
  if (obj && typeof obj.unsupported === 'string')
    return { plan: null, unsupported: obj.unsupported, error: null };
  const v = validatePlan(obj);
  if (!v.ok)
    return { plan: null, unsupported: null, error: '计划不合法：' + v.errors.join('; ') };
  return { plan: obj, unsupported: null, error: null };
}

/**
 * 生成计划（调一次模型）。
 * @param {string} sentence
 * @param {{transport:(prompt:string)=>Promise<string>, context?:string}} opts
 */
export async function generatePlan(sentence, { transport, context = '' } = {}) {
  if (typeof transport !== 'function')
    return { plan: null, unsupported: null, error: '缺少 transport' };
  let raw = '';
  try {
    raw = await transport(buildPrompt(sentence, { evidenceHint: context }));
  }
  catch (e) {
    return { plan: null, unsupported: null, error: '模型调用失败：' + String(e && e.message).slice(0, 80) };
  }
  return { ...parsePlan(raw), raw: String(raw).slice(0, 400) };
}

/** 一致性复核（可选，再调一次模型）：这个计划是否真的在核对原句？ */
export async function checkConsistency(sentence, plan, { transport } = {}) {
  if (typeof transport !== 'function')
    return { ok: false, reason: '缺少 transport' };
  const prompt = [
    '判断下面的检查计划是否**确实在核对**这句话断言的事实（不是核对别的东西）。',
    '只回答 yes 或 no，可跟一句理由。',
    '',
    `句子：${sentence}`,
    `计划：${JSON.stringify(plan)}`,
  ].join('\n');
  try {
    const out = String(await transport(prompt)).trim().toLowerCase();
    const yes = out.startsWith('yes') || out.includes('是的');
    return { ok: yes, reason: out.slice(0, 120) };
  }
  catch (e) {
    return { ok: false, reason: '复核失败：' + String(e && e.message).slice(0, 60) };
  }
}

/** 句子里有没有"可检查的具体对象"（路径/端口/数字/时间）。没有就别浪费一次模型调用。 */
export function looksCheckable(sentence) {
  const s = String(sentence || '');
  if (s.length < 6)
    return false;
  if (/[A-Za-z]:[\\/]/.test(s))
    return true;
  // POSIX 绝对路径（/tmp/x、/proc/…）：Linux/macOS 上的真实用例
  if (/(?:^|\s)\/(?:tmp|var|usr|home|opt|etc|proc|srv|mnt)\/[^\s]+/.test(s))
    return true;
  if (/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)[^\s]*[:：]\d{2,5}/.test(s))
    return true;
  if (/\b\d{2,5}\b/.test(s))
    return true;
  if (/\d{1,2}\s*月\s*\d{1,2}\s*[日号]|\d{1,2}[:：]\d{2}/.test(s))
    return true;
  return false;
}

/**
 * 批量把 uncertain 的判定交给 DSL 编译器重判（只动 uncertain，不动 supported/contradicted）。
 * @returns {Promise<{results:Array, resolved:number, changed:number}>}
 */
export async function resolveUncertain(results, { transport, max = 3, context = '', policy = undefined } = {}) {
  const out = Array.isArray(results) ? results.slice() : [];
  let resolved = 0;
  let changed = 0;
  const details = [];
  const positions = [];
  out.forEach((r, i) => {
    if (r && r.verdict === 'uncertain')
      positions.push(i);
  });
  for (const idx of positions.slice(0, max)) {
    const r = out[idx];
    // 没有具体对象的句子（意见/碎片）直接跳过，不花模型调用
    if (!looksCheckable(r.sentence)) {
      details.push({ sentence: String(r.sentence).slice(0, 80), verdict: 'insufficient', stage: 'prefilter', reason: '句子里没有可检查的具体对象' });
      continue;
    }
    const v = await verifySentence(r.sentence, { transport, context, policy });
    resolved += 1;
    details.push({ sentence: String(r.sentence).slice(0, 80), verdict: v.verdict, stage: v.stage, reason: String(v.reason || '').slice(0, 120), ...(v.plan ? { plan: v.plan } : {}), ...(v.policy ? { policy: v.policy } : {}) });
    if (v.verdict === 'supported' || v.verdict === 'contradicted') {
      changed += 1;
      out[idx] = {
        ...r,
        verdict: v.verdict,
        evidence: `DSL 核验：${v.reason || ''}`,
        confidence: 0.9,
      };
    }
  }
  return { results: out, resolved, changed, details };
}

/**
 * 完整链路：句子 → 计划 → 执行 → 判定。
 * @returns {Promise<{verdict:string, plan?:object, results?:Array, reason?:string, stage:string}>}
 */
export async function verifySentence(sentence, { transport, context = '', consistencyCheck = false, policy = undefined, claimTurn = undefined, currentTurn = undefined, evidence = undefined } = {}) {
  const gen = await generatePlan(sentence, { transport, context });
  if (gen.unsupported)
    return { verdict: 'insufficient', reason: '无法形式化：' + gen.unsupported, stage: 'generate' };
  if (!gen.plan)
    return { verdict: 'insufficient', reason: gen.error || '没有可执行计划', stage: 'generate' };
  // 翻译见证：计划里的参数必须在原句里有出处，否则说明"翻译歪了"
  const witness = makeWitness(sentence, gen.plan);
  if (!witness.ok)
    return { verdict: 'insufficient', plan: gen.plan, witness, reason: '翻译见证不通过：' + (witness.reason || ''), stage: 'witness' };
  if (consistencyCheck) {
    const c = await checkConsistency(sentence, gen.plan, { transport });
    if (!c.ok)
      return { verdict: 'insufficient', plan: gen.plan, reason: '复核未通过：' + c.reason, stage: 'consistency' };
  }
  const r = await runPlan(gen.plan, { policy, claimTurn, currentTurn, evidence });
  return { ...r, plan: gen.plan, stage: 'run' };
}
