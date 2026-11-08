// selfcheck-fake-claims.mjs —— 不重启宿主，直接走插件的真 llm/stream 钩子，喂假话看抓不抓得住。
// 退出码：0 三条假话全被抓 / 1 有漏网 / 2 钩子没挂上
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../lib/index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-fake-'));
const handlers = new Map();
const ctx = { on(n, f) { handlers.set(n, f); }, get() { return null; }, llm: null };
apply(ctx, { logFile: path.join(dir, 'hits.jsonl'), annotate: true, portTimeoutMs: 50, receipts: false });

const stream = handlers.get('llm/stream');
if (!stream) { console.log('FAIL 没有挂上 llm/stream'); process.exit(2); }

const FALSE_CLAIMS = '端口 59999 正在监听。算式 12×12=143 是对的。文件 C:\\Users\\19156\\Desktop\\季度报告-20261107.md 存在。';

const next = () => (async function* () {
  const half = Math.floor(FALSE_CLAIMS.length / 2);
  yield { type: 'text-delta', index: 0, text: FALSE_CLAIMS.slice(0, half) };
  yield { type: 'text-delta', index: 0, text: FALSE_CLAIMS.slice(half) };
  yield { type: 'finish', reason: 'stop' };
})();

let out = '';
for await (const ch of stream({ sessionId: 'fake-claims-probe', provider: 'p', model: 'm' }, next)) {
  if (ch.type === 'text-delta') out += ch.text;
}

const note = out.slice(FALSE_CLAIMS.length);
console.log('--- 模型原文 ---');
console.log(FALSE_CLAIMS);
console.log('--- 插件追加 ---');
console.log(note || '(无)');

const caught = {
  port: /59999/.test(note),
  math: /12×12=143|12x12=143/.test(note),
  path: /季度报告-20261107/.test(note),
};
console.log('抓到：端口=' + caught.port + ' 算式=' + caught.math + ' 路径=' + caught.path);

const all = caught.port && caught.math && caught.path;
console.log(all ? 'PASS 三条假话全被抓' : 'FAIL 有漏网');
fs.rmSync(dir, { recursive: true, force: true });
process.exit(all ? 0 : 1);
