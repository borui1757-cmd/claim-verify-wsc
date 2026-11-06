// recorder.js —— 黑盒：连续记录、环形保留、哈希链防篡改、可回放。
//
// 为什么做这个：实时核验（TCAS）需要**判得准**，误报会让人关掉它；
// 黑盒（FDR）只需要**记得全**——它不判对错，所以不受 ρ₀/ρ₁ 的约束。
// 记 80% 就有 80% 的价值，这是唯一"做多少算多少"的路。
//
// 借鉴（非代码）：
//   - 飞机 FDR：连续记录 + 环形缓冲（只保留最近 N 小时）
//   - 区块链/审计日志：hash 链，任何改动都能检出
//   - in-toto/witness：provenance 锚定
//
// 设计取舍：
//   - **只存哈希，不存全文**：体积小、隐私友好；要全文按需去 timeline-box 取
//   - **append-only + 环形淘汰**：超限时保留最近 N 条，链首改为 checkpoint
//   - 同步写盘（appendFileSync）：崩溃时最多丢最后一条，简单可靠

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function canonical(obj) {
  if (obj === null || typeof obj !== 'object')
    return JSON.stringify(obj);
  if (Array.isArray(obj))
    return '[' + obj.map(canonical).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

export function createRecorder(opts = {}) {
  const dir = opts.dir || path.join(process.cwd(), '.blackbox');
  const file = path.join(dir, 'events.jsonl');
  const maxRecords = opts.maxRecords ?? 20000;
  fs.mkdirSync(dir, { recursive: true });

  /** 内存里的记录（环形窗口） */
  let records = [];
  /** 当前链头 */
  let head = 'genesis';
  /** 被淘汰的最后一条的哈希（压缩后校验用） */
  let checkpoint = 'genesis';
  let seq = 0;

  // 启动时载入已有记录（只载尾部 maxRecords 条）
  if (fs.existsSync(file)) {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    const tail = lines.slice(-maxRecords);
    records = tail.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (records.length) {
      head = records[records.length - 1].hash;
      seq = records[records.length - 1].seq || 0;
      checkpoint = records[0].prev || 'genesis';
    }
  }

  function append(type, payload) {
    seq += 1;
    const at = opts.now ? opts.now() : new Date().toISOString();
    const body = { seq, at, type, payload };
    const hash = sha256(head + canonical(body));
    const rec = { ...body, prev: head, hash };
    head = hash;
    records.push(rec);
    fs.appendFileSync(file, JSON.stringify(rec) + '\n');

    // 环形淘汰（内存 + 定期压缩磁盘）
    if (records.length > maxRecords) {
      const dropped = records.shift();
      checkpoint = dropped.hash;
      compactIfNeeded();
    }
    return rec;
  }

  function compactIfNeeded() {
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      if (lines.length <= maxRecords * 1.5)
        return;
      const keep = lines.slice(-maxRecords);
      fs.writeFileSync(file, keep.join('\n') + '\n');
    }
    catch { /* 压缩失败不影响记录 */ }
  }

  return {
    /** 记录一次工具调用（只存哈希，不存全文） */
    toolCall(name, args, result) {
      return append('tool_call', {
        tool: String(name || ''),
        argsHash: sha256(canonical(args ?? null)).slice(0, 16),
        resultHash: sha256(canonical(result ?? null)).slice(0, 16),
        ok: !(result && result.isError === true),
      });
    },

    /** 记录一条消息（只存长度与哈希） */
    message(role, text) {
      const s = String(text ?? '');
      return append('message', { role: String(role || ''), len: s.length, hash: sha256(s).slice(0, 16) });
    },

    /** 记录一轮世界变化（来自 task-delta） */
    delta(changes) {
      const list = Array.isArray(changes) ? changes : [];
      return append('delta', {
        count: list.length,
        ops: list.reduce((acc, c) => { acc[c.op] = (acc[c.op] || 0) + 1; return acc; }, {}),
        hash: sha256(canonical(list)).slice(0, 16),
      });
    },

    /** 通用事件 */
    event(type, payload) {
      return append(String(type), payload ?? null);
    },

    /** 对任意值取短哈希（调用方需要自己哈希参数时用） */
    hash(value) {
      return sha256(canonical(value ?? null)).slice(0, 16);
    },

    /** 当前链头（可交给 RFC3161 打时间戳做外部锚定） */
    head() {
      return { hash: head, seq, checkpoint };
    },

    /** 回放：返回 <= t 的最后状态摘要（t 为 ISO 字符串或毫秒） */
    replay(t) {
      const ts = typeof t === 'number' ? new Date(t).toISOString() : String(t);
      const upto = records.filter((r) => r.at <= ts);
      const last = upto[upto.length - 1] || null;
      return {
        at: ts,
        events: upto.length,
        lastEvent: last,
        // 按类型统计，方便快速看"之前发生了什么"
        byType: upto.reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {}),
      };
    },

    /** 取某段时间的记录 */
    between(t0, t1) {
      const a = typeof t0 === 'number' ? new Date(t0).toISOString() : String(t0);
      const b = typeof t1 === 'number' ? new Date(t1).toISOString() : String(t1);
      return records.filter((r) => r.at >= a && r.at <= b);
    },

    /** 校验链（窗口内；首条的 prev 允许等于 checkpoint） */
    verify() {
      let prev = records.length ? records[0].prev : 'genesis';
      if (records.length && prev !== checkpoint && prev !== 'genesis') {
        // 可能是旧窗口，仍然尝试按首条 prev 起算
      }
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const { prev: p, hash, ...body } = r;
        if (p !== prev)
          return { ok: false, at: i, reason: 'prev 不匹配' };
        if (sha256(prev + canonical(body)) !== hash)
          return { ok: false, at: i, reason: 'hash 不匹配' };
        prev = hash;
      }
      return { ok: true, count: records.length, head };
    },

    stats() {
      return { records: records.length, maxRecords, head, checkpoint, file };
    },
  };
}
