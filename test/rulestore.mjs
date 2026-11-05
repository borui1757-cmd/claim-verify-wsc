// rulestore.mjs —— 规则可修正性 + 健康度
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRuleStore } from '../lib/rulestore.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log(`PASS  ${n}`); } else { fail++; console.log(`FAIL  ${n}  ${e}`); } };

const file = path.join(os.tmpdir(), `rulestore-test-${Date.now()}.json`);

// 1. 默认启用
let s = makeRuleStore(file);
check('未知规则默认启用', s.isEnabled('r1') === true);

// 2. 停用后立刻失效
s.disable('r1', '环境变了，注入时间无需查');
check('停用后 isEnabled 为 false', s.isEnabled('r1') === false);
check('停用原因被记录', s.snapshot().rules.r1.disabledReason.includes('注入时间'));

// 3. 持久化：新实例读到同样状态
const s2 = makeRuleStore(file);
check('重新加载后仍为停用', s2.isEnabled('r1') === false);

// 4. 重新启用
s2.enable('r1');
check('启用后恢复', makeRuleStore(file).isEnabled('r1') === true);

// 5. 命中与跳过计数
s2.hit('r2'); s2.hit('r2'); s2.skip('r2');
const snap = s2.snapshot().rules.r2;
check('命中计数', snap.hits === 2 && snap.skips === 1, JSON.stringify(snap));
check('有 lastHitAt', typeof snap.lastHitAt === 'string');

// 6. 健康度排序（命中率低的排前面）
s2.hit('r3'); s2.skip('r3'); s2.skip('r3'); s2.skip('r3');
const h = s2.health();
check('低命中率规则排在前面', h[0].ratio <= h[h.length - 1].ratio, JSON.stringify(h.map((x) => `${x.id}:${x.ratio.toFixed(2)}`)));

// 7. 坏文件不崩
const bad = path.join(os.tmpdir(), `rulestore-bad-${Date.now()}.json`);
fs.writeFileSync(bad, '{不是合法 json', 'utf8');
let ok = true;
try { makeRuleStore(bad).isEnabled('x'); } catch { ok = false; }
check('坏 JSON 不抛异常', ok);

// 8. 快照是深拷贝
const a = s2.snapshot();
a.rules.r2.hits = 999;
check('快照是深拷贝', s2.snapshot().rules.r2.hits !== 999);

for (const f of [file, bad]) { try { fs.unlinkSync(f); } catch {} }
console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
