import fs from 'node:fs';

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));

for (const [name, up] of [['Ling', cfg.upstreams.ling], ['GLM', cfg.upstreams.freeGlm], ['DeepSeek', cfg.upstreams.deepseek]]) {
  const base = String(up.baseUrl).replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
      body: JSON.stringify({ model: up.model, messages: [{ role: 'user', content: '只回答两个字：收到' }], temperature: 0, max_tokens: 20 }),
      signal: AbortSignal.timeout(30000),
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch { /* 忽略 */ }
    const content = j?.choices?.[0]?.message?.content;
    console.log(`[${name}] HTTP ${r.status}  内容=${JSON.stringify(content)}`);
    if (!content)
      console.log(`   原始返回片段：${txt.slice(0, 200)}`);
  }
  catch (e) {
    console.log(`[${name}] 请求失败：${String(e && e.message).slice(0, 100)}`);
  }
}
