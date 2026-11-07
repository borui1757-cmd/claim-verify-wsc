// tools/lab.mjs —— 用宿主契约模拟器跑一遍插件（本地，不重启宿主）
//
//   ① 畸形历史 → 消毒后能过 provider 校验 + 时间注入到位
//   ② 有工具调用的轮次 → 不追加【核验】（防止弄坏会话）
//   ③ 无工具调用的轮次 → 正常追加【核验】（功能没丢）
//
// 注意：alertPolicy 对同一断言 60s 内去重，所以三个场景必须用不同断言，
// 否则后面的场景会被静默吃掉（踩过一次，测试会假绿）。
import { apply } from '../lib/index.js';
import { createHost, providerReject } from './host-sim.mjs';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok  ${name}`); }
  else { fail += 1; console.log(`  XX  ${name}  ${extra}`); }
};

function newHost() {
  const host = createHost();
  apply(host.ctx, { enable: true, annotate: true, injectTime: true, sanitizeMessages: true, portTimeoutMs: 2000 });
  return host;
}

console.log('[1] poisoned history (real incident shape)');
{
  const host = newHost();
  const poisoned = [
    { role: 'user', content: 'edit cascade to 64164' },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Let me edit and run.' },
        { type: 'text', text: 'matched.' },
        { type: 'tool-call', id: 'call_A', name: 'edit', arguments: '{}' },
        { type: 'text', text: '\n\n【核验】本条回复有 1 处断言与实际不符' },
      ],
    },
    { role: 'user', content: 'what happened' },
  ];
  check('raw history is rejected by provider', providerReject(poisoned) !== null);
  const out = await host.runTurn({ messages: poisoned, reply: { text: ['ok'] } });
  check('after host chain provider accepts', providerReject(out.messages) === null, String(providerReject(out.messages)));
  check('tool placeholder inserted', out.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'call_A'));
  check('tail block not lost', JSON.stringify(out.messages).includes('【核验】'));
  const lastUser = [...out.messages].reverse().find((m) => m.role === 'user');
  check('clock injected into last user', JSON.stringify(lastUser?.content ?? '').includes('[系统注入] 当前时间'));
}

console.log('[2] turn with tool-call -> no note appended');
{
  const host = newHost();
  const out = await host.runTurn({
    messages: [{ role: 'user', content: 'probe port' }],
    reply: { text: ['端口 59999 正在监听。'], toolCalls: [{ id: 'call_B', name: 'probe', args: '{}' }] },
  });
  check('no note in output', !out.text.includes('【核验】'), JSON.stringify(out.text.slice(-60)));
  check('reply body kept', out.text.includes('59999'));
}

console.log('[3] turn without tool-call -> note appended');
{
  const host = newHost();
  const out = await host.runTurn({ messages: [{ role: 'user', content: 'what time is it' }], reply: { text: ['端口 59997 正在监听。'] } });
  check('note present', out.text.includes('【核验】'), JSON.stringify(out.text.slice(-120)));
}

const ok = fail === 0;
console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail}`);
process.exit(ok ? 0 : 1);
