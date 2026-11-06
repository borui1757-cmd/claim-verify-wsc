// tier.js —— 按"可逆性"给动作分档，而不是"拦/不拦"二元
//
// 为什么分档：二元开关有两个死法——
//   要么什么都问（用户开始闭眼点"允许"，等于没问）
//   要么什么不问（出事就来不及）
//
// 依据一：Microsoft Agent Framework 的 HITL 模式
//   - 工具级 approval_mode：always_require / never_require / conditional
//   - 需要审批时**这一轮直接中断**，工具不执行
//   - 审批权归服务端，客户端不能伪造
//
// 依据二：Planoly 的审批疲劳设计
//   - T1 完全可逆 → 不问
//   - T2 窗口内可逆 → 批量审
//   - T3 不可逆/立即对外 → 每次都停
//   - **不确定就归到更高一档**
//
// 我们落成三档 + 一个原则：**默认取更严的那档**。

import { SENSITIVE_PATTERNS } from './capability.js';

export const T1 = 1; // 完全可逆：不问
export const T2 = 2; // 窗口内可逆：放行 + 进待审队列
export const T3 = 3; // 不可逆/对外：停一下

/** 读类工具：不改变世界 */
const READ_TOOLS = /^(read|glob|grep|list|ls|cat|stat|view|fetch|get|search)/i;
/** 写类工具 */
const WRITE_TOOLS = /(write|edit|create_file|save_file|apply_patch|multi_edit)/i;
/** 删除类工具/命令 */
const DELETE_HINT = /(Remove-Item|rm\s|del\s|erase\s|rmdir|Move-Item|mv\s)/i;

/**
 * 给一次工具调用分档。
 * @param {{tool:string, args:object}} call
 * @param {{allowedTools?:string[], roots?:string[], sensitive?:RegExp[]}} policy
 * @returns {{tier:number, kind:string, reason:string}}
 */
export function classify(call, policy = {}) {
  const tool = String(call && call.tool || '');
  const args = (call && call.args) || {};
  const text = JSON.stringify(args ?? {});

  // ① 敏感目标 = 直接 T3（资金/凭据/支付）
  const pats = Array.isArray(policy.sensitive) && policy.sensitive.length ? policy.sensitive : SENSITIVE_PATTERNS;
  for (const p of pats) {
    const m = text.match(p.re);
    if (m)
      return { tier: T3, kind: p.kind, reason: `命中敏感目标「${m[0]}」` };
  }

  // ② 白名单外的工具 = 未知能力 → 按"不确定取更高档"归 T3
  const allow = Array.isArray(policy.allowedTools) ? policy.allowedTools.filter(Boolean) : [];
  if (allow.length && !allow.some((t) => t.toLowerCase() === tool.toLowerCase()))
    return { tier: T3, kind: 'tool-not-allowed', reason: `工具 ${tool} 不在白名单内` };

  // ③ 删除/移动 = 不可逆 → T3
  if (DELETE_HINT.test(text) || /delete|remove|rmdir/i.test(tool))
    return { tier: T3, kind: 'destructive', reason: '删除/移动类操作不可逆' };

  // ④ 读类 = T1
  if (READ_TOOLS.test(tool))
    return { tier: T1, kind: 'read', reason: '只读取，不改变世界' };

  // ⑤ 写类 = T2（窗口内可逆：文件可以再改回来）
  if (WRITE_TOOLS.test(tool))
    return { tier: T2, kind: 'write', reason: '写入类，可在窗口内恢复' };

  // ⑥ shell 命令：看内容
  if (/pwsh|bash|shell|cmd|exec|run_command/i.test(tool)) {
    if (DELETE_HINT.test(text))
      return { tier: T3, kind: 'shell-destructive', reason: '命令含删除/移动' };
    return { tier: T2, kind: 'shell', reason: '执行命令，影响面需观察' };
  }

  // ⑦ 剩下的不认识 → 默认取更严
  return { tier: T3, kind: 'unknown', reason: '未知工具类型，按最严处理' };
}

/** 每档对应的处置 */
export function disposition(tier) {
  if (tier === T1)
    return 'allow';
  if (tier === T2)
    return 'allow-and-queue'; // 放行，但要进待审队列给人看
  return 'stop'; // T3：不执行，等人
}

/** 渲染成人话 */
export function renderTier(result, call) {
  if (!result)
    return '';
  const label = result.tier === T3 ? '需人工确认' : result.tier === T2 ? '已放行（进入待审队列）' : '自动放行';
  return `【动作分档】${label}：${call && call.tool || '未知'}（T${result.tier} · ${result.reason}）`;
}
