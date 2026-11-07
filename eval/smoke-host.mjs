// 真机冒烟：服务 / 注册表 / 计划任务（不注入假真值）
import { extractClaims, verifyClaims } from '../lib/index.js';
import { serviceState, registryValue, taskState } from '../lib/host.js';

const KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Spooler';
console.log('直接真值:');
console.log('  service Spooler =', JSON.stringify(serviceState('Spooler')));
console.log('  reg Start       =', JSON.stringify(registryValue(KEY, 'Start')));
const task = taskState('Microsoft\\Windows\\Defrag\\ScheduledDefrag');
console.log('  task Defrag     =', JSON.stringify(task));

const cases = [
  `服务 Spooler 正在运行。`,
  `服务 Spooler 已经停止。`,
  `${KEY} 的 Start 是 2。`,
  `${KEY} 的 Start 是 4。`,
];
if (task && task.found)
  cases.push(`计划任务 Microsoft\\Windows\\Defrag\\ScheduledDefrag 状态是就绪。`);

for (const c of cases) {
  const s = Date.now();
  const claims = extractClaims(c);
  const r = await verifyClaims(claims, 'smoke', { portTimeoutMs: 50, moneyTolerance: 0.3 }, {});
  console.log(`${r.bad.length ? 'BAD' : 'OK '} ${String(Date.now() - s).padStart(3)}ms  ${c}  →  ${JSON.stringify(r.bad.map((b) => b.expect))}`);
}
