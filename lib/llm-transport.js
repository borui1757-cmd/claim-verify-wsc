// llm-transport.js —— 用宿主注入的 ctx.llm 发一次内部调用，替掉 HTTP /v1。
//
// 为什么：/v1 只暴露 free-first，它一挂整条路就断（今天实测 503）。
// 插件本来就该用宿主自己的 LLM 服务，模型和凭据都由宿主管。
//
// ⚠ 递归风险：ctx.llm.stream() 会再次触发 llm/stream 瀑布，如果不设标记，
//   插件会去"核验核验器的输出"，无限套娃。所以每次内部调用都带 INTERNAL 标记，
//   插件的 llm/stream 钩子见到它直接 next() 放行。
//
// llm.stream(options) 产出 chunk：{ type:'text-delta', text } / { type:'finish', reason }

export const INTERNAL_FLAG = '__claimVerifyInternal';

export function makeLlmTransport({ ctx, route = () => null, maxTokens = 4000, signal, reasoningEffort = 'minimal' } = {}) {
  if (!ctx?.llm || typeof ctx.llm.stream !== 'function')
    throw new Error('makeLlmTransport 需要带 stream() 的 ctx.llm');

  async function* run(options) {
    for await (const chunk of ctx.llm.stream(options))
      yield chunk;
  }

  return async function transport(prompt) {
    const r = route() || {};
    if (!r.provider || !r.model)
      throw new Error('没有可用的 provider/model（route 为空）');

    const base = {
      provider: r.provider,
      model: r.model,
      maxTokens,
      messages: [{ role: 'user', content: [{ type: 'text', text: String(prompt) }] }],
      [INTERNAL_FLAG]: true,
      ...(signal ? { signal } : {}),
    };

    // deepseek-flash 的思考会把 maxTokens 吃光（实测 finish=max-tokens、正文为空），
    // 所以先带上最小的 reasoningEffort；若适配器不认，退回到不带该字段重试一次。
    let text = '';
    let failed = null;
    let finishKind = null;
    const attempt = async (opts) => {
      text = '';
      failed = null;
      finishKind = null;
      for await (const chunk of run(opts)) {
        if (!chunk)
          continue;
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          text += chunk.text;
          continue;
        }
        if (chunk.type === 'finish') {
          finishKind = chunk.reason?.kind || null;
          if (finishKind === 'error' || finishKind === 'aborted')
            failed = chunk.reason?.failure || { message: finishKind };
        }
      }
      return !failed;
    };

    const withEffort = { ...base, reasoningEffort };
    let ok = false;
    try { ok = await attempt(withEffort); }
    catch { ok = false; }
    if (!ok && !text) {
      // 可能是适配器不接受 reasoningEffort，或思考耗尽；去掉该字段重试一次
      try { await attempt(base); } catch { /* 交给下面统一报错 */ }
    }

    if (failed)
      throw new Error(`内部调用失败：${failed.code || failed.name || 'unknown'}`);
    if (!text.trim())
      throw new Error(`empty-response:finish=${finishKind || 'unknown'}`);
    return text;
  };
}
