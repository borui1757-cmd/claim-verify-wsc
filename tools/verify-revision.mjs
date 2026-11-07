// verify-revision.mjs —— 原子修订到底有没有真的开始落盘（确定性判据，零模型）。
//
// 为什么需要：revision/v2 的代码上线了 ≠ 线路上真有原子修订。
// 数据只在"一轮带 ```claims 块（或 report_claims 工具）的对话结束"时才产生，
// 所以要能区分三种情况：还没数据 / 有数据但全是影子 / 有原子修订。
//
// 退出码（机器可判）：
//   0 REVISION-LIVE  —— revisions.jsonl 有原子记录，且无时钟倒序/无影子冒充证据
//   1 REVISION-BAD   —— 有违规：非原子记录混进 revisions.jsonl、时钟倒序、影子被当证据
//   2 REVISION-EMPTY —— 还没有任何修订记录（宿主没重启 / 还没跑过带 claims 的一轮）
//
// 用法：
//   node tools\verify-revision.mjs
//   node tools\verify-revision.mjs --json
//   node tools\verify-revision.mjs --quiet

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditRevisions, REVISIONS_FILE, SHADOW_FILE } from '../lib/revision-log.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const dir = process.env.CLAIM_VERIFY_DIR || path.join(os.homedir(), '.dsh', 'dsh-claim-verify');
const revFile = path.join(dir, REVISIONS_FILE);
const shadowFile = path.join(dir, SHADOW_FILE);

const r = auditRevisions(dir);
const exists = fs.existsSync(revFile);
const shadowExists = fs.existsSync(shadowFile);

let code = 0;
let verdict = 'REVISION-LIVE';
let action = '原子修订已在实际回执链上产出';

if (r.violations.length) {
  code = 1;
  verdict = 'REVISION-BAD';
  action = r.violations.join('；');
}
else if (!exists && !shadowExists) {
  code = 2;
  verdict = 'REVISION-EMPTY';
  action = '还没有任何修订记录：宿主可能还没重启到新 build，或还没有跑过带 ```claims 的一轮';
}
else if (r.revisions.atomic === 0) {
  // 有影子但没原子：影子期是预期状态，不算失败，但要如实说"还没到过原子"
  code = 2;
  verdict = 'REVISION-SHADOW-ONLY';
  action = `只有影子记录 ${r.shadow.total} 条、原子 0 条：说明链路通了，但本轮没有"认账 + 动作成功 + 三时钟"齐备的修订`;
}

const status = {
  ok: code === 0,
  verdict,
  exitCode: code,
  action,
  at: new Date().toISOString(),
  dir,
  revisions: { exists, total: r.revisions.total, atomic: r.revisions.atomic, legacy: r.revisions.legacy, incomplete: r.revisions.incomplete, clockViolations: r.revisions.clockViolations },
  shadow: { exists: shadowExists, total: r.shadow.total, fakeEvidence: r.shadow.fakeEvidence },
  violations: r.violations,
};

if (flag('--json'))
  console.log(JSON.stringify(status));
else if (flag('--quiet'))
  console.log(`${verdict} atomic=${r.revisions.atomic} shadow=${r.shadow.total} violations=${r.violations.length}`);
else {
  console.log('原子修订判据（verify-revision）');
  console.log(`  目录     ${dir}`);
  console.log(`  原子     ${exists ? `${r.revisions.total} 条（atomic ${r.revisions.atomic} / legacy ${r.revisions.legacy} / 缺时钟 ${r.revisions.incomplete} / 倒序 ${r.revisions.clockViolations}）` : '(文件不存在)'}`);
  console.log(`  影子     ${shadowExists ? `${r.shadow.total} 条` : '(文件不存在)'}`);
  console.log('');
  console.log(`  结论     ${verdict}（exit ${code}）`);
  console.log(`  含义     ${action}`);
}

// --soft：给人/自动化诊断用 —— 永远退出 0，只把真实结论放进输出。
// 为什么要有：这个脚本用退出码当判据（狗那边靠 cmd_exit_0），但在交互式终端里
// 退出 2（"还没数据"）会被外层当成"命令失败"，触发无意义的失败告警。
// 机器判据请用不带 --soft 的模式；人看/排障用 --soft。
if (flag('--soft'))
  process.exit(0);
process.exit(code);
