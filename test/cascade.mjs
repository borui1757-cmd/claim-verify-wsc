// cascade.mjs —— 级联触发的端到端自测：假 ctx + 假流 + 假 agent/request。
// 验证三件事：
//   1. 核验失败 → 记一次待升级
//   2. 下一次 agent/request 真的换了模型
//   3. 升级次数有上限、已经在目标模型上就不要再升

import { apply } from '../lib/index.js';

const hooks = {};
const ctx = {
  on(name, fn) {
    (hooks[name] ||= []).push(fn);
  },
};

apply(ctx, {
  enable: true,
  annotate: false,
  portTimeoutMs: 50,
  cascadeEnabled: true,
  cascadeProvider: 'deepseek-account',
  cascadeModel: 'deepseek-flash',
  cascadeMax: 2,
});

const streamHook = hooks['llm/stream']?.[0];
const reqHook = hooks['agent/request']?.[0];
if (!streamHook || !reqHook) {
  console.error('FAIL  没挂上 llm/stream 或 agent/request');
  process.exit(1);
}

// 一个必定失败的流：端口 64164 不存在
function failingStream() {
  return (async function* () {
    yield { type: 'text-delta', index: 0, text: 'DSH 实际端口是 64164。' };
    yield { type: 'finish', reason: 'stop' };
  })();
}

async function runStream() {
  for await (const _ of streamHook({ sessionId: 'session-cascade' }, failingStream)) {
    /* 吃掉 */
  }
}

// 假的 agent/request 下游：给出一个"便宜模型"的种子配置
async function seedNext() {
  return { provider: 'router', model: 'free-first', reasoningEffort: 'high' };
}

async function askRequest() {
  return reqHook({ turn: 1, step: 1 }, seedNext);
}

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name} ${extra}`); }
};

// 1) 没有失败时不该升级
let cfg1 = await askRequest();
check('没有失败 → 保持原模型', cfg1.provider === 'router' && cfg1.model === 'free-first', JSON.stringify(cfg1));

// 2) 一次失败 → 下一次请求升级
await runStream();
let cfg2 = await askRequest();
check('失败一次 → 升级到强模型', cfg2.provider === 'deepseek-account' && cfg2.model === 'deepseek-flash', JSON.stringify(cfg2));

// 3) 升级只消费一次（pending 用完就恢复）
let cfg3 = await askRequest();
check('升级只消费一次 → 恢复原模型', cfg3.provider === 'router', JSON.stringify(cfg3));

// 4) 连续失败但超过上限就不再升
await runStream();
await runStream();
await runStream();
const upgraded = [];
for (let i = 0; i < 4; i++)
  upgraded.push((await askRequest()).provider);
check('升级次数受 cascadeMax 限制', upgraded.filter((p) => p === 'deepseek-account').length <= 1, upgraded.join(','));

// 5) 下游返回的种子已经是目标模型时不重复升级（防自我循环）
const ctx2 = { on(n, f) { (hooks[n] ||= []).push(f); } };
apply(ctx2, { enable: true, annotate: false, cascadeEnabled: true, cascadeProvider: 'deepseek-account', cascadeModel: 'deepseek-flash', cascadeMax: 2 });
const s2 = hooks['llm/stream'].at(-1);
const r2 = hooks['agent/request'].at(-1);
for await (const _ of s2({ sessionId: 'session-x' }, failingStream)) { /* eat */ }
const sameCfg = await r2({ turn: 1, step: 1 }, async () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }));
check('已在目标模型上 → 不再升级', sameCfg.provider === 'deepseek-account' && sameCfg.model === 'deepseek-flash');

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
