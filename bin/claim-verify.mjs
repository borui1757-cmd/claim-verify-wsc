#!/usr/bin/env node
// 命令行入口：把一段文本（stdin 或参数）里的可核验断言逐条比对本机真值。
// 用法：
//   echo "服务 Spooler 已经停止" | node bin/claim-verify.mjs
//   node bin/claim-verify.mjs "端口 3080 在跑"
//   --json 输出机器可读结果；--note 输出追加说明样式

import { readFileSync } from 'node:fs';
import { verifyText, renderNote } from '../lib/index.js';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const asNote = args.includes('--note');
const words = args.filter((a) => !a.startsWith('--'));

const text = words.length ? words.join(' ') : readFileSync(0, 'utf8');

const result = await verifyText(text, { sessionId: 'cli' });

if (asJson) {
  console.log(JSON.stringify({
    checked: result.checked,
    bad: result.bad.map((b) => ({ kind: b.claim.kind, value: b.claim.value, expect: b.expect, soft: !!b.soft })),
  }, null, 2));
}
else if (asNote) {
  console.log(renderNote(result) || '（没有发现不符的断言）');
}
else {
  console.log(`抽取到 ${result.claims.length} 条断言，核验了 ${result.checked} 条，不符 ${result.bad.length} 条`);
  for (const b of result.bad)
    console.log(`  [${b.soft ? '低置信' : '不符'}] ${b.claim.kind}: ${JSON.stringify(b.claim.value)} → ${b.expect}`);
}

process.exit(result.bad.filter((b) => !b.soft).length ? 1 : 0);
