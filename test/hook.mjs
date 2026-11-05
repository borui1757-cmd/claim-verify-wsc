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

const pass = out.includes('【核验】') && sawNoteBeforeFinish;
console.log(pass ? 'PASS  核验说明在 finish 前追加' : 'FAIL  没有追加核验说明');
console.log('  输出尾部：' + JSON.stringify(out.slice(-160)));
process.exit(pass ? 0 : 1);
