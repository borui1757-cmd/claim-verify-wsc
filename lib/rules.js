// rules.js —— 把用户纠正编译成可机器检查的规则。
//
// 原料来源：eval/corrections.mjs 从 80 个会话里抽出 221 条去重后的规则句，
// 这里挑出**能纯字符串/结构判定**的 8 条做成原型（其余主观条款不适合机器判）。
//
// 每条规则 = { id, why, scope, check(ctx) }，ctx = { reportText, pairs }
// 返回 null（未违反）或 { evidence, confidence }

const cmdOf = (p) => String(p?.args?.[p.name === 'pwsh' ? 'command' : 'cmd'] ?? '');
const pathOf = (p) => String(p?.args?.file_path ?? p?.args?.path ?? '');

/** 剥掉开头的变量赋值 / cd / powershell -Command 包装，拿到真正的首个命令 */
export function headCmd(cmd) {
  let s = String(cmd || '').trim();
  // 去掉 powershell -Command "...." 的外壳
  s = s.replace(/^powershell(?:\.exe)?\s+(?:-\w+\s+)*-(?:Command|c)\s+["']?/i, '');
  // 反复剥掉 `$var=...;` 与 `cd ...;`
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s.replace(/^\s*\$\w+\s*=\s*[^;]*;\s*/i, '')
      .replace(/^\s*Set-Location\s+[^;]+;\s*/i, '')
      .replace(/^\s*cd\s+[^;]+;\s*/i, '')
      .replace(/^\s*cd\s+[^&]+&&\s*/i, '')
      .replace(/^\s*"[^"]*"\s*&&\s*/i, '')
      .replace(/^\s*"\s*|\s*"\s*$/g, '');
    if (s === before)
      break;
  }
  return s;
}

/** 配置文件白名单（只认具体文件，不认目录） */
const CONFIG_BASENAMES = /^(cordis\.patch\.yml|cordis\.web\.yml|cordis\.yml|package\.json)$/i;

/**
 * 数据上下文：这些 head 的参数字符串是"数据"，不执行。
 * 例：node -e "...pnpm add y..." → pnpm add 只是字符串，不是真跑。
 * 折中方案（无原生 parser 依赖）：命中时只保留 head，丢掉参数串。
 */
const DATA_HEADS = /^(?:node|python|python3|echo|printf)\b[^\n]{0,60}?\s+-{0,2}(?:e|c)\b/i;

function dataArgStrip(cmd) {
  const s = String(cmd || '').trim();
  const m = DATA_HEADS.exec(s);
  if (!m)
    return s;
  // 只保留到 -e / -c 为止，后面的都是"数据"
  return s.slice(0, m.index + m[0].length);
}

/** 真正要扫描的命令文本：先剥 powershell/变量包装，再去掉数据上下文的字符串 */
const scanOf = (p) => dataArgStrip(headCmd(cmdOf(p)));

export const RULES = [
  {
    id: 'pnpm_add',
    why: '不要用 pnpm add：会把 hoisted 布局重建为 isolated，导致 node_modules 半坏',
    blindSpots: '不检查 node -e / python -c / echo 的字符串参数；不检查写在脚本文件里的 pnpm add',
    check: ({ pairs }) => {
      const hit = (pairs || []).find((p) => /^pnpm\s+(add|i|install)\b/i.test(headCmd(scanOf(p))));
      return hit ? { evidence: `执行了 ${headCmd(scanOf(hit)).slice(0, 80)}`, confidence: 1 } : null;
    },
  },
  {
    id: 'taskkill_dsh',
    why: '不要在 DSH 的 shell 里 taskkill DSH：进程在 job object 里，会连带杀掉自己',
    blindSpots: '不检查 node -e 里的字符串；不检查通过脚本间接杀进程',
    check: ({ pairs }) => {
      const hit = (pairs || []).find((p) => {
        const c = scanOf(p);
        return /(?:taskkill[^\n]*(?:node|deepseek|harness)|Stop-Process[^\n]*(?:node|DeepSeek))/i.test(c)
          && !/restart-delayed|launch-web|一键恢复|启动备份/i.test(c);
      });
      return hit ? { evidence: `执行了 ${scanOf(hit).slice(0, 90)}`, confidence: 0.9 } : null;
    },
  },
  {
    id: 'stale_host',
    why: '不要再给已失效的花生壳/旧隧道地址',
    check: ({ reportText }) => {
      const dead = /131hi857pv428\.vicp\.fun|peanut\.nas|花生壳地址/i.exec(reportText || '');
      return dead ? { evidence: `报告里出现失效地址：${dead[0]}`, confidence: 1 } : null;
    },
  },
  {
    id: 'time_claim_no_cmd',
    why: '报时间必须跑命令，禁止心算（v2：先把「说对了」排除掉，只抓说错的）',
    env: 'host-time-injected-or-clock',
    check: ({ reportText, pairs }) => {
      const t = reportText || '';
      // 抓「现在/当前 + 时间」
      const m = /(?:现在|当前|此刻)(?:是|为|时间)?\s*(\d{1,2})[:：](\d{2})/.exec(t)
        || /(\d{1,2})[:：](\d{2})\s*(?:了|左右)/.exec(t);
      if (!m)
        return null;
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      if (!(hh >= 0 && hh < 24 && mm >= 0 && mm < 60))
        return null;
      const now = new Date();
      const claimed = new Date(now);
      claimed.setHours(hh, mm, 0, 0);
      const diffMin = Math.abs(now - claimed) / 60000;
      // 说对了（±15 分钟）→ 不算违规：可能来自宿主注入，也可能真查了
      if (diffMin <= 15)
        return null;
      const ranClock = (pairs || []).some((p) => /Get-Date|\[DateTime\]|__CLOCK/i.test(cmdOf(p)));
      if (ranClock)
        return null;
      return { evidence: `报告说 ${m[1]}:${m[2]}，实际 ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}（差 ${Math.round(diffMin)} 分钟），且本轮无时间查询`, confidence: 0.9 };
    },
  },
  {
    id: 'restart_claim_no_proof',
    why: '不要相信「重启了」：要看进程 StartTime 才能判断是否真重启',
    blindSpots: '只看同一轮；跨轮的核对算违反（粒度待改进）',
    check: ({ reportText, pairs, allPairs }) => {
      if (!/(重启成功|已重启|重新启动(?:了|完成))/ .test(reportText || ''))
        return null;
      const pool = allPairs && allPairs.length ? allPairs : pairs;
      const proof = (pool || []).some((p) => /Get-Process|StartTime|tasklist|Get-CimInstance/i.test(cmdOf(p)));
      return proof ? null : { evidence: '声称重启，但整个会话都没有进程启动时间核对', confidence: 0.8 };
    },
  },
  {
    id: 'profile_write_no_backup',
    why: '改 DSH 配置前必须先备份',
    blindSpots: '只认 .dsh/profiles 下的配置文件；备份动作在别的轮次也算通过',
    check: ({ pairs, allPairs }) => {
      const pool = allPairs && allPairs.length ? allPairs : pairs;
      const w = (pool || []).find((p) => {
        const full = pathOf(p);
        const base = full.split(/[\\/]/).pop() || '';
        return CONFIG_BASENAMES.test(base) && /\.dsh|profiles/i.test(full);
      });
      if (!w)
        return null;
      const backed = (pool || []).some((p) => /copy-item|cp\s+|robocopy|\.bak/i.test(cmdOf(p)));
      return backed ? null : { evidence: `改了 ${pathOf(w).slice(0, 70)}，整个会话都没有备份动作`, confidence: 0.75 };
    },
  },
  {
    id: 'script_reinvent',
    why: '不要重复造脚本：先看 tools/ 有没有现成的',
    check: ({ pairs }) => {
      const list = pairs || [];
      const w = list.find((p) => /\.(ps1|bat|cmd)$/i.test(pathOf(p)));
      if (!w)
        return null;
      const looked = list.some((p) => p.callSeq < w.callSeq && /tools[\\/]|Get-ChildItem|dir\s/i.test(cmdOf(p) + pathOf(p)));
      return looked ? null : { evidence: `写了 ${pathOf(w).slice(0, 60)}，之前没有查过现有脚本`, confidence: 0.6 };
    },
  },
  {
    id: 'number_without_tool',
    why: '报数字必须来自工具：金额/文件大小/PID 不能在报告里凭空出现',
    check: ({ reportText, pairs }) => {
      const t = reportText || '';
      const m = /((?:PID|pid)\s*\d{3,}|\d+(?:\.\d+)?\s*(?:MB|GB|KB))\b/.exec(t);
      if (!m)
        return null;
      // 在**完整**工具输出里找（trace 现在保留 4000 字）
      const compact = m[1].replace(/\s+/g, '');
      const shown = (pairs || []).some((p) => {
        const s = String(p.text || '').replace(/\s+/g, '');
        return s.includes(compact) || s.includes(m[1]);
      });
      return shown ? null : { evidence: `报告出现「${m[1]}」，但工具输出（前 4000 字）里找不到`, confidence: 0.65 };
    },
  },
];

export function checkRules(reportText, pairs, extra = {}) {
  const ctx = { reportText, pairs, ...extra };
  const out = [];
  for (const r of RULES) {
    let v = null;
    try { v = r.check(ctx); } catch { v = null; }
    if (v)
      out.push({ rule: r.id, why: r.why, blindSpots: r.blindSpots || '', evidence: v.evidence, confidence: v.confidence });
  }
  return out;
}
