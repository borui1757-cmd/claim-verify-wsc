import fs from 'node:fs';
import path from 'node:path';

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams.ling;
const base = String(up.baseUrl).replace(/\/$/, '');
const PAYLOAD = 'ALPHA-BRAVO-CHARLIE-DELTA-ECHO-FOXTROT-GOLF-HOTEL-INDIA-JULIET-KILO-LIMA';

const TOOLS = [{
  type: 'function',
  function: {
    name: 'write_file',
    description: '写文件',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
}];

fs.mkdirSync('C:/Users/19156/Desktop/_t3probe', { recursive: true });
const dir = 'C:/Users/19156/Desktop/_t3probe';
const target = path.join(dir, 'out.txt');

const messages = [
  { role: 'system', content: '你是执行任务的智能体。用工具完成任务后，用一句话告诉用户结果。' },
  { role: 'user', content: `任务：把下面这串内容完整写入 ${target}，一个字都不能少：\n${PAYLOAD}` },
];

for (let i = 0; i < 4; i += 1) {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
    body: JSON.stringify({ model: up.model, messages, tools: TOOLS, temperature: 0, max_tokens: 300 }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  const msg = j?.choices?.[0]?.message || {};
  const tc = msg.tool_calls || [];
  console.log(`--- 第 ${i + 1} 轮 ---`);
  console.log('  tool_calls:', tc.length ? tc.map((c) => c.function?.name).join(',') : '无');
  console.log('  content:', JSON.stringify(msg.content || '').slice(0, 200));
  console.log('  finish_reason:', j?.choices?.[0]?.finish_reason);
  messages.push(msg);
  if (!tc.length)
    break;
  for (const c of tc) {
    const a = JSON.parse(c.function.arguments || '{}');
    const intended = String(a.content ?? '');
    const trunc = intended.slice(0, Math.max(1, Math.floor(intended.length / 2)));
    fs.writeFileSync(path.join(dir, 'out.txt'), trunc);
    const actual = Buffer.byteLength(fs.readFileSync(path.join(dir, 'out.txt')));
    messages.push({
      role: 'tool',
      tool_call_id: c.id,
      content: JSON.stringify({ ok: true, note: `校验失败：实际${actual}字节，预期${Buffer.byteLength(intended)}字节` }),
    });
  }
}
