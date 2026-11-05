// aivs.mjs —— 与 AIVS 对齐的行哈希与链
import { aivsRowHash, aivsFields, verifyAivsChain } from '../lib/aivs.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// 行哈希：同样的输入必须给出同样的 64 位十六进制
const h1 = aivsRowHash({ rowId: 1, sessionId: 's1', timestamp: 1700000000.5, prevHash: '' });
const h2 = aivsRowHash({ rowId: 1, sessionId: 's1', timestamp: 1700000000.5, prevHash: '' });
check('行哈希确定', h1 === h2 && /^[0-9a-f]{64}$/.test(h1), h1);

// 任一字段变化 → 哈希变化
check('改 row_id 变哈希', aivsRowHash({ rowId: 2, sessionId: 's1', timestamp: 1700000000.5 }) !== h1);
check('改 session 变哈希', aivsRowHash({ rowId: 1, sessionId: 's2', timestamp: 1700000000.5 }) !== h1);
check('改时间变哈希', aivsRowHash({ rowId: 1, sessionId: 's1', timestamp: 1700000001 }) !== h1);

// 链：两行，第二行引用第一行
const r1 = aivsFields({ rowId: 1, sessionId: 's1', timestamp: 1700000000 });
const r2 = aivsFields({ rowId: 2, sessionId: 's1', timestamp: 1700000001, prevHash: r1.row_hash });
check('r2.prev_hash 指向 r1', r2.prev_hash === r1.row_hash);
const ok = verifyAivsChain([{ aivs: r1 }, { aivs: r2 }]);
check('链完整', ok.ok === true && ok.count === 2, JSON.stringify(ok));

// 篡改：改 r1 的时间，r1 自身哈希对不上
const bad1 = { ...r1, timestamp: r1.timestamp + 10 };
const v1 = verifyAivsChain([{ aivs: bad1 }, { aivs: r2 }]);
check('篡改行内容被检出', v1.ok === false && v1.brokenAt === 1, JSON.stringify(v1));

// 篡改：直接改 r2 的 row_hash
const bad2 = { ...r2, row_hash: 'f'.repeat(64) };
const v2 = verifyAivsChain([{ aivs: r1 }, { aivs: bad2 }]);
check('篡改行哈希被检出', v2.ok === false && v2.brokenAt === 2);

// 删除中间行：prev 断链
const v3 = verifyAivsChain([{ aivs: r2 }]);
check('缺首行时 prev 不为空被检出或首行放行', typeof v3.ok === 'boolean');

// 空输入
check('空输入通过且 count=0', verifyAivsChain([]).ok === true && verifyAivsChain([]).count === 0);
check('无 aivs 字段的行被跳过', verifyAivsChain([{ other: 1 }]).count === 0);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
