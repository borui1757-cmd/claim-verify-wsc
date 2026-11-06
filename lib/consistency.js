// consistency.js —— 一致性层：不查系统也能发现谎话
//
// 依据：逻辑题「骑士与无赖」的结构——不能逐条验证，但可以从**互相矛盾**推出
// "至少有一条是假的"。审讯室里对口径，不需要去现场。
//
// 边界（很重要）：**只在同一条消息内部判断**。
// 跨消息的矛盾可能只是"世界变了"（先写后删、端口起停），那是时序，不是撒谎。
// 所以这里只抓"同一段话里自相矛盾"。
//
// 能抓的四类：
//   ① 同对象同属性给了两个值      「a.txt 有 3 行」+「a.txt 有 5 行」
//   ② 同对象肯定/否定并存        「a.txt 存在」+「a.txt 不存在」
//   ③ 量级不可能                「文件 5 字节」+「它有 8 行」（每行至少 1 字节）
//   ④ 端口既在听又没听            「3210 在监听」+「3210 没有监听」

/** 取断言的比较键（同一对象 + 同一属性 = 同一个键） */
function keyOf(claim) {
  const k = claim.kind;
  const v = claim.value;
  if (k === 'path')
    return `path|${String(v).toLowerCase()}`;
  if (k === 'port' || k === 'pid')
    return `${k}|${v}`;
  if (k === 'lines' || k === 'size' || k === 'hash')
    return `${k}|${String(v && v.path || '').toLowerCase()}`;
  if (k === 'filecount')
    return `filecount|${String(v && v.dir || '').toLowerCase()}`;
  if (k === 'service')
    return `service|${String(v && v.name || '').toLowerCase()}`;
  return `${k}|${JSON.stringify(v)}`;
}

/** 断言的可比值（同键下用来发现冲突） */
function valueOf(claim) {
  const v = claim.value;
  if (claim.kind === 'lines' || claim.kind === 'size')
    return v && v.n !== undefined ? v.n : v && v.bytes;
  if (claim.kind === 'filecount')
    return v && v.n;
  if (claim.kind === 'path' || claim.kind === 'port' || claim.kind === 'pid'
    || claim.kind === 'service')
    return claim.polarity === 'neg' ? 'NEG' : 'POS';
  if (claim.kind === 'hash')
    return v && v.prefix;
  return JSON.stringify(v);
}

/**
 * 在同一条消息的断言集合里找自相矛盾。
 * @param {Array} claims 同一条消息里抽出的断言
 * @returns {Array<{key:string, kind:string, values:any[], items:Array}>}
 */
export function findContradictions(claims) {
  const groups = new Map();
  for (const c of claims || []) {
    if (!c || !c.kind)
      continue;
    const k = keyOf(c);
    const g = groups.get(k) || { key: k, kind: c.kind, items: [], values: new Set() };
    g.items.push(c);
    g.values.add(valueOf(c));
    groups.set(k, g);
  }

  const out = [];
  for (const g of groups.values()) {
    const vals = [...g.values];
    // ①/② 同键多值（含 POS/NEG 并存）
    if (vals.length > 1) {
      out.push({ key: g.key, kind: g.kind, reason: '同一对象给了互相矛盾的值', values: vals.map(String) });
      continue;
    }
    // ③ 长度不可能：声称的行数 > 声称的字节数
    if (g.kind === 'lines') {
      const lineClaim = g.items[0];
      const sizeClaim = (claims || []).find((c) => c && c.kind === 'size'
        && String(c.value && c.value.path || '').toLowerCase() === String(lineClaim.value && lineClaim.value.path || '').toLowerCase());
      const n = lineClaim.value && lineClaim.value.n;
      const bytes = sizeClaim && (sizeClaim.value && (sizeClaim.value.bytes ?? sizeClaim.value.n));
      if (Number.isFinite(n) && Number.isFinite(bytes) && n > bytes) {
        out.push({ key: g.key, kind: 'lines+size', reason: `声称 ${n} 行但只有 ${bytes} 字节（每行至少 1 字节）`, values: [String(n), String(bytes)] });
      }
    }
  }
  return out;
}

/** 渲染成一句人话 */
export function summarizeContradictions(list) {
  if (!list || !list.length)
    return '';
  const heads = list.slice(0, 3).map((c) => `「${c.key.split('|')[0]}」${c.reason}（${c.values.join(' vs ')}）`);
  const more = list.length > 3 ? ` 等 ${list.length} 处` : '';
  return `【自相矛盾】${heads.join('；')}${more}。同一段话里出现互相矛盾的断言，至少有一条是假的。`;
}
