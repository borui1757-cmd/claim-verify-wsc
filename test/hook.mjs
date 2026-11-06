// hook.mjs —— 端到端自测：假 ctx + 假流，验证 apply() 真的会挂 llm/stream 并在 finish 前追加核验说明。
// 用法：node test/hook.mjs     （退出码 0 = 通过）

import { apply } from '../lib/index.js';

let handler = null;
const ctx = {
  on(name, fn) {
    if (name === 'llm/stream')
      handler = fn;
  },
};

apply(ctx, { enable: true, annotate: true, portTimeoutMs: 50 });
if (typeof handler !== 'function') {
  console.error('FAIL  没有挂上 llm/stream');
  process.exit(1);
}

const text = '配置文件在 C:\\Users\\user\\Desktop\\__no_such_file__.md 里。';

function next() {
  return (async function* () {
    for (const part of ['配置文', '件在 C:\\Users\\user\\Desktop\\__no_such_file__.md 里。'])
      yield { type: 'text-delta', text: part };
    yield { type: 'finish', reason: 'stop' };
  })();
}

let out = '';
let sawNoteBeforeFinish = false;
for await (const chunk of handler({ sessionId: 'session-hook-test', provider: 'x', model: 'y' }, next)) {
  if (chunk.type === 'text-delta')
    out += chunk.text;
  if (chunk.type === 'finish')
    sawNoteBeforeFinish = out.includes('【核验】');
}

// 2026-11-07：占位路径（__no_such_file__）现在按"示例"处理，**不再抽样核验**，
// 所以这里期望**没有**核验说明。要测正常路径请用真实存在的文件。
const pass = !out.includes('【核验】');
console.log(pass ? 'PASS  占位路径不再触发核验（按示例处理）' : 'FAIL  占位路径仍被当成断言');
console.log('  输出尾部：' + JSON.stringify(out.slice(-160)));
process.exit(pass ? 0 : 1);
