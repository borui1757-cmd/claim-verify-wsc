// poisoned-history.mjs —— 用"畸形历史"复现生产事故，验证 sanitizeMessages 修得回来。
//
// 事故原型：2026-11-07 session-49d25835 turn 83
//   messages.521.3: `tool_use` ids were found without `tool_result` blocks immediately after
// 真形：assistant 消息 = [reasoning, text, tool-call, text]（末尾那段是插件追加的【核验】）
//
// 这个测试同时守住两条：
//   ① 缺结果的要补占位
//   ② tool-call 之后的尾块要摘出来、且**信息不丢**
import { sanitizeMessages } from '../lib/index.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// 模拟 provider 的合法性检查（报错文案与 DeepSeek 一致）
function providerReject(messages) {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const types = m.content.map((b) => (b && b.type) || '');
    const lastCall = Math.max(types.lastIndexOf('tool-call'), types.lastIndexOf('tool_use'));
    if (lastCall < 0) continue;
    if (lastCall < m.content.length - 1)
      return `messages.${i}.${lastCall}: tool_use without tool_result immediately after`;
    const calls = m.content.filter((b) => b.type === 'tool-call' || b.type === 'tool_use').map((b) => b.id);
    const next = messages[i + 1];
    if (!next || next.role !== 'tool')
      return `messages.${i}.${lastCall}: tool_use without tool_result immediately after: ${calls.join(',')}`;
    if (next.tool_call_id !== calls[0])
      return `messages.${i}.${lastCall}: tool_result id mismatch`;
  }
  return null;
}

const user = (t) => ({ role: 'user', content: t });
const call = (id) => ({ type: 'tool-call', id, name: 'edit', arguments: '{}' });
const res = (id) => ({ role: 'tool', tool_call_id: id, content: 'ok' });

// ── 1. 只缺结果 ──
{
  const msgs = [user('做一下'), { role: 'assistant', content: [{ type: 'reasoning', text: '想' }, call('c1')] }, user('啥情况')];
  const r = sanitizeMessages(msgs);
  check('缺结果 → 补占位', r.repaired.join() === 'c1', JSON.stringify(r.repaired));
  check('补完 provider 不再拒', providerReject(r.messages) === null, String(providerReject(r.messages)));
}

// ── 2. 事故真形：tool-call 后面还有尾块（且缺结果）──
{
  const msgs = [
    user('把 cascade 改成 64164'),
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Let me edit and run.' },
        { type: 'text', text: '对上了：「端口 64164 正在监听。」' },
        call('call_00_nMwcZePRbNUUOLtUvZUy7025'),
        { type: 'text', text: '\n\n【核验】本条回复有 1 处断言与实际不符' },
      ],
    },
    user('啥情况'),
  ];
  const before = providerReject(msgs);
  check('原样会被 provider 拒（复现事故）', before !== null, String(before));

  const r = sanitizeMessages(msgs);
  check('消毒后 provider 通过', providerReject(r.messages) === null, String(providerReject(r.messages)));
  check('消息形状 = assistant → tool → assistant',
    r.messages.map((m) => m.role).join(',') === 'user,assistant,tool,assistant,user',
    r.messages.map((m) => m.role).join(','));
  check('尾块信息没丢', JSON.stringify(r.messages).includes('【核验】'));
}

// ── 3. 尾块 + 结果已经存在：尾块要排在结果之后 ──
{
  const msgs = [
    user('x'),
    { role: 'assistant', content: [call('c2'), { type: 'text', text: '追加说明' }] },
    res('c2'),
    user('y'),
  ];
  const r = sanitizeMessages(msgs);
  const roles = r.messages.map((m) => m.role).join(',');
  check('已有结果时顺序仍是 assistant→tool→assistant', roles === 'user,assistant,tool,assistant,user', roles);
  check('provider 通过', providerReject(r.messages) === null, String(providerReject(r.messages)));
  check('不需要补占位', r.repaired.length === 0, JSON.stringify(r.repaired));
}

// ── 4. 多个调用只缺一个 ──
{
  const msgs = [
    { role: 'assistant', content: [call('a'), call('b')] },
    res('a'),
    user('next'),
  ];
  const r = sanitizeMessages(msgs);
  check('只补缺的 b', r.repaired.length === 1 && r.repaired[0] === 'b', JSON.stringify(r.repaired));
  check('provider 通过', providerReject(r.messages) === null, String(providerReject(r.messages)));
}

// ── 5. 健康对话不该被动 ──
{
  const msgs = [user('x'), { role: 'assistant', content: [call('c3')] }, res('c3'), user('y')];
  const r = sanitizeMessages(msgs);
  check('健康对话 repaired 为空', r.repaired.length === 0);
  check('健康对话长度不变', r.messages.length === msgs.length);
}

// ── 6. 幂等：修两次结果一致 ──
{
  const msgs = [
    user('x'),
    { role: 'assistant', content: [call('c4'), { type: 'text', text: '尾块' }] },
    user('y'),
  ];
  const once = sanitizeMessages(msgs);
  const twice = sanitizeMessages(once.messages);
  check('幂等：第二次不再补', twice.repaired.length === 0, JSON.stringify(twice.repaired));
  check('幂等：结构一致', providerReject(twice.messages) === null);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
