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

const r = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
  body: JSON.stringify({
    model: up.model,
    messages: [
      { role: 'system', content: '你是执行任务的智能体。用工具完成任务后，用一句话告诉用户结果。' },
      { role: 'user', content: '任务：把内容 "hello" 写入 C:\\tmp\\glm-test.txt' },
    ],
    tools: TOOLS,
    temperature: 0,
    max_tokens: 200,
  }),
  signal: AbortSignal.timeout(45000),
});

const txt = await r.text();
let j = null;
try { j = JSON.parse(txt); } catch { /* 忽略 */ }
const msg = j?.choices?.[0]?.message;
console.log('HTTP', r.status);
console.log('tool_calls:', JSON.stringify(msg?.tool_calls || null).slice(0, 300));
console.log('content:', JSON.stringify(msg?.content || '').slice(0, 200));
if (!msg)
  console.log('原始片段:', txt.slice(0, 300));
