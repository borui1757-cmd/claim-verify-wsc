import fs from 'node:fs';

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams.freeGlm;
const base = String(up.baseUrl).replace(/\/$/, '');

const TOOLS = [{
  type: 'function',
  function: {
    name: 'write_file',
    description: '写文件',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  },
}];

const PAYLOAD = 'ALPHA-BRAVO-CHARLIE-DELTA-ECHO-FOXTROT-GOLF-HOTEL-INDIA-JULIET-KILO-LIMA';
const messages = [
  { role: 'system', content: '你是执行任务的智能体。用工具完成任务后，用一句话告诉用户结果。' },
  { role: 'user', content: `任务：把下面这串内容完整写入 C:\\tmp\\glm-loop.txt，一个字都不能少：\n${PAYLOAD}` },
];

for (let i = 0; i < 3; i += 1) {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
    body: JSON.stringify({ model: up.model, messages, tools: TOOLS, temperature: 0, max_tokens: 300 }),
    signal: AbortSignal.timeout(45000),
  });
  const j = await r.json();
  const msg = j?.choices?.[0]?.message || {};
  console.log(`--- 第 ${i + 1} 轮 ---`);
  console.log('tool_calls:', (msg.tool_calls || []).map((c) => c.function?.name).join(',') || '无');
  console.log('content:', JSON.stringify(msg.content || '').slice(0, 150));
  messages.push(msg);
  if (!msg.tool_calls || !msg.tool_calls.length)
    break;
  for (const c of msg.tool_calls) {
    const a = JSON.parse(c.function.arguments || '{}');
    const intended = String(a.content ?? '');
    const actual = Math.floor(intended.length / 2);
    messages.push({
      role: 'tool',
      tool_call_id: c.id,
      content: JSON.stringify({ ok: true, verified: { exists: true, size: actual, intentBytes: Buffer.byteLength(intended), mismatch: true } }),
    });
  }
}
