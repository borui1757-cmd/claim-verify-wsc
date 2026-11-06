// independence.js —— 证据源独立性：让"四面镜子"不再同时犯错
//
// 来自「正方体问题」的结论：
//   镜像房间若是正方形/球（最大对称），反射形成**闭合轨道**，镜像与现实重合，失去分辨力。
//   要获得分辨力，必须**打破对称**：Sinai 台球（方厅里挖个圆）→ 轨迹混沌 → 镜像被打散。
//
// 映射到证据：如果四条证据都从**同一个 stat()** 派生，它们会同时对、同时错——
// 一致性检查看起来通过，实际上什么都没验。
//
// 做法：同一个事实用**不同的系统调用**各自观测，交叉比对：
//   stat()       → 存在性、大小、mtime
//   readdir()    → 目录项里有没有这个名字
//   read()       → 真实字节数（而不是 stat 声称的）
//   hash()       → 内容指纹（与字节数互相印证）
//
// 它们同时出错的概率远低于同源；一旦不一致，就说明"世界与元数据不同步"。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 用四种独立观测看同一个文件，返回观测值 + 冲突 */
export function observeFile(abs) {
  const out = {
    path: abs,
    statExists: false,
    readdirExists: false,
    sizeStat: null,
    contentLength: null,
    lines: null,
    hash: null,
    conflicts: [],
  };

  // ① stat
  try {
    const st = fs.statSync(abs);
    out.statExists = st.isFile();
    out.sizeStat = st.size;
  }
  catch { out.statExists = false; }

  // ② readdir（父目录项）—— 与 stat 相互独立
  try {
    const dir = path.dirname(abs);
    const name = path.basename(abs);
    out.readdirExists = fs.readdirSync(dir).includes(name);
  }
  catch { out.readdirExists = false; }

  // ③ read（真实字节）
  try {
    const buf = fs.readFileSync(abs);
    out.contentLength = buf.length;
    out.lines = buf.toString('utf8').split('\n').length - (buf.length && buf[buf.length - 1] === 10 ? 1 : 0);
  }
  catch { out.contentLength = null; }

  // ④ hash（独立于字节数，但可互相印证）
  try {
    out.hash = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  }
  catch { out.hash = null; }

  // ── 交叉比对 ──
  if (out.statExists !== out.readdirExists) {
    out.conflicts.push({
      kind: '存在性不一致',
      detail: `stat 认为${out.statExists ? '存在' : '不存在'}，readdir 认为${out.readdirExists ? '存在' : '不存在'}`,
    });
  }
  if (out.statExists && out.contentLength !== null && out.sizeStat !== out.contentLength) {
    out.conflicts.push({
      kind: '大小不一致',
      detail: `stat 说 ${out.sizeStat} 字节，read 拿到 ${out.contentLength} 字节`,
    });
  }
  if (out.statExists && out.contentLength === null) {
    out.conflicts.push({ kind: '无法读取', detail: 'stat 说存在，但 read 读不到内容' });
  }

  return out;
}

/** 把冲突渲染成人话 */
export function summarizeConflicts(obs) {
  if (!obs || !obs.conflicts || !obs.conflicts.length)
    return '';
  const parts = obs.conflicts.map((c) => `${c.kind}（${c.detail}）`);
  return `【证据冲突】${obs.path}：${parts.join('；')}。同一事实的两条独立观测不一致，说明元数据与世界不同步。`;
}
