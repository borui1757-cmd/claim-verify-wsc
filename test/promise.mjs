// promise.mjs —— 结构对账：不调模型，只比对承诺与工具调用
import { checkPromises, summarizePromises } from '../lib/promise.js';

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log(`PASS  ${n}`); } else { fail++; console.log(`FAIL  ${n}  ${e}`); } };

const mk = (name, args, { isError = false, resultSeen = true, errorName = null } = {}) =>
  ({ name, args, isError, resultSeen, errorName, callSeq: 1 });

// 1. 说"测试通过"，但测试命令失败 → contradicted
let r = checkPromises('测试全部通过。', [mk('pwsh', { command: 'npm test' }, { isError: true, errorName: 'Exit' })]);
check('测试通过 vs 命令失败 → contradicted', r.results[0]?.verdict === 'contradicted', JSON.stringify(r.results));

// 2. 说"测试通过"，测试命令成功 → supported
r = checkPromises('测试全部通过。', [mk('pwsh', { command: 'npm test' })]);
check('测试通过 vs 命令成功 → supported', r.results[0]?.verdict === 'supported');

// 3. 说"测试通过"，但本轮根本没跑测试 → uncertain（不是错）
r = checkPromises('测试全部通过。', [mk('pwsh', { command: 'Get-Date' })]);
check('没跑测试 → uncertain', r.results[0]?.verdict === 'uncertain');

// 4. 写文件：说写到 A，实际写了 B → uncertain（v2：路径对不上不硬判，可能是相对路径）
r = checkPromises('已写入 `C:\\tmp\\a.txt`。', [mk('write', { file_path: 'C:\\tmp\\b.txt' })]);
check('写了别的路径 → uncertain（v2 精度优先）', r.results[0]?.verdict === 'uncertain', JSON.stringify(r.results));

// 4b. v2：否定句不进候选（"不需要重启" 不是声明）
r = checkPromises('配置已经生效，不需要重启。', [mk('pwsh', { command: 'x' }, { isError: true })]);
check('否定句被跳过', r.results.length === 0, JSON.stringify(r.results));

// 4c. v2：表格行不进候选
r = checkPromises('| `restore` | 28.1 MB | 中间目录 |', [mk('write', { file_path: 'C:\\a.txt' })]);
check('表格行被跳过', r.results.length === 0, JSON.stringify(r.results));

// 4d. v2：第三方主语不进候选（在解释，不是声称）
r = checkPromises('沙箱本身也拒绝向 `.dsh` 写入。', [mk('write', { file_path: 'C:\\a.txt' })]);
check('第三方主语被跳过', r.results.length === 0, JSON.stringify(r.results));

// 4e. v2：有写入但未指明路径 → uncertain（不误判成 contradicted）
r = checkPromises('已经写入了配置。', [mk('write', { file_path: 'C:\\a.txt' })]);
check('未指明路径 → uncertain', r.results[0]?.verdict === 'uncertain', JSON.stringify(r.results));

// 5. 写文件：路径命中且成功 → supported
r = checkPromises('已写入 `C:\\tmp\\a.txt`。', [mk('write', { file_path: 'C:\\tmp\\a.txt' })]);
check('路径命中且成功 → supported', r.results[0]?.verdict === 'supported');

// 6. 写文件：路径命中但失败 → contradicted
r = checkPromises('已写入 `C:\\tmp\\a.txt`。', [mk('write', { file_path: 'C:\\tmp\\a.txt' }, { isError: true, errorName: 'FsError' })]);
check('路径命中但写入失败 → contradicted', r.results[0]?.verdict === 'contradicted');

// 7. 声称写入，但本轮没有任何写操作 → contradicted
r = checkPromises('已经写入了配置。', [mk('pwsh', { command: 'dir' })]);
  check('没有任何写调用 → uncertain（无证据不判否定）', r.results[0]?.verdict === 'uncertain');

// 8. 路径大小写/斜杠归一
r = checkPromises('已写入 `c:/tmp/A.txt`。', [mk('write', { file_path: 'C:\\tmp\\a.txt' })]);
check('路径归一化后命中', r.results[0]?.verdict === 'supported', JSON.stringify(r.results));

// 9. 命令成功但实际失败 → contradicted
r = checkPromises('命令执行成功，退出码 0。', [mk('pwsh', { command: 'x' }, { isError: true })]);
check('命令成功 vs 失败 → contradicted', r.results[0]?.verdict === 'contradicted');

// 10. 无关句子不产生结果
r = checkPromises('我觉得这个方案更好。数据表明它有效。', [mk('pwsh', { command: 'x' })]);
check('非动作句不产出结果', r.results.length === 0, JSON.stringify(r.results));

// 11. 汇总
const s = summarizePromises([{ verdict: 'supported' }, { verdict: 'contradicted' }, { verdict: 'uncertain' }, { verdict: 'contradicted' }]);
check('汇总统计', s.supported === 1 && s.contradicted === 2 && s.uncertain === 1, JSON.stringify(s));

// 12. 空输入不炸
check('空报告返回空', checkPromises('', []).results.length === 0);
check('null 报告不炸', checkPromises(null, null).results.length === 0);

// 13. v2/v3：证据被截断时 contradicted 降级为 uncertain（闭世界假设守卫）
r = checkPromises('测试全部通过。', [mk('pwsh', { command: 'npm test' }, { isError: true })], { truncated: true });
check('证据截断 → contradicted 降为 uncertain', r.results[0]?.verdict === 'uncertain', JSON.stringify(r.results));

// 14. 未截断时同样输入仍判 contradicted
r = checkPromises('测试全部通过。', [mk('pwsh', { command: 'npm test' }, { isError: true })], { truncated: false });
check('未截断 → contradicted 保留', r.results[0]?.verdict === 'contradicted');

// 15. 状态核验：文件不存在 → contradicted（不靠日志）
r = checkPromises('已写入 `C:\\tmp\\nope.txt`。', [mk('write', { file_path: 'C:\\tmp\\nope.txt' })], { stat: () => ({ exists: false, path: 'C:\\tmp\\nope.txt' }) });
check('文件不存在 → contradicted', r.results[0]?.verdict === 'contradicted', JSON.stringify(r.results));

// 16. 状态核验：文件存在 + 有写入调用 → supported
r = checkPromises('已写入 `C:\\tmp\\yes.txt`。', [mk('write', { file_path: 'C:\\tmp\\yes.txt' })], { stat: () => ({ exists: true, path: 'C:\\tmp\\yes.txt' }) });
check('文件存在 + 写入成功 → supported', r.results[0]?.verdict === 'supported');

// 17. 顺序校验：证据发生在声明之后 → uncertain
r = checkPromises('测试全部通过。', [{ ...mk('pwsh', { command: 'npm test' }), turn: 9 }], { claimTurn: 5 });
check('证据晚于声明 → uncertain', r.results[0]?.verdict === 'uncertain', JSON.stringify(r.results));

console.log(`\n${pass}/${pass + fail} 通过`);
process.exit(fail === 0 ? 0 : 1);
