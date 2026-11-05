// policy-predicate.mjs —— 谓词式策略（路径前缀）+ 链头锚定
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePolicy, checkPlan, normalizeRule } from '../lib/policy.js';
import { chainHead, verifyAnchor } from '../lib/anchor.js';

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}  ${extra}`); }
};

// ── 谓词式策略
const prefix = 'C:\\Users\\user\\Desktop\\';
const pol = { default: 'allow', rules: { write_file: { decision: 'pending', allowPathPrefix: prefix } } };
check('对象规则合法', validatePolicy(pol).ok === true, JSON.stringify(validatePolicy(pol).errors));
check('前缀非法被拒', validatePolicy({ rules: { write_file: { decision: 'pending', allowPathPrefix: 'Desktop\\' } } }).ok === false);
check('decision 非法被拒', validatePolicy({ rules: { write_file: { decision: 'sure' } } }).ok === false);
check('多余字段被拒', validatePolicy({ rules: { write_file: { decision: 'allow', x: 1 } } }).ok === false);
check('normalizeRule 字符串兼容', normalizeRule('deny').decision === 'deny');

const inside = { all: [{ prim: 'write_file', args: { path: prefix + 'a.txt', content: 'x' }, expect: true }] };
const outside = { all: [{ prim: 'write_file', args: { path: 'C:\\Windows\\evil.txt', content: 'x' }, expect: true }] };

const dIn = checkPlan(inside, pol);
check('范围内的写 → pending', dIn.blocked === true && dIn.decisions[0].decision === 'pending' && /需要人工审批/.test(dIn.decisions[0].reason));

const dOut = checkPlan(outside, pol);
check('范围外的写 → deny', dOut.blocked === true && dOut.decisions[0].decision === 'deny' && /不在允许范围/.test(dOut.decisions[0].reason), JSON.stringify(dOut.decisions));

check('大小写不敏感', checkPlan({ all: [{ prim: 'write_file', args: { path: 'c:\\users\\user\\desktop\\b.txt', content: 'x' }, expect: true }] }, pol).decisions[0].decision === 'pending');

// ── 链头锚定
const receipts = [{ digest: 'aaa' }, { digest: 'bbb' }, { digest: 'ccc' }];
const head = chainHead(receipts);
check('链头是 64 位 hex', /^[0-9a-f]{64}$/.test(head));
check('同输入同链头', chainHead(receipts) === head);
check('顺序不同 → 链头不同', chainHead([{ digest: 'bbb' }, { digest: 'aaa' }]) !== chainHead([{ digest: 'aaa' }, { digest: 'bbb' }]));
check('缺 digest 的条目被跳过', chainHead([{ digest: 'aaa' }, {}, { digest: 'bbb' }]) === chainHead([{ digest: 'aaa' }, { digest: 'bbb' }]));

const anchor = { at: '2026-11-05T00:00:00Z', head, count: 3, ok: true };
check('锚点与当前回执一致', verifyAnchor(anchor, receipts).ok === true);
check('回执被追加后锚点不一致', verifyAnchor(anchor, [...receipts, { digest: 'ddd' }]).ok === false);
check('回执被改写后锚点不一致', verifyAnchor(anchor, [{ digest: 'zzz' }, { digest: 'bbb' }, { digest: 'ccc' }]).ok === false);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
