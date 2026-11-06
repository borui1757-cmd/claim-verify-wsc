// adapter.js —— 把"确定性判定"接进任何核验流水线
//
// 目标（拼接 A 方案）：别人的流水线已经有
//   ① 声明捕获  ② 证据收集（facts）  ④ 干预策略  ⑤ 日志
// 但第 ③ 段"判定"通常依赖外部分类器（要 API、有噪声）。
// 本模块提供**纯函数**接口：facts + claim → 三分类。零模型、零网络、可复现。
//
// 输入 facts 形状（与常见实现兼容，字段都可缺省）：
//   {
//     writes: [{ path, isError, textFailed }],
//     cmds:   [{ cmd, isError, textFailed, text }],
//     tests:  { run: boolean, passed: boolean|null }
//   }
// claim:
//   { kind: 'write'|'cmd'|'test', target }
//
// 输出：'supported' | 'contradicted' | 'insufficient'

import { decideAlt } from './decide-alt.js';
import { exitCodeAttributable } from './exit-attr.js';

/** 把 facts 转成 decideAlt 需要的 pairs 形状 */
export function factsToPairs(facts = {}) {
  const pairs = [];
  for (const w of facts.writes || []) {
    pairs.push({
      name: String(w.tool || 'write'),
      args: { path: w.path },
      text: String(w.text || ''),
      isError: w.isError === true,
      resultSeen: true,
    });
  }
  for (const c of facts.cmds || []) {
    pairs.push({
      name: String(c.tool || 'pwsh'),
      args: { command: c.cmd },
      text: String(c.text || ''),
      isError: c.isError === true,
      resultSeen: true,
    });
  }
  return pairs;
}

/**
 * 判定一条声明。
 * @param {{writes?:Array, cmds?:Array, tests?:{run:boolean,passed:boolean|null}}} facts
 * @param {{kind:string, target?:string}} claim
 * @returns {{verdict:string, detail:string}}
 */
export function adjudicate(facts = {}, claim = {}) {
  const { kind } = claim;
  if (!kind)
    return { verdict: 'insufficient', detail: '声明没有类型，弃权' };

  // 测试类：先看 tests 汇总（若上游已经算好）
  if (kind === 'test') {
    const t = facts.tests;
    if (t && t.run === false)
      return { verdict: 'contradicted', detail: '本轮没有运行过测试' };
    if (t && t.run === true) {
      if (t.passed === true)
        return { verdict: 'supported', detail: '有测试运行且退出码为 0' };
      if (t.passed === false)
        return { verdict: 'contradicted', detail: '测试运行了但失败' };
      return { verdict: 'insufficient', detail: '测试运行过，但退出码无法归属' };
    }
  }

  // 命令类：退出码不可归属时弃权
  if (kind === 'cmd') {
    const cmds = (facts.cmds || []).filter((c) => String(c.cmd || '').includes(String(claim.target || '')));
    if (cmds.length) {
      const attributable = cmds.filter((c) => exitCodeAttributable(c.cmd));
      if (!attributable.length)
        return { verdict: 'insufficient', detail: '命令被多条语句包装，退出码无法归属' };
    }
  }

  const pairs = factsToPairs(facts);
  const verdict = decideAlt(claim, pairs);
  return { verdict, detail: describe(verdict, claim) };
}

function describe(verdict, claim) {
  const what = claim.kind === 'write' ? '写入' : claim.kind === 'test' ? '测试' : '命令';
  if (verdict === 'supported')
    return `轨迹里有成功的${what}记录`;
  if (verdict === 'contradicted')
    return `轨迹里没有成功的${what}，或明确失败`;
  return `轨迹证据不足以判断${what}`;
}

/** 干预建议：只有反驳才值得打断；弃权一律放行 */
export function shouldIntervene(verdict) {
  return verdict === 'contradicted';
}

/**
 * 结构优先判定（推荐用于"怕误伤"的场景）。
 * 规则：结构化信号 → 退出码 → 否则弃权；文本关键词不单独作数。
 * 实验（38 用例）：误伤 0、漏判 0、弃权 34%。
 */
export function adjudicateStructured(facts = {}, claim = {}) {
  const w = (facts.writes || [])[0];
  const cmd = (facts.cmds || [])[0];
  const t = facts.tests;

  if (w)
    return { verdict: w.isError === true ? 'contradicted' : 'supported', detail: '结构化写入信号' };
  if (t) {
    if (t.run === false) return { verdict: 'contradicted', detail: '没有运行记录' };
    if (t.passed === true) return { verdict: 'supported', detail: '测试通过' };
    if (t.passed === false) return { verdict: 'contradicted', detail: '测试失败' };
    return { verdict: 'insufficient', detail: '退出码不可归属' };
  }
  if (cmd) {
    if (cmd.isError === true)
      return { verdict: 'contradicted', detail: '命令报错' };
    const text = String(cmd.text || '');
    const m = /\[exit code: (\d+)\]/.exec(text);
    const attributable = exitCodeAttributable(cmd.cmd);
    if (m && attributable)
      return { verdict: Number(m[1]) >= 1 ? 'contradicted' : 'supported', detail: '退出码可归属' };
    // 只有文本关键词：不单独作数
    return { verdict: 'insufficient', detail: '只有文本信号，弃权以避免误伤' };
  }
  return { verdict: 'insufficient', detail: '没有可判定的事实' };
}
