// witness.mjs —— 翻译见证：计划参数必须能在原句里找到出处
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeWitness, anchorsOf, norm } from '../lib/witness.js';
import { verifySentence } from '../lib/claim-dsl.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

check('归一化：反斜杠/大小写/引号', norm('C:\\Users\\A\\b.txt') === 'c:/users/a/b.txt');
check('归一化：空格与反引号', norm('`C:\\a b.txt`') === 'c:/ab.txt');

const s1 = '我已经写入 C:\\Users\\x\\a.txt 这个文件';
const p1 = { all: [{ prim: 'exists', args: { path: 'C:\\Users\\x\\a.txt' }, expect: true }] };
const w1 = makeWitness(s1, p1);
check('路径能在原句找到 → 通过', w1.ok === true && w1.matched === 1, JSON.stringify(w1));

const p2 = { all: [{ prim: 'exists', args: { path: 'C:\\Users\\x\\OTHER.txt' }, expect: true }] };
const w2 = makeWitness(s1, p2);
check('路径找不到 → 不通过', w2.ok === false && /找不到出处/.test(w2.reason), JSON.stringify(w2));

const s3 = 'relay 在 127.0.0.1:8700 上监听';
const p3 = { all: [{ prim: 'port', args: { port: 8700 }, expect: true }] };
check('端口能在原句找到', makeWitness(s3, p3).ok === true);

const p4 = { all: [{ prim: 'port', args: { port: 64164 }, expect: true }] };
check('端口对不上 → 不通过', makeWitness(s3, p4).ok === false);

const s5 = 'A 里面写的是「结论：通过」';
const p5 = { all: [{ prim: 'file_contains', args: { path: 'C:\\A.md', text: '结论：通过' }, expect: true }] };
const w5 = makeWitness(s5, p5);
check('多参数：部分命中仍不通过', w5.ok === false && w5.matched === 1 && w5.total === 2, JSON.stringify(w5));

check('anchorsOf 取出 path/text/port', anchorsOf({ args: { path: 'C:\\a', text: 'x', port: 80 } }).length === 3);

// 端到端：模型给出"歪"的计划 → 见证拦住
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-wit-'));
const file = path.join(dir, 'real.txt');
fs.writeFileSync(file, 'hello');

const badTransport = async () => JSON.stringify({ all: [{ prim: 'exists', args: { path: file }, expect: true }] });
const vBad = await verifySentence('我把报告写到了别的路径', { transport: badTransport });
check('端到端：计划参数不在原句 → stage=witness, insufficient', vBad.stage === 'witness' && vBad.verdict === 'insufficient', JSON.stringify(vBad).slice(0, 160));

const goodTransport = async () => JSON.stringify({ all: [{ prim: 'exists', args: { path: file }, expect: true }] });
const vGood = await verifySentence(`文件 ${file} 存在吗，我说它存在`, { transport: goodTransport });
check('端到端：参数在原句 → 走到执行', vGood.stage === 'run', JSON.stringify(vGood).slice(0, 160));

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败无所谓 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
