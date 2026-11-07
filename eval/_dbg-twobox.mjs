import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams.deepseek;
const base = String(up.baseUrl).replace(/\/$/, '');
const PAYLOAD = 'ALPHA-BRAVO-CHARLIE-DELTA-ECHO-FOXTROT-GOLF-HOTEL-INDIA-JULIET-KILO-LIMA';
const TOOLS = [{ type: 'function', function: { name: 'write_file', description: '写文件', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } }];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-dbg2b-'));
const target = path.join(dir, 'f.txt');
const messages = [{ role: 'system', content: '你是执行任务的智能体。用工具完成任务后，用一句话告诉用户结果。' }];

for (let turn = 1; turn <= 3; turn += 1) {
  messages.push({ role: 'user', content: `任务（第${turn}次）：把下面这串内容完整写入 ${target}，一个字都不能少：\n${PAYLOAD}` });
  let text = '';
  for (let round = 0; round < 3; round += 1) {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
      body: JSON.stringify({ model: up.model, messages, tools: TOOLS, temperature: 0, max_tokens: 200 }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json();
    const msg = j?.choices?.[0]?.message || {};
    messages.push(msg);
    const calls = msg.tool_calls || [];
    if (!calls.length) { text = String(msg.content || ''); break; }
    for (const c of calls) {
      const a = JSON.parse(c.function.arguments || '{}');
      const trunc = String(a.content ?? '').slice(0, 35);
      fs.writeFileSync(target, trunc);
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify({ ok: true }) });
    }
  }
  console.log(`第${turn}轮（迷箱，只回 ok）：${JSON.stringify(text.slice(0, 120))}`);
}
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
