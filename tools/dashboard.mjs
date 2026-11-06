// dashboard.mjs —— 本地看板：一眼看到"它在不在干活"
//
// 抄的是 Gatehouse 的工程化部分（实时决策流 / 待审面板 / 审计链校验），
// 但只读、零依赖、关闭即消失。
//
// 用法：node tools/dashboard.mjs [--port=8585]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

const HOME = process.env.USERPROFILE || '';
const DIR = path.join(HOME, '.dsh', 'dsh-claim-verify');

const argOf = (n, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + n + '='));
  return a ? a.split('=')[1] : d;
};
const PORT = Number(argOf('port', 8585));

function readJsonl(file, limit = 200) {
  const p = path.join(DIR, file);
  if (!fs.existsSync(p))
    return [];
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  const out = [];
  for (let i = Math.max(0, lines.length - limit); i < lines.length; i++) {
    try { out.push(JSON.parse(lines[i])); }
    catch { /* 坏行跳过 */ }
  }
  return out.reverse(); // 最新在前
}

// 哪些 PID 还活着（缓存 10 秒，避免每 2 秒扫一次进程表）
let pidCache = { at: 0, alive: new Set() };
function pidAlive(pid) {
  const now = Date.now();
  if (now - pidCache.at > 10000) {
    pidCache = { at: now, alive: new Set() };
    try {
      const out = String(spawnSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8', timeout: 4000 }).stdout || '');
      for (const line of out.split('\n')) {
        const m = line.match(/,"(\d+)",/);
        if (m)
          pidCache.alive.add(Number(m[1]));
      }
    }
    catch { /* 拿不到就当都活着 */ }
  }
  return pidCache.alive.size === 0 ? true : pidCache.alive.has(Number(pid));
}

function state() {
  const events = readJsonl('blackbox/events.jsonl', 120);
  const tier = readJsonl('tier.jsonl', 50);
  const queue = readJsonl('review-queue.jsonl', 50);
  const verify = events.filter((e) => e.type === 'verify');
  const loaded = readJsonl('loads.jsonl', 200);
  const liveHost = loaded.find((x) => pidAlive(x.pid)) || null;

  const lastEvtAt = events[0] && events[0].at;
  const ageMs = lastEvtAt ? Date.now() - new Date(lastEvtAt).getTime() : null;

  return {
    now: Date.now(),
    host: liveHost
      ? { pid: liveHost.pid, version: liveHost.version, buildId: liveHost.buildId, at: liveHost.at, alive: true }
      : (loaded[0] ? { ...loaded[0], alive: false } : null),
    alive: {
      lastEventAt: lastEvtAt,
      lastEventAgeSec: ageMs === null ? null : Math.round(ageMs / 1000),
      blackboxCount: events.length,
    },
    counts: {
      events: events.length,
      verify: verify.length,
      verifyBad: verify.filter((e) => e.payload && e.payload.verdict === 'INVALID').length,
      tier3: tier.length,
      queued: queue.length,
    },
    latestEvents: events.slice(0, 25).map((e) => ({
      at: e.at, type: e.type,
      brief: e.payload ? JSON.stringify(e.payload).slice(0, 160) : '',
    })),
    tier3: tier.slice(0, 10).map((r) => ({ at: r.at, tool: r.tool, kind: r.kind, reason: r.reason })),
    queue: queue.slice(0, 10).map((r) => ({ at: r.at, tool: r.tool, kind: r.kind })),
  };
}

const PAGE = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>claim-verify 看板</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font:13px/1.5 ui-monospace,Consolas,monospace; background:#0f1115; color:#d7dae0; }
  header { padding:12px 16px; border-bottom:1px solid #23262d; display:flex; gap:24px; align-items:baseline; flex-wrap:wrap; }
  h1 { font-size:14px; margin:0; color:#9ecbff; font-weight:600; }
  .k { color:#6b7280; }
  .v { color:#e5e7eb; }
  .grid { display:grid; grid-template-columns: 1fr 340px; gap:0; }
  section { padding:12px 16px; border-bottom:1px solid #1b1e24; }
  h2 { font-size:12px; margin:0 0 8px; color:#9ca3af; text-transform:uppercase; letter-spacing:.06em; }
  .row { padding:2px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .t { color:#4b5563; }
  .bad { color:#f87171; }
  .ok { color:#34d399; }
  .warn { color:#fbbf24; }
  .pill { display:inline-block; padding:0 6px; border-radius:3px; background:#1f242d; margin-right:6px; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
</style></head><body>
<header>
  <h1>claim-verify 看板</h1>
  <span><span class="k">宿主</span> <span id="host" class="v">—</span></span>
  <span><span class="k">最近事件</span> <span id="age" class="v">—</span></span>
  <span><span class="k">事件/核验/失败</span> <span id="counts" class="v">—</span></span>
</header>
<div class="grid">
  <div>
    <section><h2>事件流（最新在前）</h2><div id="events"></div></section>
  </div>
  <div>
    <section><h2>T3 · 已拦下</h2><div id="tier3"></div></section>
    <section><h2>T2 · 待审</h2><div id="queue"></div></section>
    <section><h2>说明</h2>
      <div class="row"><span class="k">数据源</span> ~/.dsh/dsh-claim-verify/*.jsonl</div>
      <div class="row"><span class="k">只读</span> 不写任何文件</div>
      <div class="row"><span class="k">刷新</span> 每 2 秒</div>
    </section>
  </div>
</div>
<script>
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function tick() {
  try {
    const s = await (await fetch('/api/state')).json();
    const alive = s.alive.lastEventAgeSec;
    const dot = alive === null ? 'warn' : alive < 300 ? 'ok' : 'warn';
    document.getElementById('host').textContent =
      s.host ? (s.host.version + ' · ' + s.host.buildId.slice(0, 12) + ' · pid ' + s.host.pid) : '未记录';
    document.getElementById('age').innerHTML =
      '<span class="dot" style="background:' + (dot === 'ok' ? '#34d399' : '#fbbf24') + '"></span>' +
      (alive === null ? '无事件' : alive + ' 秒前');
    document.getElementById('counts').textContent =
      s.counts.events + ' / ' + s.counts.verify + ' / ' + s.counts.verifyBad;
    document.getElementById('events').innerHTML = s.latestEvents.map((e) =>
      '<div class="row"><span class="t">' + esc(e.at.slice(11, 19)) + '</span> ' +
      '<span class="pill">' + esc(e.type) + '</span>' + esc(e.brief) + '</div>').join('') || '<div class="row k">（没有事件）</div>';
    document.getElementById('tier3').innerHTML = s.tier3.map((r) =>
      '<div class="row"><span class="t">' + esc(String(r.at).slice(11, 19)) + '</span> <span class="bad">' + esc(r.kind) + '</span> ' + esc(r.tool) + '</div>').join('') || '<div class="row k">（没有）</div>';
    document.getElementById('queue').innerHTML = s.queue.map((r) =>
      '<div class="row"><span class="t">' + esc(String(r.at).slice(11, 19)) + '</span> ' + esc(r.kind) + ' ' + esc(r.tool) + '</div>').join('') || '<div class="row k">（没有）</div>';
  } catch (e) {
    document.getElementById('age').textContent = '连接失败';
  }
}
tick(); setInterval(tick, 2000);
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/state')) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(state()));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(PAGE);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('看板已启动： http://127.0.0.1:' + PORT + '/');
  console.log('数据源：' + DIR);
  console.log('只读；Ctrl+C 结束。');
});
