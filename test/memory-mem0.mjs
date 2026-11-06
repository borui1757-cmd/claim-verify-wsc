// memory-mem0.mjs —— 真值记忆 ↔ mem0 适配层
import { toMem0Add, fromMem0Hit, shouldSupersede, rankHits, renderInjection, PRIORITY } from '../lib/memory-mem0.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// ① 转 mem0 add
const add = toMem0Add({ key: 'C:\\a.txt', value: { exists: true, size: 36 }, source: 'os' }, { userId: 's1' });
check('生成 messages', Array.isArray(add.messages) && add.messages.length === 1);
check('metadata 含 key', add.metadata.key === 'C:\\a.txt');
check('os 来源标记 verified', add.metadata.verified === true);
check('优先级 = 3', add.metadata.priority === 3);
check('带 userId', add.userId === 's1');

// ② inference 不标 verified
const add2 = toMem0Add({ key: 'k', value: 1, source: 'inference' });
check('inference 不 verified', add2.metadata.verified === false);

// ③ 缺 key 抛错
let threw = false;
try { toMem0Add({ value: 1 }); } catch { threw = true; }
check('缺 key 抛错', threw);

// ④ 回读
const hit = { memory: '系统确认：C:\\a.txt = {"exists":true}', metadata: { key: 'C:\\a.txt', source: 'os', verified: true, priority: 3, validFrom: 1000 } };
const back = fromMem0Hit(hit);
check('回读保留来源', back.source === 'os');
check('回读保留 verified', back.verified === true);
check('回读保留时间', back.validFrom === 1000);

// ⑤ 冲突裁决
check('os 覆盖 inference', shouldSupersede({ source: 'os' }, { source: 'inference' }) === 'new');
check('inference 不能覆盖 os', shouldSupersede({ source: 'inference' }, { source: 'os' }) === 'old');
check('同来源新的胜', shouldSupersede({ source: 'os', validFrom: 200 }, { source: 'os', validFrom: 100 }) === 'new');
check('完全相同返回 tie', shouldSupersede({ source: 'os', validFrom: 100 }, { source: 'os', validFrom: 100 }) === 'tie');

// ⑥ 排序：verified 优先
const ranked = rankHits([
  { memory: 'a', metadata: { key: 'k1', source: 'inference', verified: false, priority: 1, validFrom: 9999 } },
  { memory: 'b', metadata: { key: 'k2', source: 'os', verified: true, priority: 3, validFrom: 1000 } },
]);
check('verified 排在前', ranked[0].key === 'k2');

// ⑦ 注入断言化
const text = renderInjection(ranked[0]);
check('注入含【系统记录】', text.includes('【系统记录】'), text);
check('注入不含"可能"', !text.includes('可能'), text);

// ⑧ 空输入
check('空 hit 不崩', fromMem0Hit({}).key === '');
check('无 winner 返回 null', renderInjection(null) === null);
check('PRIORITY 顺序正确', PRIORITY.os > PRIORITY.observation && PRIORITY.observation > PRIORITY.inference);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
