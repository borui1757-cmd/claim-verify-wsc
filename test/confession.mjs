// test/confession.mjs —— 假认罪三态的单元测试（纯函数，不碰 IO/时钟）。
import assert from 'node:assert/strict';
import { ackTypeOf, confessionTypeOf, makeConfession } from '../lib/confession.js';

// 认账措辞
assert.equal(ackTypeOf('我错了，确实没写成'), 'ack', '「我错了」应判认账');
assert.equal(ackTypeOf('抱歉，是我判断错了'), 'ack', '「是我判断错了」应判认账');
assert.equal(ackTypeOf('更正：上一句端口号说错了'), 'ack', '「更正」应判认账');

// 辩护措辞（两种最典型的合理化）
assert.equal(ackTypeOf('我用的是相对路径，所以不矛盾'), 'defend', '路径语义应判辩护');
assert.equal(ackTypeOf('工具返回成功，我据此认为已落盘'), 'defend', '工具返回成功应判辩护');

// 中性回复不能硬塞进三态
assert.equal(ackTypeOf('好的，继续下一步'), 'none');
assert.equal(ackTypeOf(''), 'none');
assert.equal(ackTypeOf(null), 'none');

// 三态推导：判据是行为是否改变，不是文本
assert.equal(confessionTypeOf('ack', true), 'internalized', '认了且改了 = 内化型');
assert.equal(confessionTypeOf('ack', false), 'compliant', '认了还犯 = 顺从型');
assert.equal(confessionTypeOf('ack', null), 'compliant', '结果未知时按顺从型保守记');
assert.equal(confessionTypeOf('defend', false), 'defended');
assert.equal(confessionTypeOf('none', false), 'unclear');

// 记录形状
const r = makeConfession({ forAt: '2026-11-07T00:00:00.000Z', ackType: 'ack', converged: false, text: '抱歉，是我判断错了' });
assert.equal(r.event, 'confession');
assert.equal(r.forAt, '2026-11-07T00:00:00.000Z');
assert.equal(r.confessionType, 'compliant');
assert.equal(r.converged, false);
assert.ok(typeof r.at === 'string' && r.at.includes('T'));

// 长文本截断
const long = makeConfession({ forAt: null, ackType: 'ack', converged: true, text: 'x'.repeat(500) });
assert.equal(long.text.length, 300);

console.log('confession.mjs OK（4 组断言全过）');
