// 演示：篡改回执后验签必然失败
import fs from 'node:fs';
import { verifyReceipt } from '../lib/receipt.js';
import os from 'node:os';
import path from 'node:path';

const KEY = path.join(os.homedir(), '.dsh', 'claim-verify-receipt.key');
const file = 'C:/Users/19156/Documents/deepseek-harness/default-workspace/plugins/dsh-claim-verify/eval/demo-receipt.json';
const good = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log('原始回执：' + (verifyReceipt(good, { keyPath: KEY }).ok ? '有效' : '无效'));

const bad = JSON.parse(JSON.stringify(good));
bad.claims[1].verdict = 'supported'; // 把"命令失败"改成"成功"
const r = verifyReceipt(bad, { keyPath: KEY });
console.log('把 contradicted 改成 supported 后：' + (r.ok ? '仍有效（说明签名没用）' : '无效 —— ' + r.reason));

const bad2 = JSON.parse(JSON.stringify(good));
bad2.summary.contradicted = 0;
const r2 = verifyReceipt(bad2, { keyPath: KEY });
console.log('改 summary 后：' + (r2.ok ? '仍有效（说明摘要没用）' : '无效 —— ' + r2.reason));
