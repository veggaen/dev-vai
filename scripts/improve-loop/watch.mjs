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
import { openDb, classStats, latestVisualEvents, latestVisualRun, readHeartbeat, readVisualLive, buildVisualCouncilPacket, topTasteLessons, recentLoopEvents, bannedFixes } from './db.mjs';

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
  const loopEvents = recentLoopEvents(db, 80);   // the --engine heartbeat
  const banned = bannedFixes(db, 12);            // quarantine ban list
  const run = db.prepare('SELECT id,status,started_at FROM runs ORDER BY id DESC LIMIT 1').get();
  if (!run) {
    db.close();
    return { run: null, visualRun, visualLive, visualEvents, taste, tasteLessons, loopEvents, banned };
  }
  const stats = classStats(db, run.id);
  const results = db.prepare(
    `SELECT p.prompt, p.class, r.read_as, r.outcome, r.agreement, r.passed, r.grade_reason, r.duration_ms, r.answer_excerpt
     FROM results r JOIN prompts p ON p.id=r.prompt_id WHERE r.run_id=? ORDER BY r.id DESC`,
  ).all(run.id);
  const fixes = db.prepare('SELECT class, failure_count, location, summary, status FROM fixes WHERE run_id=? ORDER BY failure_count DESC').all(run.id);
  const live = readHeartbeat(db);
  db.close();
  return { run, stats, results, fixes, live, visualRun, visualLive, visualEvents, taste, tasteLessons, loopEvents, banned };
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

