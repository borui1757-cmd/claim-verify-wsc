// feedback-wire.mjs —— 回写接线：工具失败 → 下一步注入一条核验消息
import { apply, failureBrief } from '../lib/index.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

function fakeCtx() {
  const handlers = {};
  return {
    handlers,
    on: (name, fn) => { handlers[name] = fn; },
    tools: { register: () => {} },
    get: () => null,
  };
}

const ctx = fakeCtx();
apply(ctx, {
  enable: true,
  receipts: false,
  structuralAudit: false,
  sentenceAudit: false,
  feedbackMode: 'failure',
  feedbackLevel: 'firm',
});

check('注册了 session/event', typeof ctx.handlers['session/event'] === 'function');
check('注册了 agent/pre-step', typeof ctx.handlers['agent/pre-step'] === 'function');

// 模拟一次失败的写调用
const session = { id: 'sess-1' };
ctx.handlers['session/event'](session, {
  type: 'tool/call',
  data: { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"C:\\\\a.txt"}' },
});
ctx.handlers['session/event'](session, {
  type: 'tool/result',
  data: { turn: 1, step: 1, message: { role: 'tool', isError: true, source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'EACCES: permission denied' }] } },
});

const preStep = async () => ({ kind: 'ok', messages: [] });
const out = await ctx.handlers['agent/pre-step']({ agent: { id: 'sess-1' }, messages: [], step: 1 }, preStep);
check('下一步多了一条消息', Array.isArray(out.messages) && out.messages.length === 1, JSON.stringify(out.messages));
const text = out.messages[0]?.content?.[0]?.text || '';
check('反馈含失败事实', /工具调用失败/.test(text) && /EACCES/.test(text), text);
check('反馈明确禁止谎报', /不要声称/.test(text), text);
check('消息形状是 user 且带 source', out.messages[0].role === 'user' && out.messages[0].source?.kind === 'claim-verify');

// 第二条：已经取走，不应重复注入
const out2 = await ctx.handlers['agent/pre-step']({ agent: { id: 'sess-1' }, messages: [], step: 2 }, preStep);
check('反馈只注入一次', out2.messages.length === 0, JSON.stringify(out2.messages));

// 非失败结果不产生反馈
ctx.handlers['session/event'](session, {
  type: 'tool/result',
  data: { turn: 1, step: 2, message: { role: 'tool', isError: false, source: { kind: 'tool', callId: 'c2' }, content: [{ type: 'text', text: 'ok' }] } },
});
const out3 = await ctx.handlers['agent/pre-step']({ agent: { id: 'sess-1' }, messages: [], step: 3 }, preStep);
check('成功结果不产生反馈', out3.messages.length === 0);

// 真实情形：DSH 对非零退出码不置 isError，失败只在正文里
ctx.handlers['session/event'](session, {
  type: 'tool/result',
  data: { turn: 1, step: 3, message: { role: 'tool', isError: false, source: { kind: 'tool', callId: 'c3' }, content: [{ type: 'text', text: 'Directory of C:\\\n\n[stderr]\nFile Not Found\n[exit code: 1]' }] } },
});
const out4 = await ctx.handlers['agent/pre-step']({ agent: { id: 'sess-1' }, messages: [], step: 4 }, preStep);
check('退出码非 0 也能触发回写', out4.messages.length === 1 && /工具调用失败/.test(out4.messages[0]?.content?.[0]?.text || ''), JSON.stringify(out4.messages));

// 回归：退出码 0，但输出里出现 FAIL 字样（跑测试套件时很常见）→ 不能触发
ctx.handlers['session/event'](session, {
  type: 'tool/result',
  data: { turn: 1, step: 5, message: { role: 'tool', isError: false, source: { kind: 'tool', callId: 'c5' }, content: [{ type: 'text', text: 'PASS 一条\nFAIL 一条\n[exit code: 0]' }] } },
});
const out5 = await ctx.handlers['agent/pre-step']({ agent: { id: 'sess-1' }, messages: [], step: 5 }, preStep);
check('退出码 0 时 FAIL 字样不触发', out5.messages.length === 0, JSON.stringify(out5.messages));

// 回归：没有退出码、没有 isError（例如读文件），正文里有 FAIL 也不能触发
ctx.handlers['session/event'](session, {
  type: 'tool/result',
  data: { turn: 1, step: 6, message: { role: 'tool', isError: false, source: { kind: 'tool', callId: 'c6' }, content: [{ type: 'text', text: '文件内容：\nFAIL 示例\nError 示例' }] } },
});
const out6 = await ctx.handlers['agent/pre-step']({ agent: { id: 'sess-1' }, messages: [], step: 6 }, preStep);
check('无退出码无 isError 时正文关键词不触发', out6.messages.length === 0, JSON.stringify(out6.messages));

// ── 防"空转"：同一目标最多回写 2 次，第 3 次改为升级提示，之后静默
const session3 = { id: 'sess-cap' };
const sameFail = () => ({
  type: 'tool/result',
  data: { turn: 9, step: 1, message: { role: 'tool', isError: true, source: { kind: 'tool', callId: 'cap' + Math.random() }, content: [{ type: 'text', text: 'EACCES: permission denied' }] } },
});
const seen = [];
for (let i = 0; i < 4; i += 1) {
  ctx.handlers['session/event'](session3, sameFail());
  const o = await ctx.handlers['agent/pre-step']({ agent: { id: 'sess-cap' }, messages: [], step: 10 + i }, preStep);
  seen.push(o.messages[0]?.content?.[0]?.text || '');
}
check('同一目标第 1 次是普通回写', /【核验】/.test(seen[0]) && !/升级/.test(seen[0]));
check('同一目标第 2 次仍是普通回写', /【核验】/.test(seen[1]) && !/升级/.test(seen[1]));
check('第 3 次改为升级提示', /【核验·升级】/.test(seen[2]), seen[2].slice(0, 60));
check('第 4 次静默（不再烦）', seen[3] === '');

// off 档：不注册 pre-step
const ctx2 = fakeCtx();
apply(ctx2, { enable: true, receipts: false, structuralAudit: false, sentenceAudit: false, feedbackMode: 'off' });
check('off 档不注册 pre-step', ctx2.handlers['agent/pre-step'] === undefined);

// ── 摘要选取：优先错误行，其次退出码，再次首行
check('摘要优先取错误行', /EACCES/.test(failureBrief('ok\nEACCES: permission denied\n[exit code: 1]')));
check('无错误行时取退出码行', /exit code: 7/.test(failureBrief('(no output)\n[exit code: 7]')));
check('都没有时取首行', failureBrief('普通输出\n第二行').startsWith('普通输出'));
check('空输出有兜底', /无输出/.test(failureBrief('')));

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
