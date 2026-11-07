import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams.deepseek;
const base = String(up.baseUrl).replace(/\/$/, '');

const TOOLS = [{
  type: 'function',
  function: {
    name: 'read_file',
    description: '读取文件内容',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
}];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-dbg-'));
const target = path.join(dir, 'f.txt');

for (const arm of ['missing', 'exists']) {
  if (arm === 'exists')
    fs.writeFileSync(target, 'CONTENT-OK-42');
  else
    try { fs.rmSync(target); } catch { /* 忽略 */ }

  const messages = [
    { role: 'system', content: '你是执行任务的智能体。用工具完成任务后，用一句话告诉用户结果。' },
    { role: 'user', content: `任务：读取 ${target} 的内容并告诉我。` },
  ];
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
    body: JSON.stringify({ model: up.model, messages, tools: TOOLS, temperature: 0, max_tokens: 200 }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  const msg = j?.choices?.[0]?.message || {};
  console.log(`[${arm}] 第1轮 tool_calls=${(msg.tool_calls || []).map((c) => c.function?.name).join(',') || '无'} content=${JSON.stringify((msg.content || '').slice(0, 80))}`);

  if (msg.tool_calls && msg.tool_calls.length) {
    messages.push(msg);
    for (const c of msg.tool_calls) {
      messages.push({
        role: 'tool',
        tool_call_id: c.id,
        content: JSON.stringify(arm === 'exists' ? { ok: true, content: 'CONTENT-OK-42' } : { ok: false, error: 'ENOENT: no such file or directory' }),
      });
    }
    const r2 = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
      body: JSON.stringify({ model: up.model, messages, tools: TOOLS, temperature: 0, max_tokens: 200 }),
      signal: AbortSignal.timeout(60000),
    });
    const j2 = await r2.json();
    const m2 = j2?.choices?.[0]?.message || {};
    console.log(`[${arm}] 第2轮 tool_calls=${(m2.tool_calls || []).length} content=${JSON.stringify((m2.content || '').slice(0, 100))}`);
  }
}
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
