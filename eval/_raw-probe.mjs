import fs from 'node:fs';

const cfg = JSON.parse(fs.readFileSync('C:/Users/19156/Documents/deepseek-harness/default-workspace/relay/config.json', 'utf8'));
const up = cfg.upstreams.deepseek;
const BASE = String(up.baseUrl).replace(/\/$/, '');

const SYS = [
  '把这句话转成可被下列原语检查的断言。原语与参数严格如下：',
  'port{port}, exists{path}, proc_alive{pid}, http_status{url,status}。',
  '只输出 JSON：{"assertions":[{"prim":"原语名","args":{}}]}。',
  '若无法转成上述任何一种，输出 {"assertions":[]}。args 的值必须具体。',
].join('\n');

const cases = [
  '重启已完成，--dump-config 校验过，ling 与主模型都能加载',
  'QQ.exe 版本已经变成 9.9.36.53644',
  '桥接 3100 端口正常',
];

for (const c of cases) {
  const r = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + up.apiKey },
    body: JSON.stringify({
      model: up.model || 'deepseek-chat',
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: c }],
      temperature: 0, max_tokens: 200,
    }),
  });
  const j = await r.json();
  console.log('句:', c);
  console.log('RAW:', JSON.stringify(j?.choices?.[0]?.message?.content || '').slice(0, 300), '\n');
}
