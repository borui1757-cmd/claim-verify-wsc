// policy.js —— 执行前授权闸门（对标 SOF 的 authorization boundary / CapScope 的 capability 校验）。
//
// 分工：
//   policy.js 决定「这条检查能不能跑」；dsl.js 负责「跑了得到什么」。
//   决策与策略哈希一起进审计日志，回执里带上 policyHash——证明"这次执行发生在哪版策略下"。
//
// 策略形状（故意极简，够用且可审计）：
//   { default: 'allow'|'deny', rules: { 原语名: 'allow'|'deny'|'pending' } }

import crypto from 'node:crypto';
import { isAbsPath } from './paths.js';

export const DECISIONS = ['allow', 'deny', 'pending'];

/** 稳定序列化（键排序），与 receipt 的 canonicalJson 语义一致，但不互相依赖。 */
export function canonicalJson(value) {
  const walk = (v) => {
    if (Array.isArray(v))
      return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort())
        out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/** 策略哈希：把策略钉死，回执引用它。 */
export function policyHash(policy) {
  return crypto.createHash('sha256').update(canonicalJson(policy || {})).digest('hex');
}

/** 默认策略：全部放行（与"只读原语"的现状一致）。 */
export function defaultPolicy() {
  return { default: 'allow', rules: {} };
}

/** 校验策略形状；写错了要拒绝，不能默默按"全放行"跑。
 * 规则取值可以是字符串（allow/deny/pending），也可以是对象：
 *   { decision: 'pending', allowPathPrefix: 'C:\\Users\\x\\' }
 * 对象形式用于"带谓词的能力"，路径不在前缀内一律 deny。
 */
export function validatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object')
    return { ok: false, errors: ['策略必须是对象'] };
  const d = policy.default ?? 'allow';
  if (!DECISIONS.includes(d))
    errors.push(`default 必须是 ${DECISIONS.join('/')}，收到 ${JSON.stringify(d)}`);
  const rules = policy.rules ?? {};
  if (typeof rules !== 'object' || Array.isArray(rules))
    errors.push('rules 必须是对象');
  else {
    for (const [k, v] of Object.entries(rules)) {
      if (typeof v === 'string') {
        if (!DECISIONS.includes(v))
          errors.push(`规则 ${k} 的取值非法：${JSON.stringify(v)}`);
        continue;
      }
      if (v && typeof v === 'object') {
        if (!DECISIONS.includes(v.decision))
          errors.push(`规则 ${k}.decision 非法：${JSON.stringify(v.decision)}`);
        if (v.allowPathPrefix !== undefined) {
          if (typeof v.allowPathPrefix !== 'string' || !isAbsPath(v.allowPathPrefix))
            errors.push(`规则 ${k}.allowPathPrefix 必须是绝对路径`);
        }
        const extra = Object.keys(v).filter((x) => !['decision', 'allowPathPrefix'].includes(x));
        if (extra.length)
          errors.push(`规则 ${k} 有多余字段：${extra.join(',')}`);
        continue;
      }
      errors.push(`规则 ${k} 必须是字符串或对象`);
    }
  }
  const extra = Object.keys(policy).filter((k) => !['default', 'rules'].includes(k));
  if (extra.length)
    errors.push('策略里有多余字段：' + extra.join(','));
  return { ok: errors.length === 0, errors };
}

/** 把规则取值归一成 { decision, allowPathPrefix? }。 */
export function normalizeRule(rule) {
  if (typeof rule === 'string')
    return { decision: rule };
  if (rule && typeof rule === 'object')
    return { ...rule };
  return { decision: 'allow' };
}

/**
 * 逐条判定一个检查计划。
 * @returns {{hash:string, decisions:Array, blocked:boolean}}
 */
export function checkPlan(plan, policy) {
  const pol = policy || defaultPolicy();
  const checks = Array.isArray(plan?.all) ? plan.all : [];
  const decisions = checks.map((c) => {
    const raw = (pol.rules && pol.rules[c.prim]) ?? pol.default ?? 'allow';
    const rule = normalizeRule(raw);
    // 谓词：路径前缀不匹配 → 直接 deny（"只允许写这个目录"）
    if (rule.allowPathPrefix) {
      const target = c.args && typeof c.args.path === 'string' ? c.args.path : '';
      const inScope = target.toLowerCase().startsWith(rule.allowPathPrefix.toLowerCase());
      if (!inScope) {
        return {
          prim: c.prim,
          decision: 'deny',
          reason: `路径不在允许范围（${rule.allowPathPrefix}）`,
        };
      }
    }
    return {
      prim: c.prim,
      decision: rule.decision,
      reason: rule.decision === 'allow' ? '策略放行' : rule.decision === 'deny' ? '策略禁止' : '需要人工审批',
    };
  });
  return {
    hash: policyHash(pol),
    decisions,
    blocked: decisions.some((d) => d.decision !== 'allow'),
  };
}
