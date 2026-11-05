// feedback.js —— 把核验结论变成"可以塞回模型上下文"的反馈。
//
// 依据：CRITIC（arXiv 2305.11738）表明"有外部工具反馈时自纠有效"，
// 而 The Validation Gap（EMNLP 2025）指出模型"能算不会验"。
// 所以反馈必须是**外部客观信号**，且措辞要具体、可执行，避免被当成寒暄忽略。
//
// 三种强度：
//   soft  → 只提示事实（默认）
//   firm  → 明确要求修正后再结束
//   block → 附带"未通过则不得宣称完成"（调用方据此阻断）

/** 由一条核验结果生成反馈文本。 */
export function feedbackForResult(result, level = 'soft') {
  const r = result || {};
  if (r.verdict !== 'contradicted' && r.verdict !== 'insufficient')
    return null;
  const target = String(r.target || r.sentence || '').slice(0, 120);
  const reason = String(r.reason || '').slice(0, 160);
  if (r.verdict === 'contradicted') {
    const head = level === 'soft'
      ? `【核验】与执行证据不符：${target ? target + '：' : ''}${reason}`
      : `【核验·必须修正】你声称的"${target}"与执行证据不符：${reason}`;
    const tail = level === 'firm' ? '\n请先改正或重试，再向用户报告完成情况；不要声称已完成。' : '';
    return head + tail;
  }
  return level === 'soft' ? null : `【核验】证据不足，无法确认"${target}"（${reason}）。请不要把它说成已完成。`;
}

/** 批量：只保留需要回写的条目，合并成一条系统消息。 */
export function buildFeedback(results, level = 'soft') {
  const lines = (results || []).map((r) => feedbackForResult(r, level)).filter(Boolean);
  if (!lines.length)
    return null;
  return lines.join('\n');
}

/** 判定回写强度是否足以阻断。 */
export function shouldBlock(results, level = 'block') {
  if (level !== 'block')
    return false;
  return (results || []).some((r) => r.verdict === 'contradicted');
}
