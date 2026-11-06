// actuator.js —— 执行器：写之前留底，写之后复读，不对就退回
//
// 这是"机器人"缺的那块：前面所有零件都只是**看**，这个才**动手**。
//
// 安全三原则（顺序不能变）：
//   ① 先留底（原文件快照 / 记录"原来不存在"）
//   ② 再写（走一次真实的 write）
//   ③ 立刻复读核对（字节数 + 内容哈希）
//   ④ 不一致就回滚——回滚也要复读，确认退回去了
//
// 为什么必须"复读"：写入成功不等于写对了（截断、编码、权限静默失败都见过）。
// 为什么必须"回滚"：拦截只能防一部分，写坏了要能退回去。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * 安全写入：留底 → 写 → 复读 → 不一致回滚。
 * @param {{path:string, content:string, encoding?:string}} req
 * @returns {{ok:boolean, rolledBack:boolean, reason?:string, bytes?:number}}
 */
export function safeWrite({ path: target, content, encoding = 'utf8' }, deps = {}) {
  const writeFile = deps.writeFile || fs.writeFileSync;
  const readFile = deps.readFile || fs.readFileSync;
  const exists = deps.exists || fs.existsSync;
  const remove = deps.remove || fs.rmSync;
  if (!target)
    return { ok: false, rolledBack: false, reason: '缺少目标路径' };
  const abs = path.resolve(target);
  const dir = path.dirname(abs);

  // ① 留底
  let hadFile = false;
  let backup = null;
  try {
    if (exists(abs)) {
      hadFile = true;
      backup = readFile(abs);
    }
  }
  catch (e) {
    return { ok: false, rolledBack: false, reason: '读取原文件失败：' + e.message };
  }

  // ② 写
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeFile(abs, content, encoding);
  }
  catch (e) {
    return { ok: false, rolledBack: false, reason: '写入失败：' + e.message };
  }

  // ③ 复读核对
  let actual;
  try {
    actual = readFile(abs);
  }
  catch (e) {
    return rollback(abs, hadFile, backup, '写入后读不到文件：' + e.message, { writeFile, readFile, exists, remove });
  }

  const want = Buffer.from(content, encoding);
  if (actual.length !== want.length) {
    return rollback(abs, hadFile, backup, `字节数不符：期望 ${want.length}，实际 ${actual.length}`, { writeFile, readFile, exists, remove });
  }
  if (sha256(actual) !== sha256(want)) {
    return rollback(abs, hadFile, backup, '内容哈希不符（写入了别的东西）', { writeFile, readFile, exists, remove });
  }

  return { ok: true, rolledBack: false, bytes: actual.length };
}

/** 回滚：原来有就写回，原来没有就删掉；回滚后还要复读确认 */
function rollback(abs, hadFile, backup, reason, io) {
  try {
    if (hadFile && backup) {
      fs.writeFileSync(abs, backup);
      const back = fs.readFileSync(abs);
      if (sha256(back) !== sha256(backup))
        return { ok: false, rolledBack: false, reason: reason + '；回滚后校验仍不符' };
    }
    else {
      fs.rmSync(abs, { force: true });
      if (fs.existsSync(abs))
        return { ok: false, rolledBack: false, reason: reason + '；回滚删除失败' };
    }
    return { ok: false, rolledBack: true, reason };
  }
  catch (e) {
    return { ok: false, rolledBack: false, reason: reason + '；回滚失败：' + e.message };
  }
}
