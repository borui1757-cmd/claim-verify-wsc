// temporal.mjs —— 时序对时：瞬态原语不能拿"现在"否定"过去"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPlan, PRIMS } from '../lib/dsl.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-tm-'));
const file = path.join(dir, 'a.txt');
fs.writeFileSync(file, 'x');

check('瞬态原语被标记', PRIMS.port.transient === true && PRIMS.proc_alive.transient === true && PRIMS.reachable.transient === true && PRIMS.time_near.transient === true);
check('持久原语没被标瞬态', !PRIMS.exists.transient && !PRIMS.file_contains.transient && !PRIMS.math_eq.transient);

// 瞬态：不同轮 → insufficient
const portPlan = { all: [{ prim: 'port', args: { port: 64164 }, expect: true }] };
const sameTurn = await runPlan(portPlan, { claimTurn: 5, currentTurn: 5 });
check('同轮：端口没监听 → contradicted', sameTurn.verdict === 'contradicted', JSON.stringify(sameTurn));
const laterTurn = await runPlan(portPlan, { claimTurn: 5, currentTurn: 9 });
check('跨轮：瞬态改判 insufficient', laterTurn.verdict === 'insufficient' && /瞬态/.test(laterTurn.reason), JSON.stringify(laterTurn));

// 持久：跨轮仍然判
const existsPlan = { all: [{ prim: 'exists', args: { path: path.join(dir, 'nope.txt') }, expect: true }] };
const existsLater = await runPlan(existsPlan, { claimTurn: 5, currentTurn: 9 });
check('跨轮：持久原语仍可判 contradicted', existsLater.verdict === 'contradicted');

// supported 不受时序影响
const okPlan = { all: [{ prim: 'exists', args: { path: file }, expect: true }] };
const okLater = await runPlan(okPlan, { claimTurn: 5, currentTurn: 9 });
check('跨轮：成立的断言仍 supported', okLater.verdict === 'supported');

// 带 checkedAt
check('结果带 checkedAt', typeof sameTurn.checkedAt === 'string' && sameTurn.checkedAt.length > 10);
check('跨轮 insufficient 也带 checkedAt', typeof laterTurn.checkedAt === 'string');

// 不传轮次 = 老行为
const noTurns = await runPlan(portPlan);
check('不传轮次时保持原行为', noTurns.verdict === 'contradicted');

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败无所谓 */ }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
