// host-sim.mjs —— DSH 宿主的「钩子契约模拟器」
//
// 目的：让插件在本地就能跑一遍宿主的调度顺序，抓"接错钩子 / 拿不到 messages / 改了没生效"这类错，
// 不用重启真宿主。
//
// 复刻的契约（依据 dsh-agent-loop / dsh-llm）：
//   agent/request  : waterfall(payload={turn,step,signal}, next->config)  → 只能改 provider/model/reasoningEffort
//   agent/pre-step : waterfall(payload={messages,...}, next->{kind:'enter',messages}) → 可改 messages
//   llm/stream     : waterfall(options, next->AsyncIterable)              → options 是完整请求
//
// 不复刻：profile / buildId / 投影缓存 / 会话存储 —— 那些只能真机验。

export function createHost() {
  const handlers = new Map();
  const ctx = {
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
    },
    tools: { register() {} },
    get() { return null; },
  };

  const list = (name) => handlers.get(name) || [];

  // 异步 waterfall：每个 listener 调 next() 继续
  async function waterfall(name, payload, fallback) {
    const hs = list(name);
    let i = 0;
    const next = async () => {
      if (i < hs.length) {
        const h = hs[i++];
        return h(payload, next);
      }
      return fallback();
    };
    return next();
  }

  // 流式 waterfall：必须同步返回 AsyncIterable（宿主就是这么调的）
  function waterfallStream(name, options, fallback) {
    const hs = list(name);
    let i = 0;
    const next = () => (i < hs.length ? hs[i++](options, next) : fallback());
    return next();
  }

  // 假模型：把 reply 变成宿主的 chunk 协议
  function fakeStream(reply) {
    return (async function* () {
      let idx = 0;
      for (const part of reply.text ?? []) {
        yield { type: 'text-delta', index: idx++, text: part };
      }
      for (const call of reply.toolCalls ?? []) {
        yield { type: 'tool-call-delta', index: idx++, id: call.id, name: call.name, arguments: call.args ?? '{}' };
      }
      yield { type: 'finish', reason: (reply.toolCalls ?? []).length ? 'tool-calls' : 'stop' };
    })();
  }

  /**
   * 跑一轮，完全按宿主顺序：request → pre-step → stream
   * @returns {{messages, text, chunks, config, decision}}
   */
  async function runTurn({ messages, provider = 'deepseek-account', model = 'deepseek-flash', sessionId = 'sim', reply = { text: ['好的'] } }) {
    const seed = { provider, model };
    const config = await waterfall('agent/request', { turn: 1, step: 1, signal: null }, async () => seed);
    if (!config || typeof config.provider !== 'string')
      throw new Error('agent/request 没有返回合法 config');

    const decision = await waterfall(
      'agent/pre-step',
      { messages, turn: 1, step: 1, signal: null, modelSelection: { provider: config.provider, model: config.model } },
      async () => ({ kind: 'enter', messages })
    );
    if (decision?.kind === 'reject') return { messages, text: '', chunks: [], config, decision };

    const options = {
      provider: config.provider,
      model: config.model,
      sessionId,
      messages: decision?.messages ?? messages,
      tools: [],
      toolHistory: [],
      maxTokens: 8192,
      signal: null,
    };

    const text = [];
    for await (const c of waterfallStream('llm/stream', options, () => fakeStream(reply))) {
      if (c.type === 'text-delta' && typeof c.text === 'string') text.push(c.text);
    }

    return { messages: options.messages, text: text.join(''), chunks: [], config, decision };
  }

  return { ctx, runTurn, handlers };
}

/** 模拟 provider 的配对校验（报错文案与 DeepSeek 一致），用来判断"这轮会不会 400" */
export function providerReject(messages) {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const types = m.content.map((b) => (b && b.type) || '');
    const lastCall = Math.max(types.lastIndexOf('tool-call'), types.lastIndexOf('tool_use'));
    if (lastCall < 0) continue;
    if (lastCall < m.content.length - 1)
      return `messages.${i}.${lastCall}: tool_use without tool_result immediately after`;
    const next = messages[i + 1];
    if (!next || next.role !== 'tool')
      return `messages.${i}.${lastCall}: tool_use without tool_result immediately after`;
  }
  return null;
}
