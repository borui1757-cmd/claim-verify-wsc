// guards.mjs —— 抽取守卫的回归测试（提升精度的第一步）
// 语料来源：2026-11-05 真实会话里被判过的句子（FP 全部来自 audit.jsonl 的误判样例）。
import { isClaimSentence } from '../lib/promise.js';

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}`); }
};

// 应该被判为「动作断言」的真阳性
const TP = [
  '修复已完成，测试全部通过',
  'dry.mjs 16/16、policy.mjs 8/8 全部通过',
  'relay 已重启，/health 返回 200',
  '我把花费护栏调到了 0.1',
  '已经写入了配置',
  '这轮跑了 3 个工具，其中 1 个失败',
];

// 不该被判的：条件、假设、元讨论、引述、标题、表格
const FP = [
  '如果测试通过，我就发布',
  '假如服务没起，先看日志',
  '我们讨论过这个问题，结论是先不动',
  '这句话的意思是它在复述提示词',
  '这意味着证据里没有对应调用',
  '「修复已完成，测试全部通过」← 测试命令 2/4 失败',
  '## 重启后',
  '| 说法 | 怎么验 | 依据 |',
  '- 严格正则覆盖 1.6%（太窄，只认写入路径）',
  '②和③都做完了，版本升到 0.4.0',
];

for (const s of TP)
  check('TP 保留：' + s.slice(0, 24), isClaimSentence(s) === true);
for (const s of FP)
  check('FP 剔除：' + s.slice(0, 24), isClaimSentence(s) === false);

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
