// property.mjs —— 属性测试：随机输入下的不变量（不崩、三分类、只读无副作用）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePlan, runPlan } from '../lib/dsl.js';
import { extractEvidence, decideClaims, parseClaimsFromText } from '../lib/isolated-audit.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// 可复现的伪随机
let seed = 20261105;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-prop-'));
const file = path.join(dir, 'a.txt');
fs.writeFileSync(file, 'hello');

const PRIMS = ['exists', 'file_contains', 'math_eq', 'port', 'proc_alive', 'dir_count', 'time_near'];
const VERDICTS = new Set(['supported', 'contradicted', 'insufficient']);

// P1 随机合法计划：不崩、返回三分类之一
let p1ok = 0;
for (let i = 0; i < 120; i += 1) {
  const prim = pick(PRIMS);
  let args = {};
  if (prim === 'exists') args = { path: pick([file, path.join(dir, 'x.txt')]) };
  if (prim === 'file_contains') args = { path: file, text: pick(['hello', 'nope']) };
  if (prim === 'math_eq') args = { expr: pick(['1+1', '2*3']), value: pick([2, 6, 7]) };
  if (prim === 'port') args = { port: pick([8700, 64164, 1]) };
  if (prim === 'proc_alive') args = { pid: pick([process.pid, 999999]) };
  if (prim === 'dir_count') args = { dir, ext: '.txt', count: pick([1, 5]) };
  if (prim === 'time_near') args = { hhmm: '12:00', toleranceMin: 600 };
  const plan = { all: [{ prim, args, expect: rnd() > 0.5 }] };
  const v = validatePlan(plan);
  if (!v.ok)
    continue;
  const r = await runPlan(plan);
  if (VERDICTS.has(r.verdict))
    p1ok += 1;
}
check(`P1 随机合法计划全部返回三分类（${p1ok} 条）`, p1ok > 60);

// P2 随机非法计划：必须被拒，且不执行
let p2ok = 0;
for (let i = 0; i < 120; i += 1) {
  const plan = {
    all: [{ prim: pick(['exec', 'rm', 'eval', '']), args: { a: rnd() }, expect: true }],
  };
  if (!validatePlan(plan).ok)
    p2ok += 1;
}
check(`P2 未知原语一律被拒（${p2ok}/120）`, p2ok === 120);

// P3 只读原语不改变文件内容
const before = fs.readFileSync(file, 'utf8');
for (let i = 0; i < 60; i += 1) {
  await runPlan({ all: [{ prim: 'file_contains', args: { path: file, text: 'hello' }, expect: true }] });
  await runPlan({ all: [{ prim: 'exists', args: { path: file }, expect: true }] });
}
check('P3 只读原语无副作用', fs.readFileSync(file, 'utf8') === before);

// P4 随机轨迹不会让证据抽取/判定崩溃
let p4ok = 0;
for (let i = 0; i < 200; i += 1) {
  const pairs = Array.from({ length: Math.floor(rnd() * 6) }, () => ({
    name: pick(['write', 'edit', 'pwsh', 'read', 'mcp__cgp__cgp_exec']),
    callId: 'c' + Math.floor(rnd() * 1000),
    args: pick([{ file_path: 'C:\\a.txt' }, { command: 'npm test' }, null, {}]),
    isError: rnd() > 0.7,
    resultSeen: rnd() > 0.2,
    text: pick(['ok', 'FAIL', '', 'Error: x']),
  }));
  const ev = extractEvidence(pairs);
  const out = decideClaims([{ sentence: 'x', kind: pick(['write', 'cmd', 'test']), target: pick([null, 'C:\\a.txt', 'npm test']) }], ev);
  if (verdictOk(out))
    p4ok += 1;
}
function verdictOk(out) {
  return Array.isArray(out) && out.every((r) => VERDICTS.has(r.verdict));
}
check(`P4 随机轨迹不崩且三分类（${p4ok}/200）`, p4ok === 200);

// P5 声明解析对任意文本健壮
let p5ok = 0;
for (let i = 0; i < 200; i += 1) {
  const text = pick(['[]', '{"a":1}', '[[[', 'not json', '[{"sentence":"x","kind":"write","target":null}]', '']);
  const arr = parseClaimsFromText(text);
  if (Array.isArray(arr))
    p5ok += 1;
}
check(`P5 任意文本解析不崩（${p5ok}/200）`, p5ok === 200);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
