// calibration.js —— 可验证性自校准（B）与重复假声明拦截（C）
//
// B：用历史账本告诉模型「你在这类声明上有多可靠」——不是改参数，而是改提示。
// C：同一个对象被证伪过多次后，再次声称成功时直接升级措辞（免疫记忆）。
//
// 两者都只读账本，零模型调用。

import { readLedger } from './worldmodel.js';

/** 归一化对象键：路径统一斜杠与大小写，命令取前 60 字。 */
export function objectKey(kind, target) {
  const t = String(target || '').trim();
  if (kind === 'file')
    return t.replace(/\//g, '\\').toLowerCase();
  if (kind === 'cmd')
    return t.replace(/\s+/g, ' ').toLowerCase().slice(0, 60);
  return t.toLowerCase();
}

/** 该对象在账本里的历史：支持/反对/总数。 */
export function historyOf(kind, target, { file, since = 0 } = {}) {
  const key = objectKey(kind, target);
  const rows = readLedger(file).filter((r) => r.kind === kind && objectKey(r.kind, r.target) === key && r.at >= since);
  return {
    total: rows.length,
    supported: rows.filter((r) => r.verdict === 'supported').length,
    contradicted: rows.filter((r) => r.verdict === 'contradicted').length,
    lastAt: rows.length ? rows[rows.length - 1].at : null,
  };
}

/** B：生成「可靠性提示」；样本不足返回 null。 */
export function calibrationNote(kind, target, { file, minSamples = 3, windowMs = 7 * 24 * 3600 * 1000 } = {}) {
  const since = Date.now() - windowMs;
  const h = historyOf(kind, target, { file, since });
  if (h.total < minSamples)
    return null;
  const rate = h.contradicted / h.total;
  if (rate < 0.5)
    return null;
  return `历史校准：过去 7 天关于该对象的 ${h.total} 次核验中，${h.contradicted} 次被证伪（${(rate * 100).toFixed(0)}%），请谨慎声称。`;
}

/** C：重复假声明——同一对象被证伪 ≥ N 次后的升级措辞。 */
export function repeatLiarNote(kind, target, { file, threshold = 2 } = {}) {
  const h = historyOf(kind, target, { file });
  if (h.contradicted < threshold)
    return null;
  return `该对象此前已被证伪 ${h.contradicted} 次；不要再次声称它成功，请如实报告失败或请求人工介入。`;
}
