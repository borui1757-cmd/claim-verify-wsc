// llm-transport.mjs —— 假 ctx.llm 验证内部调用（不联网、不依赖宿主）
import { makeLlmTransport, INTERNAL_FLAG } from '../lib/llm-transport.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log(`PASS  ${n}`); } else { fail++; console.log(`FAIL  ${n}  ${e}`); } };

// 1) 正常拼接 text-delta
const mk = (chunks) => async function* () { for (const c of chunks) yield c; };
let seenOpts = null;
const ctx1 = { llm: { stream(o) { seenOpts = o; return mk([{ type: 'text-delta', text: 'he' }, { type: 'text-delta', text: 'llo' }, { type: 'finish', reason: { kind: 'stop' } }])(); } } };
const t1 = makeLlmTransport({ ctx: ctx1, route: () => ({ provider: 'p', model: 'm' }) });
check('拼接 text-delta', (await t1('hi')) === 'hello');
check('带内部标记（防递归）', seenOpts?.[INTERNAL_FLAG] === true);
check('带上 provider/model', seenOpts.provider === 'p' && seenOpts.model === 'm');
check('messages 是 parts 数组', Array.isArray(seenOpts.messages?.[0]?.content) && seenOpts.messages[0].content[0].text === 'hi');

// 2) finish=error 要抛
const ctx2 = { llm: { stream: () => mk([{ type: 'text-delta', text: 'x' }, { type: 'finish', reason: { kind: 'error', failure: { code: 'PROVIDER_ERROR' } } }])() } };
let threw = false;
try { await makeLlmTransport({ ctx: ctx2, route: () => ({ provider: 'p', model: 'm' }) })('x'); } catch (e) { threw = /PROVIDER_ERROR/.test(e.message); }
check('finish=error 会抛且带 code', threw);

// 3) abort 也要抛
const ctx3 = { llm: { stream: () => mk([{ type: 'finish', reason: { kind: 'aborted' } }])() } };
threw = false;
try { await makeLlmTransport({ ctx: ctx3, route: () => ({ provider: 'p', model: 'm' }) })('x'); } catch { threw = true; }
check('finish=aborted 会抛', threw);

// 4) 没有 route 直接抛，不发请求
let called = false;
const ctx4 = { llm: { stream: () => { called = true; return mk([])(); } } };
threw = false;
try { await makeLlmTransport({ ctx: ctx4, route: () => null })('x'); } catch { threw = true; }
check('没有 provider/model 直接抛', threw && !called);

// 5) 没有 ctx.llm 构造时就抛
threw = false;
try { makeLlmTransport({ ctx: {} }); } catch { threw = true; }
check('缺 ctx.llm 构造即抛', threw);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
