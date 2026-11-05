// claim-reader.mjs —— 双脑 ClaimReader 的离线验证（不需要真的调模型）
// 重点验证：JSON 抠取鲁棒性、字段校验、以及**隔离约束**（只吃报告，不吃轨迹）。

import fs from 'node:fs';
import { buildPrompt, parseClaims, extractClaimsLLM, makeHttpTransport } from '../lib/claim-reader.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// 1) 裸 JSON
let r = parseClaims('[{"verb":"write","target":"C:\\\\a.txt","quote":"已写入 a.txt"}]');
check('裸 JSON 能解析', r.claims.length === 1 && r.claims[0].target === 'C:\\a.txt');

// 2) ```json 围栏
r = parseClaims('```json\n[{"verb":"start","target":null}]\n```');
check('代码围栏能剥掉', r.claims.length === 1 && r.claims[0].verb === 'start');

// 3) 前后有废话
r = parseClaims('好的，结果如下：\n[{"verb":"test","target":null}]\n以上。');
check('前后废话能容忍', r.claims.length === 1);

// 4) 非法 JSON
r = parseClaims('[{"verb":"write",]');
check('非法 JSON → 空结果且带错误码', r.claims.length === 0 && r.error === 'bad-json');

// 5) 没有数组
r = parseClaims('抽不到');
check('没有数组 → no-json-array', r.claims.length === 0 && r.error === 'no-json-array');

// 6) 未知 verb 归到 other
r = parseClaims('[{"verb":"teleport","target":"x"}]');
check('未知 verb → other', r.claims[0].verb === 'other');

// 7) target 非字符串 → null
r = parseClaims('[{"verb":"write","target":{"path":"x"}}]');
check('target 非字符串 → null', r.claims[0].target === null);

// 8) 多余字段被丢弃，不污染下游
r = parseClaims('[{"verb":"write","target":"x","echo":"EVIL","reportText":"..."}]');
check('多余字段被丢弃', !('echo' in r.claims[0]) && !('reportText' in r.claims[0]));

// 9) transport 注入 + prompt 里确实只有报告
let capturedPrompt = '';
const fake = async (p) => { capturedPrompt = p; return '[{"verb":"write","target":"C:\\\\out.json","quote":"已写入"}]'; };
const out = await extractClaimsLLM('报告正文：已写入 out.json', { transport: fake });
check('extractClaimsLLM 走注入的 transport', out.claims.length === 1 && out.error === null);
check('prompt 里包含报告正文', capturedPrompt.includes('已写入 out.json'));
check('prompt 里不含任何轨迹字段', !/tool\/call|toolCallId|evidence/i.test(capturedPrompt));

// 10) 没有 transport 要明确报错，不能静默
let threw = false;
try { await extractClaimsLLM('x', {}); } catch { threw = true; }
check('缺 transport 直接抛错', threw);

// 11) transport 抛错能向上传播（由调用方决定降级）
threw = false;
try { await extractClaimsLLM('x', { transport: async () => { throw new Error('HTTP 503'); } }); }
catch { threw = true; }
check('transport 失败会上抛', threw);

// 12) 隔离约束（静态）
const src = fs.readFileSync(new URL('../lib/claim-reader.js', import.meta.url), 'utf8');
check('claim-reader.js 不 import 轨迹/证据模块',
  !/from\s+['"].*(trace|evidence|host|extra)/i.test(src));
check('导出函数签名里没有 trace/evidence 参数',
  !/(function\s+\w+|=>)\s*\([^)]*\b(trace|evidence|events)\b/i.test(src));

// 13) HTTP transport 的形状（不真的发请求，只检查它会构造正确的请求）
const t = makeHttpTransport({ baseUrl: 'http://127.0.0.1:9', model: 'x', timeoutMs: 50 });
let httpFailed = false;
try { await t('hi'); } catch { httpFailed = true; }
check('HTTP transport 连不上时会抛错（可被上层捕获降级）', httpFailed);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
