// capability.js —— 能力边界：让"它根本做不到"成为第 0 道防线
//
// 为什么需要：核验是事后算账（"你说做了，我查证没查到"），
// 但对**支付/资金/账号**这类场景，正确的问题不是"它有没有撒谎"，
// 而是"**我们为什么允许它碰这个**"。
//
// 类比：银行柜员防盗窃不靠事后审计，靠**没有金库钥匙**。
//
// 规则从宽到严：
//   ① 工具白名单   —— 只允许调用登记过的工具
//   ② 域名/关键词   —— 命令或参数里出现支付类目标就拦
//   ③ 目录边界     —— 复用 preflight 的 allowedRoots
//
// 默认空策略 = 不限制（不配就不生效，避免误伤）。

/** 默认的敏感目标（宁可误报，也不能漏掉资金类） */
export const SENSITIVE_PATTERNS = [
  { kind: 'payment-domain', re: /(weixin\.qq\.com|wechatpay|wxpay|alipay\.com|paypal\.com|stripe\.com|pay\.qq\.com)/i },
  { kind: 'wallet-keyword', re: /(微信支付|微信余额|支付宝余额|转账|红包|收款码|付款码|提现|充值余额)/ },
  { kind: 'credential-file', re: /(id_rsa|\.pem|\.p12|credentials\.yaml|\.env\b)/i },
];

/**
 * 检查一次工具调用是否在能力边界内。
 * @param {{tool:string, args:object}} call
 * @param {{allowedTools?:string[], forbidden?:Array<{kind:string,re:RegExp}>, allowSensitive?:boolean}} policy
 * @returns {{allow:boolean, kind?:string, reason?:string}}
 */
export function checkCapability(call, policy = {}) {
  const tool = String(call && call.tool || '');
  const args = (call && call.args) || {};

  // ① 工具白名单（配了才生效）
  const allow = Array.isArray(policy.allowedTools) ? policy.allowedTools.filter(Boolean) : [];
  if (allow.length && !allow.some((t) => t.toLowerCase() === tool.toLowerCase())) {
    return { allow: false, kind: 'tool-not-allowed', reason: `工具 ${tool} 不在白名单内（允许：${allow.join(', ')}）` };
  }

  // ② 敏感目标（除非显式允许）
  if (policy.allowSensitive !== true) {
    const text = JSON.stringify(args ?? {});
    const pats = Array.isArray(policy.forbidden) && policy.forbidden.length ? policy.forbidden : SENSITIVE_PATTERNS;
    for (const p of pats) {
      const m = text.match(p.re);
      if (m)
        return { allow: false, kind: p.kind, reason: `参数命中敏感目标「${m[0]}」，这类操作需要人工确认` };
    }
  }

  return { allow: true };
}

/** 渲染成给模型看的话 */
export function renderCapability(result, call) {
  if (!result || result.allow)
    return '';
  return `【能力边界】${result.reason}\n这次调用（${call && call.tool || '未知工具'}）没有执行。如确需操作，请让用户本人执行或显式授权。`;
}
