// cases.js —— 案例留档：把「报告 + 证据快照」存下来，供以后离线复算精度。
//
// 为什么需要：现在没有有机的新样本，历史 audit.jsonl 只存了判定结果，没存当时的证据，
// 导致"重放判定、换判定器、量精度"都做不了。这里把原始材料留下来，零模型调用。

/** 把一轮的材料压成一条可复算的案例。 */
export function makeCase({ sessionId, turn, report, pairs, maxReport = 4000, maxPairs = 40, maxPairText = 600 }) {
  const list = Array.isArray(pairs) ? pairs : [];
  return {
    v: 1,
    at: new Date().toISOString(),
    sessionId: sessionId ?? null,
    turn: Number.isInteger(turn) ? turn : null,
    report: String(report || '').slice(-maxReport),
    pairs: list.slice(-maxPairs).map((p) => ({
      name: p.name ?? 'unknown',
      callId: p.callId ?? null,
      turn: Number.isInteger(p.turn) ? p.turn : null,
      args: p.args ?? null,
      isError: p.isError === true,
      resultSeen: p.resultSeen === true,
      text: String(p.text || '').slice(0, maxPairText),
    })),
  };
}

/** 从案例里还原成 checkPromises 需要的 pairs 形状（够用即可）。 */
export function pairsOfCase(c) {
  return Array.isArray(c?.pairs) ? c.pairs.map((p) => ({ ...p })) : [];
}
