// trace.mjs —— 用**真实事件结构**验证轨迹缓冲与证据抽取。
// 事件形状取自本机实测（2026-11-05，12 个会话 3195 条 call）：
//   tool/call   { turn, step, callId, name, arguments(JSON 字符串) }
//   tool/result { turn, step, message:{ role:'tool', toolCallId, content:[{type:'text',text}], isError } }

import { createTrace } from '../lib/trace.js';
import { buildEvidence, findWrite } from '../lib/evidence.js';

const trace = createTrace();
const sessions = new Map();

function sessionFor(id) {
  if (!sessions.has(id))
    sessions.set(id, { id });
  return sessions.get(id);
}

function call(sid, { turn, step, callId, name, args }) {
  trace.onEvent(sessionFor(sid), {
    type: 'tool/call', seq: 1, time: Date.now(),
    data: { turn, step, callId, name, arguments: JSON.stringify(args) },
  });
}

function result(sid, { turn, step, callId, text = 'ok', isError = false, error = null }) {
  trace.onEvent(sessionFor(sid), {
    type: 'tool/result', seq: 2, time: Date.now(),
    data: {
      turn, step,
      message: {
        role: 'tool',
        source: { kind: 'tool', callId },
        toolCallId: callId,
        content: [{ type: 'text', text }],
        isError,
      },
      ...(error ? { error } : {}),
    },
  });
}

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// ── 场景 1：写文件成功 ────────────────────────────────────────────
call('s1', { turn: 1, step: 1, callId: 'c1', name: 'write', args: { file_path: 'C:\\Users\\user\\Desktop\\out.json', content: '{}' } });
result('s1', { turn: 1, step: 1, callId: 'c1', text: 'created' });
let { pairs, truncated } = trace.pairs('s1', 1);
let ev = buildEvidence(pairs, truncated);
check('写文件成功 → evidence.writes 有 1 条', ev.writes.length === 1, JSON.stringify(ev.counts));
check('路径已归一（小写、反斜杠）', ev.writes[0]?.path === 'c:\\users\\user\\desktop\\out.json', ev.writes[0]?.path);
check('findWrite 能按任意大小写命中', Boolean(findWrite(ev, 'C:/Users/user/Desktop/out.json')));
check('成功 → ok 为 true', ev.writes[0]?.ok === true);

// ── 场景 2：写文件失败（最危险的误报场景）─────────────────────────
call('s2', { turn: 2, step: 1, callId: 'c2', name: 'write', args: { file_path: 'C:\\tmp\\a.txt', content: 'x' } });
result('s2', { turn: 2, step: 1, callId: 'c2', isError: true, error: { name: 'FsError', code: 'EACCES' }, text: 'Error: access denied' });
({ pairs, truncated } = trace.pairs('s2', 2));
ev = buildEvidence(pairs, truncated);
check('写文件失败 → 仍记入 writes（失败也是证据）', ev.writes.length === 1);
check('失败 → ok 为 false', ev.writes[0]?.ok === false);
check('失败 → 捕获 errorName', ev.writes[0]?.errorName === 'FsError', String(ev.writes[0]?.errorName));

// ── 场景 3：命令成功与失败 ────────────────────────────────────────
call('s3', { turn: 1, step: 1, callId: 'c3a', name: 'pwsh', args: { command: 'npm test', description: 'run tests' } });
result('s3', { turn: 1, step: 1, callId: 'c3a', text: 'all green' });
call('s3', { turn: 1, step: 2, callId: 'c3b', name: 'mcp__cgp__cgp_exec', args: { cmd: 'node x.mjs' } });
result('s3', { turn: 1, step: 2, callId: 'c3b', isError: true, text: 'exit 1' });
({ pairs, truncated } = trace.pairs('s3', 1));
ev = buildEvidence(pairs, truncated);
check('两条命令都被识别', ev.commands.length === 2, JSON.stringify(ev.commands.map((c) => c.tool)));
check('pwsh 成功 / cgp_exec 失败', ev.commands[0].ok === true && ev.commands[1].ok === false);
check('counts.failed 计到 1', ev.counts.failed === 1, String(ev.counts.failed));

// ── 场景 4：只有 call 没有 result（截断/超时）─────────────────────
call('s4', { turn: 1, step: 1, callId: 'c4', name: 'write', args: { file_path: 'C:\\tmp\\b.txt', content: 'y' } });
({ pairs, truncated } = trace.pairs('s4', 1));
ev = buildEvidence(pairs, truncated);
check('没有 result → resultSeen 为 false（不能当成功）', ev.writes[0]?.resultSeen === false);
check('没有 result → ok 视为 true 但 resultSeen 提示证据不足', ev.writes[0]?.ok === true && ev.writes[0]?.resultSeen === false);

// ── 场景 5：参数是不可解析的字符串（防御）─────────────────────────
trace.onEvent(sessionFor('s5'), {
  type: 'tool/call', seq: 1, time: Date.now(),
  data: { turn: 1, step: 1, callId: 'c5', name: 'write', arguments: '{不是合法 JSON' },
});
({ pairs } = trace.pairs('s5', 1));
ev = buildEvidence(pairs, false);
check('参数解析失败不炸，且不产出错误写入项', ev.writes.length === 0, JSON.stringify(ev.writes));

// ── 场景 6：按 turn 过滤 ─────────────────────────────────────────
call('s6', { turn: 1, step: 1, callId: 'c6a', name: 'write', args: { file_path: 'C:\\a1.txt', content: '' } });
call('s6', { turn: 2, step: 1, callId: 'c6b', name: 'write', args: { file_path: 'C:\\a2.txt', content: '' } });
check('turn=1 只拿到 1 条', trace.pairs('s6', 1).pairs.length === 1);
check('turn=2 只拿到 1 条', trace.pairs('s6', 2).pairs.length === 1);

// ── 场景 7：隔离约束（静态检查）───────────────────────────────────
import fs from 'node:fs';
const evSrc = fs.readFileSync(new URL('../lib/evidence.js', import.meta.url), 'utf8');
check('evidence.js 不 import claim/report 相关模块',
  !/from\s+['"].*(claim|report|actions)/i.test(evSrc));
check('evidence.js 的导出函数不含 reportText 参数',
  !/function\s+\w+\s*\([^)]*reportText/i.test(evSrc));

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
