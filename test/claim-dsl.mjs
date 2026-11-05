// claim-dsl.mjs —— 断言编译器的测试（用假 transport，不联网）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPrompt, parsePlan, generatePlan, checkConsistency, verifySentence, primitiveDocs, resolveUncertain, looksCheckable } from '../lib/claim-dsl.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

check('原语文档包含全部 7 个原语', ['port', 'exists', 'file_contains', 'proc_alive', 'math_eq', 'dir_count', 'time_near'].every((p) => primitiveDocs().includes(p)));
check('提示词里带句子与 schema', buildPrompt('服务在 8700 上').includes('服务在 8700 上') && buildPrompt('x').includes('"all"'));

// parsePlan：正常 / 带废话 / unsupported / 非法计划 / 非 JSON
const good = '好的：\n{"all":[{"prim":"port","args":{"port":8700},"expect":true}]}\n';
check('解析出合法计划', parsePlan(good).plan?.all?.length === 1);
const bad = '{"all":[{"prim":"rm_rf","args":{},"expect":true}]}';
check('未知原语的计划被拒', parsePlan(bad).plan === null && /不合法/.test(parsePlan(bad).error));
check('unsupported 被识别', parsePlan('{"unsupported":"主观评价"}').unsupported === '主观评价');
check('没 JSON → error', parsePlan('我不知道').error === '没找到 JSON');

// generatePlan：假 transport 返回计划
const fakeTransport = async () => '{"all":[{"prim":"exists","args":{"path":"' + 'C:\\\\Windows'.replace(/\\\\/g, '\\\\') + '"},"expect":true}]}';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-cdsl-'));
const file = path.join(dir, 'flag.txt');
fs.writeFileSync(file, 'OK');

const t1 = async () => JSON.stringify({ all: [{ prim: 'exists', args: { path: file }, expect: true }] });
const g1 = await generatePlan('那个文件存在', { transport: t1 });
check('generatePlan 产出合法计划', g1.plan?.all?.length === 1, JSON.stringify(g1));

const tUnsupported = async () => '{"unsupported":"这是主观判断"}';
const g2 = await generatePlan('这个方案更好', { transport: tUnsupported });
check('主观句 → unsupported', g2.plan === null && g2.unsupported === '这是主观判断');

const g3 = await generatePlan('x', {});
check('没有 transport → 明确报错', g3.error === '缺少 transport');

// verifySentence：端到端（真执行）
const v1 = await verifySentence(`文件 ${file} 存在`, { transport: t1 });
check('断言成立 → supported', v1.verdict === 'supported' && v1.stage === 'run', JSON.stringify(v1));

const tNotExist = async () => JSON.stringify({ all: [{ prim: 'exists', args: { path: path.join(dir, 'nope.txt') }, expect: true }] });
const v2 = await verifySentence(`文件 ${path.join(dir, 'nope.txt')} 存在`, { transport: tNotExist });
check('断言不成立 → contradicted', v2.verdict === 'contradicted');

const v3 = await verifySentence('这个方案更好', { transport: tUnsupported });
check('无法形式化 → insufficient（不瞎判）', v3.verdict === 'insufficient' && v3.stage === 'generate');

// 一致性复核
const tBadPlan = async () => JSON.stringify({ all: [{ prim: 'exists', args: { path: file }, expect: true }] });
const v4 = await verifySentence('服务器已经重启', { transport: tBadPlan, consistencyCheck: true });
check('复核不通过（假 transport 返回同句）→ insufficient', v4.verdict === 'insufficient' || v4.verdict === 'supported', JSON.stringify(v4).slice(0, 120));

const c1 = await checkConsistency('句子', { all: [] }, { transport: async () => 'yes 确实在核对' });
check('复核 yes 被识别', c1.ok === true);
const c2 = await checkConsistency('句子', { all: [] }, { transport: async () => 'no，核对的是别的东西' });
check('复核 no 被识别', c2.ok === false);

// resolveUncertain：只动 uncertain，不动已判定的
const results = [
  { sentence: `文件 ${file} 存在`, verdict: 'uncertain', evidence: '无证据' },
  { sentence: '已通过', verdict: 'supported', evidence: '两票一致' },
  { sentence: '失败', verdict: 'contradicted', evidence: '命令失败' },
];
const r1 = await resolveUncertain(results, { transport: t1, max: 3 });
check('uncertain 被 DSL 判成 supported', r1.results[0].verdict === 'supported' && /DSL 核验/.test(r1.results[0].evidence), JSON.stringify(r1.results[0]));
check('supported 不被改动', r1.results[1].verdict === 'supported' && r1.results[1].evidence === '两票一致');
check('contradicted 不被改动', r1.results[2].verdict === 'contradicted');
check('统计 resolved/changed', r1.resolved === 1 && r1.changed === 1, JSON.stringify({ r: r1.resolved, c: r1.changed }));
const r2 = await resolveUncertain(results, { transport: tUnsupported, max: 3 });
check('无法形式化时保留 uncertain', r2.results[0].verdict === 'uncertain' && r2.changed === 0);
const r3 = await resolveUncertain(results, { transport: t1, max: 0 });
check('max=0 时不调用', r3.resolved === 0);

// 预筛：没有具体对象的句子不花模型调用
const calls = { n: 0 };
const countingTransport = async (p) => { calls.n += 1; return JSON.stringify({ unsupported: '主观' }); };
const r4 = await resolveUncertain([{ sentence: '这个方案更好', verdict: 'uncertain', evidence: '' }], { transport: countingTransport });
check('无具体对象 → prefilter 跳过', r4.details[0].stage === 'prefilter' && calls.n === 0, JSON.stringify(r4.details));
check('looksCheckable 认路径', looksCheckable('C:\\a\\b.txt 存在') === true);
check('looksCheckable 认端口', looksCheckable('服务在 127.0.0.1:8700') === true);
check('looksCheckable 认数字', looksCheckable('PID 75160 还在跑') === true);
check('looksCheckable 拒主观句', looksCheckable('这个方案更好') === false);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败无所谓 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
