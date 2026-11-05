#!/usr/bin/env node
// 慢循环：整理账本（去重 / 清噪音 / 过期归档）
//
//   node bin/consolidate.mjs            整理默认账本
//   node bin/consolidate.mjs --dry      只看会做什么，不改文件

import fs from 'node:fs';
import { consolidateFile, consolidate } from '../lib/consolidate.js';
import { readLedger, defaultLedgerPath } from '../lib/worldmodel.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const file = defaultLedgerPath();

if (!fs.existsSync(file)) {
  console.log(`账本不存在：${file}`);
  console.log('（插件跑起来后会自动生成；现在无事可做）');
  process.exit(0);
}

const rows = readLedger(file);
console.log(`账本：${rows.length} 条`);

if (dry) {
  const { stats } = consolidate(rows);
  console.log('\n[试运行]');
  console.log(`  保留 ${stats.kept}`);
  console.log(`  去重 ${stats.merged}`);
  console.log(`  噪音 ${stats.noise}`);
  console.log(`  过期 ${stats.expired}`);
  process.exit(0);
}

const r = consolidateFile(file);
if (!r.ok) {
  console.log('整理失败：' + r.reason);
  process.exit(1);
}
console.log(`\n保留 ${r.kept} 条（去重 ${r.merged}、噪音 ${r.noise}、过期 ${r.expired}）`);
console.log(`原文件归档：${r.archive}`);