function enginePanel(events, banned) {
  // The --engine heartbeat the UI used to miss: live cycles with their value-per-compute PLAN,
  // each process run/result, and the perpetual-health verdict — grouped newest cycle first. This
  // is what makes "what I see" == "what V3gga sees".
  if (!(events || []).length && !(banned || []).length) {
    return `<h2>Engine — live cycles</h2><div style="color:#667;font-size:12px;margin-bottom:14px">No engine cycles yet. Start with <code>supervisor.mjs --engine</code>.</div>`;
  }
  // Group events by cycle (events arrive newest-first; keep that order).
  const byCycle = new Map();
  for (const e of events) {
    if (!byCycle.has(e.cycle)) byCycle.set(e.cycle, []);
    byCycle.get(e.cycle).push(e);
  }
  const cycleBlocks = [...byCycle.entries()].slice(0, 8).map(([cycle, evs]) => {
    const health = evs.find((e) => e.kind === 'health');
    const plan = evs.find((e) => e.kind === 'plan');
    const runs = evs.filter((e) => e.kind === 'run:done' || e.kind === 'run:error');
    let hv = null;
    try { hv = health ? JSON.parse(health.detail) : null; } catch {}
    const working = hv?.working;
    const tone = working === true ? '#8d9' : working === false ? '#f99' : '#dc9';
    let chosen = [];
    try { const p = plan ? JSON.parse(plan.detail) : null; chosen = p?.chosen || []; } catch {}
    const runChips = runs.map((r) => {
      const ok = r.kind === 'run:done' && r.ok;
      let produced = 0; try { produced = JSON.parse(r.detail)?.produced ?? 0; } catch {}
      const c = r.kind === 'run:error' ? '#f99' : ok ? '#8d9' : '#bbb';
      return `<span style="display:inline-flex;gap:5px;align-items:center;background:#10141c;border:1px solid #233;border-radius:6px;padding:3px 8px;font-size:12px;color:${c}">${r.kind === 'run:error' ? '✗' : '✓'} ${esc(r.process)}${produced ? ` ·${produced}` : ''}${r.ms ? ` ${Math.round(r.ms)}ms` : ''}</span>`;
    }).join(' ');
    const at = (evs[0]?.at || '').slice(11, 19);
    return `<div style="background:#0e1018;border:1px solid #243045;border-left:3px solid ${tone};border-radius:8px;padding:11px 13px;margin:9px 0">
      <div style="display:flex;gap:10px;align-items:center;font-size:12px;color:#9ab">
        <b style="color:#cde">cycle ${esc(cycle)}</b>
        ${chosen.length ? `<span style="color:#8ad">plan: ${chosen.map(esc).join(', ')}</span>` : '<span style="color:#778">no move cleared the floor</span>'}
        <span style="margin-left:auto;color:#566">${esc(at)}</span>
      </div>
      ${runChips ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">${runChips}</div>` : ''}
      ${hv ? `<div style="margin-top:7px;font-size:12px;color:${tone}"><b>${working === true ? '✓ working' : working === false ? '✗ not working' : '… inconclusive'}</b> · quality ${esc(hv.composite ?? '?')} · ${esc(hv.reason || '')}</div>` : ''}
    </div>`;
  }).join('');

  const banBlock = (banned || []).length ? `
    <div style="background:#1a1410;border:1px solid #3a2a18;border-radius:8px;padding:11px 13px;margin:10px 0 16px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#b95;margin-bottom:6px">🚫 quarantined dead fixes (won't retry — breaks the doom-loop)</div>
      ${banned.map((b) => `<div style="font-size:12px;color:#caa;margin:3px 0"><code style="color:#e98">${esc((b.file || '').split('/').pop())}</code> · ${esc(b.find).slice(0, 38)} → ${esc(b.replace).slice(0, 38)} <span style="color:#866">(${b.strikes} strikes)</span></div>`).join('')}
    </div>` : '';

  return `<h2>Engine — live cycles (value-per-compute)</h2>
    <div id="engine">${cycleBlocks}${banBlock}</div>`;
}

function councilPanel() {
  // Self-refreshing panel that shows the COUNCIL's overnight work on Vai's UI (read from
  // /council.json). This is the real self-improvement — not the old text-seed table below.
  return `<h2 style="color:#dce">Council working on your UI (overnight)</h2>
    <div id="council-panel" style="margin:8px 0 18px"><div style="color:#667;font-size:12px">loading council findings…</div></div>
    <script>(function(){
      function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
      async function tick(){
        try{
          var arr=await (await fetch('/council.json',{cache:'no-store'})).json();
          var el=document.getElementById('council-panel'); if(!el) return;
          if(!arr.length){ el.innerHTML='<div style="color:#667;font-size:12px">No council findings yet — first cycle runs ~1–2 min.</div>'; }
          else el.innerHTML=arr.slice(0,12).map(function(f){
            var tone=f.taste>=8?'#8d9':f.taste>=6?'#dc9':'#f99';
            return '<div style="background:#10141c;border:1px solid #243045;border-left:3px solid '+tone+';border-radius:8px;padding:11px 13px;margin:9px 0">'
              +'<div style="display:flex;gap:10px;align-items:center;font-size:12px;color:#9ab"><b style="color:'+tone+'">taste '+esc(f.taste)+'/10</b>'
              +'<span>wow '+esc(f.wow)+'/10</span>'+(f.flaw?'<span style="color:#fb8">'+esc(f.flaw)+'</span>':'')
              +'<span style="margin-left:auto;color:#566">cycle '+esc(f.cycle)+' · '+esc((f.at||"").slice(11,16))+'</span></div>'
              +'<pre style="white-space:pre-wrap;font-size:12px;color:#bcd;margin:7px 0 0;max-height:240px;overflow:auto">'+esc(f.council)+'</pre></div>';
          }).join('');
        }catch(e){}
        setTimeout(tick,5000);
      } tick();
    })();</script>`;
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

/**
 * loopStatus — the PLAIN-LANGUAGE summary of what the loop is actually doing, for the hero panel.
 * Reads the real human-meaningful signals (not machine cycle-speak): is it running or idle, what
 * has it INNOVATED (autonomous guards it built+proved), what did it ESCALATE to V3gga (fundamental
 * gaps it won't build alone), what's the latest health verdict, and where the pass-rate sits.
 * This is the answer to "what is the loop doing?" a human can read at a glance. Never throws.
 */
function loopStatus() {
  const db = openDb(DB_PATH);
  const q = (s, ...a) => { try { return db.prepare(s).all(...a); } catch { return []; } };
  const one = (s, ...a) => { try { return db.prepare(s).get(...a); } catch { return null; } };

  const run = one('SELECT id,status,started_at,ended_at FROM runs ORDER BY id DESC LIMIT 1');
  const running = run?.status === 'running';
  // Bounded-cycle health: how long the last finished run took + whether it stopped on the budget.
  const lastFinished = one("SELECT status,started_at,ended_at FROM runs WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 1");
  const lastDurS = lastFinished?.ended_at ? Math.round((new Date(lastFinished.ended_at) - new Date(lastFinished.started_at)) / 1000) : null;

  // INNOVATIONS the loop built autonomously (from the knowledge spine this session wires).
  const innovations = q("SELECT claim, evidence, last_seen FROM project_knowledge WHERE scope IN ('innovation:autonomous','feature:built') ORDER BY last_seen DESC LIMIT 6")
    .map((r) => ({ what: r.claim, proof: r.evidence, at: r.last_seen }));
  // ESCALATIONS — fundamental gaps the loop found but won't build alone (it taps V3gga).
  const escalations = q("SELECT claim, evidence, last_seen FROM project_knowledge WHERE scope='innovation:escalate' ORDER BY last_seen DESC LIMIT 6")
    .map((r) => ({ what: r.claim, why: r.evidence, at: r.last_seen }));
  // Latest health verdict (working / not / inconclusive), in plain words.
  const healthRow = q("SELECT detail FROM loop_events WHERE kind='health' ORDER BY id DESC LIMIT 1")[0];
  let health = null; try { health = healthRow ? JSON.parse(healthRow.detail) : null; } catch {}

  // Pass-rate of the most recent meaningful run (≥8 prompts), and the weakest class right now.
  const trend = q(`SELECT r.id, COUNT(res.id) t, COALESCE(SUM(res.passed),0) p FROM runs r
    LEFT JOIN results res ON res.run_id=r.id GROUP BY r.id HAVING t>=8 ORDER BY r.id DESC LIMIT 1`)[0];
  const passPct = trend && trend.t ? Math.round((trend.p / trend.t) * 100) : null;
  const weakest = q(`SELECT class, COUNT(*) t, COALESCE(SUM(passed),0) p FROM results
    GROUP BY class HAVING t>=4 ORDER BY (1.0*p/t) ASC LIMIT 1`)[0];

  db.close();
  return {
    running,
    state: running ? 'running' : 'idle',
    lastCycleSeconds: lastDurS,
    lastCycleBounded: lastFinished?.status === 'budget-stopped',
    innovations, escalations,
    health: health ? { working: health.working, reason: health.reason } : null,
    passPct,
    weakest: weakest ? { class: weakest.class, pct: Math.round((weakest.p / weakest.t) * 100), passed: weakest.p, total: weakest.t } : null,
  };
}

/** The plain-language HERO panel — answers "what is the loop doing?" with no machine-speak. */
function loopHeroPanel() {
  return `<div id="loop-hero" style="margin:6px 0 22px"><div style="color:#667;font-size:12px">loading…</div></div>
  <script>(function(){
    function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
    function timeAgo(iso){ if(!iso) return ''; var s=Math.round((Date.now()-new Date(iso))/1000); if(s<60)return s+'s ago'; if(s<3600)return Math.round(s/60)+'m ago'; if(s<86400)return Math.round(s/3600)+'h ago'; return Math.round(s/86400)+'d ago'; }
    function card(bg,bd,inner){ return '<div style="background:'+bg+';border:1px solid '+bd+';border-radius:10px;padding:14px 16px;margin:10px 0">'+inner+'</div>'; }
    async function tick(){
      try{
        var s=await (await fetch('/loop.json',{cache:'no-store'})).json();
        var el=document.getElementById('loop-hero'); if(!el) return;
        var html='';
        // STATUS line
        var dot = s.running ? '#3c9' : '#667';
        var cyc = s.lastCycleSeconds!=null ? (' · last cycle '+s.lastCycleSeconds+'s'+(s.lastCycleBounded?' (bounded ✓)':'')) : '';
        html += '<div style="display:flex;align-items:center;gap:9px;font-size:14px;color:#cde;margin-bottom:4px">'
          +'<span style="width:9px;height:9px;border-radius:50%;background:'+dot+';'+(s.running?'animation:p 1.2s infinite':'')+'"></span>'
          +'<b>'+(s.running?'The loop is running':'The loop is idle')+'</b>'
          +'<span style="color:#667;font-size:12px">'+esc(cyc)+'</span></div>';
        // HEALTH in plain words
        if(s.health){
          var w=s.health.working; var tone=w===true?'#8d9':w===false?'#f99':'#dc9';
          var label=w===true?'It is improving the codebase':w===false?'It is running but not yet improving anything':'Too early to tell if it is improving';
          html += '<div style="font-size:13px;color:'+tone+';margin-bottom:10px">'+esc(label)+(s.passPct!=null?' · pass-rate '+s.passPct+'%':'')+'</div>';
        }
        // INNOVATIONS it built itself
        var innerI = (s.innovations&&s.innovations.length)
          ? s.innovations.map(function(x){ return '<div style="margin:7px 0"><div style="color:#9e9;font-size:13px">✅ '+esc(x.what)+'</div>'+(x.proof?'<div style="color:#789;font-size:11px;margin-top:2px">'+esc(x.proof).slice(0,160)+'</div>':'')+'<div style="color:#566;font-size:11px">'+esc(timeAgo(x.at))+'</div></div>'; }).join('')
          : '<div style="color:#667;font-size:12px">Nothing built yet — it builds a fix only when it can prove the fix works on its own data.</div>';
        html += card('#0d1510','#1f3a26','<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6a8;margin-bottom:4px">What it built itself (proven)</div>'+innerI);
        // ESCALATIONS for V3gga
        if(s.escalations&&s.escalations.length){
          var innerE = s.escalations.map(function(x){ return '<div style="margin:7px 0"><div style="color:#fb8;font-size:13px">🚩 '+esc(x.what)+'</div>'+(x.why?'<div style="color:#987;font-size:11px;margin-top:2px">'+esc(x.why).slice(0,160)+'</div>':'')+'<div style="color:#766;font-size:11px">'+esc(timeAgo(x.at))+'</div></div>'; }).join('');
          html += card('#15110b','#3a2a14','<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#b95;margin-bottom:4px">🚩 Needs you — fundamental, the loop won\\'t build it alone</div>'+innerE);
        }
        // WEAKEST class it's working on
        if(s.weakest){
          html += '<div style="font-size:12px;color:#9ab;margin-top:8px">Currently weakest: <code style="color:#9ad">'+esc(s.weakest.class)+'</code> at '+s.weakest.pct+'% ('+s.weakest.passed+'/'+s.weakest.total+')</div>';
        }
        el.innerHTML=html;
      }catch(e){}
      setTimeout(tick,4000);
    } tick();
  })();</script>`;
}

function page() {
  const { run, stats, results, fixes, live, visualRun, visualLive, visualEvents, taste, tasteLessons, loopEvents, banned } = snapshot();
  if (!run) {
    const lf = liveFramePanel();
    const tp = tastePanel(taste, tasteLessons);
    const vp = visualPanel(visualRun, visualLive, visualEvents);
    return `<html><head><style>@keyframes p{50%{opacity:.3}}</style></head><body style="background:#0b0b10;color:#ddd;font-family:system-ui;padding:40px;max-width:1000px"><h1 style="font-size:18px;margin:0 0 4px">Vai Improvement Loop</h1><div style="color:#667;font-size:12px;margin-bottom:8px">a self-improving loop that finds its own gaps, builds + proves fixes, and escalates the big calls to you</div>${loopHeroPanel()}<details style="margin-top:14px"><summary style="cursor:pointer;color:#566;font-size:12px">⤵ engine internals</summary>${enginePanel(loopEvents, banned)}</details>${councilPanel()}${lf}${tp}${vp}</body></html>`;
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
  <h1><span class="dot"></span>Vai Improvement Loop</h1>
  <div style="color:#667;font-size:12px">${running ? `live · auto-refreshing` : 'idle'} · a self-improving loop that finds its own gaps, builds + proves fixes, and escalates the big calls to you</div>
  ${loopHeroPanel()}
  <details style="margin-top:14px"><summary style="cursor:pointer;color:#566;font-size:12px">⤵ engine internals (cycle-by-cycle machine trace)</summary>
  <div id="app-engine">${enginePanel(loopEvents, banned)}</div></details>
  <details style="margin-top:8px"><summary style="cursor:pointer;color:#566;font-size:12px">⤵ council UI audit (overnight visual work)</summary>
  ${councilPanel()}
  ${liveFramePanel()}</details>
  <details style="margin-top:18px"><summary style="cursor:pointer;color:#566;font-size:12px">⤵ old text-seed lane (run #${run.id}, not the UI work)</summary>
  <div id="app">
  ${livePanel}
  ${tastePanel(taste, tasteLessons)}
  ${visualPanel(visualRun, visualLive, visualEvents)}
  <h2>Pass-rate by class</h2>${statRows || '<div style="color:#666">warming up…</div>'}
  <h2>Queued fix candidates (you approve — never auto-applied)</h2>${fixRows}
  <h2>Results (newest first)</h2>${resultRows || '<div style="color:#666">no results yet…</div>'}
  </div></details>
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
        // Also refresh the live ENGINE panel (it lives outside #app, at the top).
        var freshEng=doc.getElementById('app-engine');
        if(freshEng){ var cur=document.getElementById('app-engine'); if(cur) cur.replaceWith(freshEng); }
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
  // The plain-language loop summary the hero panel polls — "what is the loop doing?" as data.
  if (req.url === '/loop.json') {
    let body = '{}';
    try { body = JSON.stringify(loopStatus()); } catch (e) { body = JSON.stringify({ error: String(e).slice(0, 120) }); }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  if (req.url === '/council.json') {
    readFile(resolve('Temporary_files/council-findings.json'))
      .then((b) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(b); })
      .catch(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]'); });
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
