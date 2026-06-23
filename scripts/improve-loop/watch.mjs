#!/usr/bin/env node
/**
 * watch — a live, browser-viewable window into the improvement loop.
 *
 * The TUI dashboard only works in a real terminal (it repaints by clearing the
 * screen). When the loop runs in the background you can't see it. This serves a
 * tiny self-refreshing HTML page that reads the SAME SQLite corpus the loop
 * writes — so you can open one URL and WATCH the council results land live.
 *
 * It is READ-ONLY on the corpus (and on Vai). No model calls. Safe to leave open.
 *
 * Usage:  node scripts/improve-loop/watch.mjs        → http://localhost:4123
 *         node scripts/improve-loop/watch.mjs --port 4200 --db path
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openDb, classStats, latestVisualEvents, latestVisualRun, readHeartbeat, readVisualLive, buildVisualCouncilPacket, topTasteLessons } from './db.mjs';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt('--port', '4123'));
const DB_PATH = opt('--db', 'scripts/improve-loop/.corpus.sqlite');
// The live-frame JPEG the probe overwrites while it drives the app — this is the shared
// "we both watch the same thing" surface.
const LIVE_FRAME = resolve(opt('--live-frame', 'Temporary_files/improve-loop-visual/live.jpg'));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function snapshot() {
  const db = openDb(DB_PATH);
  const visualRun = latestVisualRun(db);
  const visualLive = readVisualLive(db);
  const visualEvents = latestVisualEvents(db, 40);
  const taste = buildVisualCouncilPacket(db)?.taste ?? null;
  const tasteLessons = topTasteLessons(db, 5);
  const run = db.prepare('SELECT id,status,started_at FROM runs ORDER BY id DESC LIMIT 1').get();
  if (!run) {
    db.close();
    return { run: null, visualRun, visualLive, visualEvents, taste, tasteLessons };
  }
  const stats = classStats(db, run.id);
  const results = db.prepare(
    `SELECT p.prompt, p.class, r.read_as, r.outcome, r.agreement, r.passed, r.grade_reason, r.duration_ms, r.answer_excerpt
     FROM results r JOIN prompts p ON p.id=r.prompt_id WHERE r.run_id=? ORDER BY r.id DESC`,
  ).all(run.id);
  const fixes = db.prepare('SELECT class, failure_count, location, summary, status FROM fixes WHERE run_id=? ORDER BY failure_count DESC').all(run.id);
  const live = readHeartbeat(db);
  db.close();
  return { run, stats, results, fixes, live, visualRun, visualLive, visualEvents, taste, tasteLessons };
}

function parseData(data) {
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

function compactData(type, data) {
  if (type === 'check') return `${data.passed ? 'PASS' : 'FAIL'} ${data.name || ''}${data.detail ? ` - ${data.detail}` : ''}`;
  if (type === 'vision.snapshot') return `${data.name || 'snapshot'} ${data.path || ''}`;
  if (type === 'vision.target') return `${data.targetReceivesPointer ? 'target clear' : 'covered'} ${data.topLabel || ''}`;
  if (type === 'hand.pointer' || type === 'hand.click') return `x=${data.x} y=${data.y}`;
  if (type === 'hand.type') return `${data.chars ?? 0} chars`;
  if (type === 'request.blocked_external') return data.text || '';
  if (type === 'probe.done') return `${data.passed ? 'PASS' : 'FAIL'} ${data.reportPath || ''}`;
  return JSON.stringify(data).slice(0, 220);
}

function liveFramePanel() {
  // A near-real-time mirror of what the probe sees. The <img> reloads itself with a
  // cache-busting query; a freshness poll flips the badge to "live" vs "idle".
  return `<h2>Live view — what the probe sees (you + the council watch the same frame)</h2>
    <div style="background:#080a0e;border:1px solid #243045;border-radius:10px;padding:10px;margin:8px 0 16px">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px;font-size:12px;color:#9ab">
        <span id="lf-badge" style="display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 10px;background:#1a1f2b;color:#889">
          <span id="lf-dot" style="width:8px;height:8px;border-radius:50%;background:#667"></span><span id="lf-state">idle</span>
        </span>
        <span id="lf-age" style="color:#667"></span>
        <span style="margin-left:auto;color:#566">live-frame.jpg · near-real-time</span>
      </div>
      <img id="lf-img" alt="live view" style="display:block;width:100%;border-radius:6px;background:#0b0d12;min-height:120px"
        src="/live-frame.jpg" onerror="this.style.opacity=0.25" />
    </div>
    <script>(function(){
      var img=document.getElementById('lf-img'),badge=document.getElementById('lf-badge'),dot=document.getElementById('lf-dot'),st=document.getElementById('lf-state'),age=document.getElementById('lf-age');
      async function tick(){
        try{
          var m=await (await fetch('/live-frame.meta',{cache:'no-store'})).json();
          var fresh = m.ageMs!=null && m.ageMs < 2500;
          dot.style.background = fresh ? '#3c9' : '#667';
          st.textContent = fresh ? 'live' : (m.ageMs==null?'idle':'paused');
          age.textContent = m.ageMs!=null ? Math.round(m.ageMs/1000)+'s ago' : 'no frame yet';
          if(fresh){ img.style.opacity=1; img.src='/live-frame.jpg?t='+Date.now(); }
        }catch(e){}
        setTimeout(tick, 500);
      }
      tick();
    })();</script>`;
}

function tastePanel(taste, tasteLessons) {
  if (!taste) return '';
  const sc = taste.scores || {};
  const ha = taste.humanAppeal || {};
  const fc = taste.flawCounts || {};
  const chip = (label, val, max = 10) => {
    const frac = Math.max(0, Math.min(1, (Number(val) || 0) / max));
    const hue = Math.round(frac * 120);
    return `<span style="display:inline-flex;align-items:center;gap:6px;background:#10141c;border:1px solid #233;border-radius:6px;padding:4px 9px;font-size:12px;color:#cdd">
      ${esc(label)} <b style="color:hsl(${hue} 70% 60%)">${esc(val)}</b></span>`;
  };
  const flaws = (taste.topFlaws || []).map((f) => {
    const tone = f.severity === 'P0' ? '#f77' : f.severity === 'P1' ? '#fb8' : f.severity === 'P2' ? '#dd8' : '#9bd';
    return `<div style="font-size:12px;color:#bbc;margin:4px 0"><b style="color:${tone}">${esc(f.severity)}</b> ${esc(f.symptom)}${f.selector ? ` <code style="color:#789">${esc(f.selector)}</code>` : ''}<div style="color:#8a9;margin-left:2px">→ ${esc(f.fixDirection)}</div></div>`;
  }).join('');
  const lessons = (tasteLessons || []).map((l) => `<div style="font-size:12px;color:#ac9;margin:3px 0">×${l.times_seen} ${esc(l.lesson)}</div>`).join('');
  return `<h2>Visual taste (evidence-bound rubric)</h2>
    <div style="background:#0f131b;border:1px solid #243045;border-radius:8px;padding:13px 15px;margin:8px 0 14px">
      <div style="font-size:15px;font-weight:700;color:#dfe;margin-bottom:8px">${esc(taste.headline || '')}</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:9px">
        ${chip('composition', sc.composition)} ${chip('motion', sc.motion)} ${chip('feel', sc.interactionFeel)} ${chip('identity', sc.visualIdentity)} ${chip('emotion', sc.emotionalQuality)}
      </div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:9px;border-top:1px solid #1e2838;padding-top:9px">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#789;align-self:center">human appeal</span>
        ${chip('first', ha.firstImpression)} ${chip('modern', ha.modernPremium)} ${chip('interaction', ha.interaction)} ${chip('trust', ha.trustClarity)} ${chip('wow', ha.wow)} ${chip('keep-using', ha.keepUsing)}
      </div>
      ${ha.likeReason ? `<div style="font-size:12px;color:#9c9">+ ${esc(ha.likeReason)}</div>` : ''}
      ${ha.dislikeReason ? `<div style="font-size:12px;color:#d99">− ${esc(ha.dislikeReason)}</div>` : ''}
      ${flaws ? `<div style="border-top:1px solid #1e2838;margin-top:9px;padding-top:9px"><div style="font-size:11px;text-transform:uppercase;color:#789;margin-bottom:4px">top flaws (${fc.P0 || 0}×P0 ${fc.P1 || 0}×P1 ${fc.P2 || 0}×P2 ${fc.P3 || 0}×P3)</div>${flaws}</div>` : ''}
      ${taste.tasteLesson ? `<div style="border-top:1px solid #1e2838;margin-top:9px;padding-top:9px;font-size:13px;color:#ce9"><b>taste lesson:</b> ${esc(taste.tasteLesson)}</div>` : ''}
      ${lessons ? `<details data-k="taste-lessons" style="margin-top:8px"><summary style="cursor:pointer;color:#789;font-size:12px">accumulated taste lessons</summary>${lessons}</details>` : ''}
    </div>`;
}

function visualPanel(visualRun, visualLive, visualEvents) {
  if (!visualRun && !(visualEvents || []).length) return '';
  const state = visualRun
    ? `${esc(visualRun.status)}${visualRun.passed == null ? '' : ` / ${visualRun.passed ? 'pass' : 'fail'}`}`
    : 'none';
  const liveAge = visualLive?.updated_at ? Math.round((Date.now() - new Date(visualLive.updated_at).getTime()) / 1000) : null;
  const rows = (visualEvents || []).map((event) => {
    const data = parseData(event.data);
    const tone = event.type === 'probe.done'
      ? (data.passed ? '#8d9' : '#f99')
      : event.type?.startsWith('hand.')
        ? '#9bd'
        : event.type?.startsWith('vision.')
          ? '#dc9'
          : '#b9c';
    return `<div style="display:grid;grid-template-columns:74px 160px 1fr;gap:10px;align-items:start;background:#111723;border-left:3px solid ${tone};border-radius:6px;padding:8px 10px;margin:7px 0">
      <code style="color:#778">#${event.visual_run_id}.${event.seq}</code>
      <code style="color:${tone}">${esc(event.type)}</code>
      <div style="font-size:12px;color:#bbc">${esc(compactData(event.type, data))}</div>
    </div>`;
  }).join('') || '<div style="color:#666">no visual events yet</div>';

  return `<h2>Visual eyes/hands telemetry</h2>
    <div style="background:#10141c;border:1px solid #243045;border-radius:8px;padding:12px 14px;margin:8px 0 14px">
      <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:#9ab">
        <span><b style="color:#dce">latest:</b> #${visualRun?.id ?? '-'} ${state}</span>
        <span><b style="color:#dce">live:</b> ${visualLive ? `#${visualLive.visual_run_id}.${visualLive.seq} ${esc(visualLive.type)} (${liveAge}s ago)` : 'idle'}</span>
        ${visualRun?.report_path ? `<span><b style="color:#dce">report:</b> <code>${esc(visualRun.report_path)}</code></span>` : ''}
      </div>
    </div>${rows}`;
}

function page() {
  const { run, stats, results, fixes, live, visualRun, visualLive, visualEvents, taste, tasteLessons } = snapshot();
  if (!run) {
    const lf = liveFramePanel();
    const tp = tastePanel(taste, tasteLessons);
    const vp = visualPanel(visualRun, visualLive, visualEvents);
    return `<html><body style="background:#0b0b10;color:#ddd;font-family:system-ui;padding:40px;max-width:1000px">${lf}<div style="color:#778;font-size:12px;margin:6px 0">No text run yet. Start: <code>node scripts/improve-loop/run.mjs</code></div>${tp}${vp}</body></html>`;
  }

  const bar = (frac) => {
    const pct = Math.round(frac * 100);
    const hue = Math.round(frac * 120); // red→green
    return `<div style="background:#1c1c26;border-radius:6px;overflow:hidden;height:22px;position:relative">
      <div style="width:${pct}%;height:100%;background:hsl(${hue} 70% 45%);transition:width .4s"></div>
      <span style="position:absolute;inset:0;display:flex;align-items:center;padding:0 8px;font-size:12px;color:#fff;mix-blend-mode:difference">${pct}%</span></div>`;
  };

  const statRows = (stats || []).map((s) => `
    <div style="display:grid;grid-template-columns:260px 1fr 70px;gap:12px;align-items:center;margin:6px 0">
      <code style="color:#9ad">${esc(s.class)}</code>${bar(s.total ? s.passed / s.total : 0)}
      <span style="color:#888;font-size:12px">${s.passed}/${s.total}</span></div>`).join('');

  const resultRows = (results || []).map((r) => {
    const ok = r.passed;
    return `<div style="border-left:3px solid ${ok ? '#3a3' : '#c44'};background:#13131a;border-radius:6px;padding:10px 14px;margin:8px 0">
      <div style="font-weight:600;color:${ok ? '#9e9' : '#f99'}">${ok ? '✓' : '✗'} ${esc(r.prompt)}</div>
      <div style="font-size:12px;color:#aaa;margin-top:4px"><b>read as:</b> ${esc(r.read_as) || '<i>no council</i>'} · outcome=${esc(r.outcome)} · ${r.duration_ms || 0}ms</div>
      <div style="font-size:12px;color:#c9a;margin-top:2px">grade: ${esc(r.grade_reason)}</div>
      <details data-k="ex-${r.id ?? esc(r.prompt).slice(0,40)}" style="margin-top:6px"><summary style="cursor:pointer;color:#789;font-size:12px">answer excerpt</summary>
        <pre style="white-space:pre-wrap;font-size:12px;color:#bbb;margin:6px 0 0">${esc((r.answer_excerpt || '').slice(0, 500))}</pre></details></div>`;
  }).join('');

  const fixRows = (fixes || []).map((f) => `
    <div style="background:#1a1410;border:1px solid #3a2a18;border-radius:6px;padding:10px 14px;margin:8px 0">
      <div style="color:#fb8;font-weight:600">[${esc(f.class)}] ${f.failure_count} failures · ${esc(f.status)}</div>
      <div style="font-size:12px;color:#caa;margin-top:4px"><b>where:</b> ${esc(f.location)}</div>
      <div style="font-size:12px;color:#999;margin-top:2px">${esc(f.summary)}</div></div>`).join('') || '<div style="color:#666">none yet</div>';

  const running = run.status === 'running';
  // Live in-flight panel: show the current prompt, phase, elapsed, and qwen's
  // streaming partial output so there is no ~70s dead gap between results.
  const heartbeatFresh = live && (Date.now() - new Date(live.updated_at).getTime() < 15000);
  const livePanel = running && heartbeatFresh ? `
    <div style="background:#0e1622;border:1px solid #1f3550;border-radius:8px;padding:14px 16px;margin:14px 0">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#5b8;display:flex;align-items:center;gap:7px">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#5b8;animation:p 1s infinite"></span>
        IN FLIGHT · ${esc(live.phase) || 'thinking'} · ${Math.round((live.elapsed_ms || 0) / 1000)}s</div>
      <div style="font-weight:600;color:#cfe;margin-top:6px">${esc(live.prompt)}</div>
      <pre style="white-space:pre-wrap;font-size:12px;color:#9bd;margin:8px 0 0;max-height:160px;overflow:auto">${esc((live.partial || '').slice(-700)) || '…streaming…'}</pre>
    </div>` : '';
  // Refresh faster while a turn streams so the partial visibly grows.
  const refreshSec = running ? (heartbeatFresh ? 2 : 4) : 9999;
  return `<!doctype html><html><head><meta charset="utf8"><title>Vai Improve Loop</title>
  <style>body{background:#0b0b10;color:#e6e6ee;font-family:system-ui,-apple-system;margin:0;padding:28px 36px;max-width:1000px}
  h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#778;margin:26px 0 8px}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:${running ? '#3c3' : '#666'};margin-right:7px;${running ? 'animation:p 1.2s infinite' : ''}}
  @keyframes p{50%{opacity:.3}}</style></head><body>
  <h1><span class="dot"></span>Vai Improvement Loop — run #${run.id} <span style="color:#778;font-weight:400">(${esc(run.status)})</span></h1>
  <div style="color:#667;font-size:12px">${running ? `live · auto-refreshing every ${refreshSec}s` : 'finished'} · ${(results || []).length} scored</div>
  ${liveFramePanel()}
  <div id="app">
  ${livePanel}
  ${tastePanel(taste, tasteLessons)}
  ${visualPanel(visualRun, visualLive, visualEvents)}
  <h2>Pass-rate by class</h2>${statRows || '<div style="color:#666">warming up…</div>'}
  <h2>Queued fix candidates (you approve — never auto-applied)</h2>${fixRows}
  <h2>Results (newest first)</h2>${resultRows || '<div style="color:#666">no results yet…</div>'}
  </div>
  <script>
  // Soft refresh: re-fetch only #app and swap it, PRESERVING which <details> the user
  // opened (the old meta-refresh reloaded the whole page and slammed them shut every ${refreshSec}s).
  (function(){
    var ms=${running ? refreshSec * 1000 : 0};
    if(!ms) return;
    async function tick(){
      try{
        var open={}; document.querySelectorAll('details[open]').forEach(function(d){open[d.getAttribute('data-k')]=1;});
        var html=await (await fetch('/',{cache:'no-store'})).text();
        var doc=new DOMParser().parseFromString(html,'text/html');
        var fresh=doc.getElementById('app');
        if(fresh){ document.getElementById('app').replaceWith(fresh);
          document.querySelectorAll('details').forEach(function(d){ if(open[d.getAttribute('data-k')]) d.open=true; });
        }
      }catch(e){}
      setTimeout(tick,ms);
    }
    setTimeout(tick,ms);
  })();
  </script>
  </body></html>`;
}

/** Compact JSON for council/helper polling — no page reload, no screenshots. */
function visualJson() {
  const db = openDb(DB_PATH);
  const packet = buildVisualCouncilPacket(db);
  const live = readVisualLive(db);
  db.close();
  return { packet, live };
}

createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  // Lightweight machine-readable surfaces so a council member or helper can poll the
  // latest visual verdict without parsing HTML or reloading the dashboard.
  if (req.url === '/visual.json') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(visualJson()));
    return;
  }
  // Live frame: the JPEG the probe overwrites while driving the app. Served no-store so the
  // browser always pulls the freshest frame.
  if (req.url.startsWith('/live-frame.jpg')) {
    readFile(LIVE_FRAME).then((buf) => {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
      res.end(buf);
    }).catch(() => { res.writeHead(404); res.end(); });
    return;
  }
  if (req.url === '/live-frame.meta') {
    stat(LIVE_FRAME).then((s) => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ageMs: Date.now() - s.mtimeMs, mtime: s.mtimeMs }));
    }).catch(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ageMs: null })); });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page());
}).listen(PORT, () => {
  process.stdout.write(`\n  👁  Watch the loop live:  http://localhost:${PORT}\n  (reads ${DB_PATH}, auto-refreshes while running)\n\n`);
});
