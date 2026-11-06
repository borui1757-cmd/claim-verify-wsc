// fix.js —— 确定性错误的"更正"（Guardrails 的 FIX 语义，中文环境版）
//
// 别人的做法（Guardrails OnFail）：FIX 直接改掉、REFRAIN 干脆不返回。
// 我们受一个约束：**改写已经流出的正文会破坏流式与工具调用交错**，
// 所以只对"数值唯一、能确定对"的错误做更正：
//
//   算术  a×b=错  → a×b=对
//   时间  "现在 03:40" 写错 → 真实时间
//   其余  不能确定 → 不碰，只追加提示
//
// 用法：
//   ① fixText(text, {claims, nowMs})  —— 离线/报告：直接改写文本
//   ② correctionLine(claim, {nowMs})  —— 输出：生成一行"更正：正确答案是 X"

const OP = {
  '乘以': (a, b) => a * b, '乘': (a, b) => a * b, '×': (a, b) => a * b, '*': (a, b) => a * b,
  '除以': (a, b) => a / b, '除': (a, b) => a / b, '÷': (a, b) => a / b, '/': (a, b) => a / b,
  '加': (a, b) => a + b, '＋': (a, b) => a + b, '+': (a, b) => a + b,
  '减': (a, b) => a - b, '－': (a, b) => a - b, '-': (a, b) => a - b,
};

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e4) / 1e4));
const p2 = (n) => String(n).padStart(2, '0');

/** 算一条算术断言的真值；算不出来返回 null */
function mathTruth(claim) {
  const v = claim && claim.value;
  if (!v || v.a === undefined)
    return null;
  const fn = OP[String(v.op || '').trim()];
  if (!fn)
    return null;
  const real = fn(Number(v.a), Number(v.b));
  if (!Number.isFinite(real))
    return null;
  return { real, claimed: Number(v.claimed) };
}

/** 时间的正确写法 */
function timeTruth(claim, nowMs = Date.now()) {
  const v = claim && claim.value;
  if (!v || v.hour === undefined)
    return null;
  const d = new Date(nowMs);
  return { hhmm: `${p2(d.getHours())}:${p2(d.getMinutes())}`, said: `${p2(v.hour)}:${p2(v.minute)}` };
}

/**
 * 就地更正确定性错误。
 * @returns {{text:string, fixed:Array<{from:string,to:string,kind:string}>}}
 */
export async function fixText(text, ctx = {}) {
  let out = String(text ?? '');
  const nowMs = ctx.nowMs ?? Date.now();
  const fixed = [];
  const claims = Array.isArray(ctx.claims) ? ctx.claims : [];

  for (const c of claims) {
    if (!c || !c.raw)
      continue;

    if (c.kind === 'math') {
      const t = mathTruth(c);
      if (!t || !Number.isFinite(t.claimed) || Math.abs(t.real - t.claimed) < 1e-9)
        continue;
      const to = c.raw.replace(String(t.claimed), fmt(t.real));
      if (to !== c.raw && out.includes(c.raw)) {
        out = out.split(c.raw).join(to);
        fixed.push({ from: c.raw, to, kind: 'math' });
      }
      continue;
    }

    if (c.kind === 'time') {
      const t = timeTruth(c, nowMs);
      if (!t || t.said === t.hhmm)
        continue;
      const to = c.raw.replace(/\d{1,2}\s*[:：]\s*\d{1,2}/, t.hhmm);
      if (to !== c.raw && out.includes(c.raw)) {
        out = out.split(c.raw).join(to);
        fixed.push({ from: c.raw, to, kind: 'time' });
      }
    }
  }

  return { text: out, fixed };
}

/** 输出场景：给一条确定性错误生成"更正"行（不回溯改写正文） */
export async function correctionLine(claim, ctx = {}) {
  if (!claim || !claim.raw)
    return '';
  const nowMs = ctx.nowMs ?? Date.now();

  if (claim.kind === 'math') {
    const t = mathTruth(claim);
    if (!t || Math.abs(t.real - t.claimed) < 1e-9)
      return '';
    return `【更正】${claim.raw} 错了，正确结果是 ${fmt(t.real)}。`;
  }

  if (claim.kind === 'time') {
    const t = timeTruth(claim, nowMs);
    if (!t || t.said === t.hhmm)
      return '';
    return `【更正】时间写错了：那一刻是 ${t.hhmm}，不是 ${t.said}。`;
  }

  return '';
}
