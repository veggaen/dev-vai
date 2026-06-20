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
import { openDb, classStats, readHeartbeat } from './db.mjs';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt('--port', '4123'));
const DB_PATH = opt('--db', 'scripts/improve-loop/.corpus.sqlite');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function snapshot() {
  const db = openDb(DB_PATH);
  const run = db.prepare('SELECT id,status,started_at FROM runs ORDER BY id DESC LIMIT 1').get();
  if (!run) return { run: null };
  const stats = classStats(db, run.id);
  const results = db.prepare(
    `SELECT p.prompt, p.class, r.read_as, r.outcome, r.agreement, r.passed, r.grade_reason, r.duration_ms, r.answer_excerpt
     FROM results r JOIN prompts p ON p.id=r.prompt_id WHERE r.run_id=? ORDER BY r.id DESC`,
  ).all(run.id);
  const fixes = db.prepare('SELECT class, failure_count, location, summary, status FROM fixes WHERE run_id=? ORDER BY failure_count DESC').all(run.id);
  const live = readHeartbeat(db);
  db.close();
  return { run, stats, results, fixes, live };
}

function page() {
  const { run, stats, results, fixes, live } = snapshot();
  if (!run) return `<html><body style="background:#0b0b10;color:#ddd;font-family:system-ui;padding:40px">No run yet. Start: <code>node scripts/improve-loop/run.mjs</code></body></html>`;

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
      <details style="margin-top:6px"><summary style="cursor:pointer;color:#789;font-size:12px">answer excerpt</summary>
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
  ${running ? `<meta http-equiv="refresh" content="${refreshSec}">` : ''}
  <style>body{background:#0b0b10;color:#e6e6ee;font-family:system-ui,-apple-system;margin:0;padding:28px 36px;max-width:1000px}
  h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#778;margin:26px 0 8px}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:${running ? '#3c3' : '#666'};margin-right:7px;${running ? 'animation:p 1.2s infinite' : ''}}
  @keyframes p{50%{opacity:.3}}</style></head><body>
  <h1><span class="dot"></span>Vai Improvement Loop — run #${run.id} <span style="color:#778;font-weight:400">(${esc(run.status)})</span></h1>
  <div style="color:#667;font-size:12px">${running ? `live · auto-refreshing every ${refreshSec}s` : 'finished'} · ${(results || []).length} scored</div>
  ${livePanel}
  <h2>Pass-rate by class</h2>${statRows || '<div style="color:#666">warming up…</div>'}
  <h2>Queued fix candidates (you approve — never auto-applied)</h2>${fixRows}
  <h2>Results (newest first)</h2>${resultRows || '<div style="color:#666">no results yet…</div>'}
  </body></html>`;
}

createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page());
}).listen(PORT, () => {
  process.stdout.write(`\n  👁  Watch the loop live:  http://localhost:${PORT}\n  (reads ${DB_PATH}, auto-refreshes while running)\n\n`);
});
