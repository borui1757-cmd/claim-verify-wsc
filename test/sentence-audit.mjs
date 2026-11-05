// sentence-audit.mjs —— 句子级三分类核验的离线测试（假 transport，不联网）
import fs from 'node:fs';
import {
  splitSentences, isActionSentence, pickSentences,
  buildGrounding, parseVerdicts, auditReport, summarize,
} from '../lib/sentence-audit.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// ── 1. 分句 ───────────────────────────────────────────────────────
const sents = splitSentences('已经写入配置文件。测试全部通过！服务已启动；端口 3080 在监听。');
check('中文句号/感叹号/分号 都能切开', sents.length === 4, JSON.stringify(sents));

// ── 2. 动作句过滤 ─────────────────────────────────────────────────
check('"测试全部通过" 被判为动作句', isActionSentence('测试全部通过'));
check('"我觉得这个方案更好" 不是动作句', !isActionSentence('我觉得这个方案更好'));

const picked = pickSentences('我觉得这个方案更好。已经写入了 3 个文件。建议明天再看。测试全部通过。');
check('只挑动作句', picked.length === 2, JSON.stringify(picked));

// ── 3. 证据文档构造 ───────────────────────────────────────────────
const pairs = [
  { name: 'write', isError: false, resultSeen: true, text: 'created C:\\out.json' },
  { name: 'pwsh', isError: true, resultSeen: true, text: 'exit code 1' },
  { name: 'pwsh', isError: false, resultSeen: false, text: '' },
];
const doc = buildGrounding(pairs);
check('证据里标出 ok / FAILED / NO_RESULT',
  doc.includes('ok') && doc.includes('FAILED') && doc.includes('NO_RESULT'));
check('证据里带工具输出片段', doc.includes('exit code 1'));

// ── 4. 解析容错 ───────────────────────────────────────────────────
let p = parseVerdicts('0|contradicted|命令FAILED\n1|supported|有写入', 2);
check('行格式能解析', p.verdicts.length === 2 && p.verdicts[0].verdict === 'contradicted' && p.verdicts[1].reason === '有写入');

p = parseVerdicts('```\n0｜supported｜ok\n```', 1);
check('全角竖线也能解析', p.verdicts.length === 1 && p.verdicts[0].verdict === 'supported');

p = parseVerdicts('```json\n[{"i":0,"verdict":"contradicted","reason":"命令失败"}]\n```', 3);
check('围栏 JSON 仍然兼容', p.verdicts.length === 1 && p.verdicts[0].verdict === 'contradicted');

p = parseVerdicts('结果：[{"i":0,"verdict":"SUPPORTED"}]', 1);
check('大小写归一', p.verdicts[0].verdict === 'supported');

p = parseVerdicts('[{"i":0,"verdict":"maybe"}]', 1);
check('非法 verdict → insufficient', p.verdicts[0].verdict === 'insufficient');

p = parseVerdicts('[{"i":9,"verdict":"supported"}]', 2);
check('越界索引被丢弃', p.verdicts.length === 0);

p = parseVerdicts('没有数组也没行', 2);
check('两种都没有 → 错误码', p.verdicts.length === 0 && p.error === 'no-json-array');

// ── 5. 端到端（假 transport）──────────────────────────────────────
const report = '已经写入配置文件 out.json。测试全部通过。服务已启动。';
const fakeOk = async () => '[{"i":0,"verdict":"supported","reason":"有写操作"},{"i":1,"verdict":"contradicted","reason":"命令FAILED"},{"i":2,"verdict":"insufficient","reason":"记录未提"}]';
const r = await auditReport(report, { pairs, transport: fakeOk });
check('端到端：挑出 3 句并给出 3 个判定', r.verdicts.length === 3, JSON.stringify(r.verdicts.map((v) => v.verdict)));
check('矛盾句被识别为 contradicted', r.verdicts[1].verdict === 'contradicted');
check('没有证据时给 insufficient', r.verdicts[2].verdict === 'insufficient');

const t = summarize(r.verdicts);
check('汇总统计正确', t.supported === 1 && t.contradicted === 1 && t.insufficient === 1, JSON.stringify(t));

// 模型漏答某句 → 该句降级为 insufficient（宁可放过）
const fakePartial = async () => '[{"i":0,"verdict":"supported"}]';
const r2 = await auditReport(report, { pairs, transport: fakePartial });
check('模型漏答 → 缺失句标 unverified（不是 insufficient）',
  r2.verdicts.filter((v) => v.verdict === 'unverified').length === 2, JSON.stringify(r2.verdicts.map(v=>v.verdict)));

// 没有证据 → 不调用模型
let called = false;
const r3 = await auditReport(report, { pairs: [], transport: async () => { called = true; return '[]'; } });
check('没有证据 → 不调模型，返回 no-evidence', !called && r3.error === 'no-evidence');

// transport 抛错向上传播
let threw = false;
try { await auditReport(report, { pairs, transport: async () => { throw new Error('HTTP 503'); } }); }
catch { threw = true; }
check('transport 失败会上抛（可降级）', threw);

// 没有动作句 → 不调用模型
let called2 = false;
const r4 = await auditReport('我觉得还行。建议再看看。', { pairs, transport: async () => { called2 = true; return '[]'; } });
check('没有动作句 → 不调模型', !called2 && r4.sentences.length === 0);

// ── 6. 隔离约束（静态）────────────────────────────────────────────
const src = fs.readFileSync(new URL('../lib/sentence-audit.js', import.meta.url), 'utf8');
check('不 import 报告抽取模块', !/from\s+['"].*(claim-reader|actions)/i.test(src));
check('buildGrounding 签名里没有 report', !/function buildGrounding\([^)]*report/i.test(src));

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
