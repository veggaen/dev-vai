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
import { loadLoopConfig } from './loop-config.mjs';
import { buildAdoptionBoard, validateAdoptionBoard } from './adoption-control.mjs';
import platformValues from '../../packages/constants/src/platform-values.json' with { type: 'json' };

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
// Layered loop config (defaults ← VAI_LOOP_* env ← this process's flags). Echoed on /loop.json so
// the dashboard shows WHICH knobs are overridden and by what. Note: flags passed to the SUPERVISOR
// live in that process — env overrides show here, supervisor-only flags don't.
const { config: LOOP_CONFIG, sources: LOOP_CONFIG_SOURCES } = loadLoopConfig({ argv: args });
const PORT = LOOP_CONFIG.watchPort;
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

// (parseData/compactData were only used by the removed visualPanel — dropped as dead code, CodeRabbit #25.)

// NOTE: the server-rendered enginePanel() was removed — engine cycles + the quarantine block now
// render CLIENT-SIDE in render() from loop.json (loopEvents + banned), so the live dashboard updates
// without a reload and the panel is actually reachable (CodeRabbit #25).

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

// NOTE: the old server-rendered tastePanel()/visualPanel() were removed — they were defined but
// never reached from the redesigned shell (CodeRabbit #25). Visual taste now renders client-side in
// render() from loop.json's `taste`, and live visual telemetry shows via the live-frame image.

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
  // LIVE detection must see ENGINE-MODE activity. The engine path (--engine) logs to loop_events and
  // does NOT mark a runs.status='running' row, so reading runs.status alone showed "Idle" while the
  // loop was actively grounding fixes (cycle in progress). Treat the loop as live if EITHER a run is
  // marked running OR any loop_event was written in the last 3 minutes (a cycle can pause that long
  // mid-observe/propose between event writes). This is what makes the dashboard honest about engine mode.
  const lastEventAt = one("SELECT at FROM loop_events ORDER BY id DESC LIMIT 1")?.at;
  const eventAgeMs = lastEventAt ? (Date.now() - new Date(lastEventAt).getTime()) : Infinity;
  // 8-minute window: a single engine cycle can legitimately gap several minutes mid-observe/propose
  // (measured: cycles 240→241 were ~9 min apart while running a 48-prompt observe sweep). A tighter
  // window false-flags "Idle" during real work; 8 min flags genuinely-stopped without nagging.
  const engineLive = Number.isFinite(eventAgeMs) && eventAgeMs < 480_000;
  const running = run?.status === 'running' || engineLive;
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
  // What the loop has decided is the MOST MEANINGFUL lane to work on (vs just routing micro-bugs).
  const meaningRow = q("SELECT detail FROM loop_events WHERE kind='meaning' ORDER BY id DESC LIMIT 1")[0];
  let meaning = null; try { meaning = meaningRow ? JSON.parse(meaningRow.detail) : null; } catch {}

  // Pass-rate of the most recent meaningful run (≥8 prompts), and the weakest class right now.
  const trend = q(`SELECT r.id, COUNT(res.id) t, COALESCE(SUM(res.passed),0) p FROM runs r
    LEFT JOIN results res ON res.run_id=r.id GROUP BY r.id HAVING t>=8 ORDER BY r.id DESC LIMIT 1`)[0];
  const passPct = trend && trend.t ? Math.round((trend.p / trend.t) * 100) : null;
  const weakest = q(`SELECT class, COUNT(*) t, COALESCE(SUM(passed),0) p FROM results
    GROUP BY class HAVING t>=4 ORDER BY (1.0*p/t) ASC LIMIT 1`)[0];

  // QUALITY TREND — per-run average answer-quality, oldest→newest (the sparkline: is Vai's answering
  // getting better?). Only runs with real graded answers; a flat line is honest, not hidden.
  const qtrend = q(`SELECT r.id, AVG(res.answer_excellence) avg, COUNT(res.answer_excellence) n
    FROM runs r JOIN results res ON res.run_id=r.id
    WHERE res.answer_excellence IS NOT NULL GROUP BY r.id HAVING n>=1 ORDER BY r.id ASC`)
    .map((x) => ({ run: x.id, avg: Math.round(Number(x.avg) * 10) / 10 }));

  // MEANINGFUL EVENTS — the human story, newest first. Real outcomes only (fixes landed/reverted,
  // innovations built, blocked), NOT every cycle's plumbing. This replaces the meta-slop card-dump.
  const events = [];
  for (const r of q("SELECT class, applied, datetime(created_at) at FROM consensus WHERE applied IN ('committed','reverted-acceptance') ORDER BY id DESC LIMIT 10")) {
    events.push({
      at: r.at, kind: r.applied === 'committed' ? 'landed' : 'reverted',
      title: r.applied === 'committed' ? `Landed a fix for ${r.class}` : `Reverted a fix for ${r.class}`,
      detail: r.applied === 'committed' ? 'verified + behaviourally accepted' : (r.applied === 'reverted-acceptance' ? 'applied but did not actually fix the prompts — backed out' : 'failed typecheck — backed out'),
    });
  }
  for (const r of q("SELECT claim, last_seen FROM project_knowledge WHERE scope IN ('innovation:autonomous','feature:built') ORDER BY last_seen DESC LIMIT 5")) {
    events.push({ at: r.last_seen, kind: 'innovation', title: 'Built + proved a guard', detail: r.claim });
  }
  for (const r of q("SELECT claim, last_seen FROM project_knowledge WHERE scope='innovation:escalate' ORDER BY last_seen DESC LIMIT 5")) {
    events.push({ at: r.last_seen, kind: 'escalate', title: 'Escalated to you', detail: r.claim });
  }
  events.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  // Counts for the at-a-glance summary strip. "Caught wrong" = behavioural reverts (the safety net
  // working), NOT the 895 historical reverted-red from the now-fixed npx-verify bug — counting those
  // would misrepresent the loop as failing constantly when it was one infra bug, since fixed.
  const landed = q("SELECT COUNT(*) n FROM consensus WHERE applied='committed'")[0]?.n ?? 0;
  const reverted = q("SELECT COUNT(*) n FROM consensus WHERE applied='reverted-acceptance'")[0]?.n ?? 0;

  // ENGINE-MODE activity — the work the consensus table can't see. Without this the dashboard
  // reported "3 fixes / 5 reverted" and looked near-dead while the engine had run 1000+ cycles
  // (798 prototypes, 4000+ process runs). These make the perpetual loop's REAL throughput visible.
  const cyclesRun = q("SELECT COUNT(DISTINCT cycle) n FROM loop_events WHERE kind='cycle'")[0]?.n ?? 0;
  const prototypesBuilt = q("SELECT COUNT(*) n FROM loop_events WHERE kind='run:done' AND process='prototype' AND ok=1")[0]?.n ?? 0;
  const proposalsTotal = (() => { try { return q("SELECT COUNT(*) n FROM proposals")[0]?.n ?? 0; } catch { return 0; } })();
  const experimentsRun = (() => { try { return q("SELECT COUNT(*) n FROM experiments WHERE experiment_score IS NOT NULL")[0]?.n ?? 0; } catch { return 0; } })();
  const cyclesLastHour = q("SELECT COUNT(DISTINCT cycle) n FROM loop_events WHERE kind='cycle' AND at > ?", new Date(Date.now() - 3600_000).toISOString())[0]?.n ?? 0;

  // Add recent ENGINE cycles to the timeline so it shows live motion, not only consensus outcomes.
  // One concise entry per recent cycle: what it planned + ran (the human story of "it's working").
  for (const r of q(`SELECT cycle, MAX(at) at,
      SUM(CASE WHEN kind='run:done' AND ok=1 THEN 1 ELSE 0 END) ran,
      SUM(CASE WHEN kind='run:done' AND process='prototype' AND ok=1 THEN 1 ELSE 0 END) protos
    FROM loop_events WHERE kind IN ('cycle','run:done') GROUP BY cycle ORDER BY cycle DESC LIMIT 8`)) {
    if (!r.cycle) continue;
    events.push({
      at: r.at, kind: 'cycle',
      title: `Engine cycle ${r.cycle}`,
      detail: `${r.ran} process run(s)${r.protos ? `, ${r.protos} prototype(s) built+valued` : ''} — value-per-compute plan executed`,
    });
  }
  events.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  db.close();
  return {
    running,
    state: running ? 'running' : 'idle',
    lastCycleSeconds: lastDurS,
    lastCycleBounded: lastFinished?.status === 'budget-stopped',
    blocked: health?.state === 'blocked' || /runtime down/i.test(health?.reason ?? ''),
    innovations, escalations,
    meaning: meaning ? { lane: meaning.lane, reason: meaning.reason, ranking: meaning.ranking ?? [] } : null,
    health: health ? { working: health.working, reason: health.reason } : null,
    passPct,
    weakest: weakest ? { class: weakest.class, pct: Math.round((weakest.p / weakest.t) * 100), passed: weakest.p, total: weakest.t } : null,
    qualityTrend: qtrend.slice(-40),
    events: events.slice(0, 20),
    counts: {
      landed, reverted, innovations: innovations.length,
      cyclesRun, prototypesBuilt, proposalsTotal, experimentsRun, cyclesLastHour,
    },
  };
}

/** The plain-language HERO panel — answers "what is the loop doing?" with no machine-speak. */
/**
 * page — the human-facing dashboard. A calm, futuristic, THEMED, collapsible-timeline view that
 * replaces the old meta-slop card-dump. Design goals (V3gga): award-worthy, themeable, no pill/box
 * overuse, open clean timeline, smooth collapse transitions. All data comes from /loop.json; this
 * function returns a static shell that hydrates + auto-refreshes client-side.
 */
function page() {
  return `<!doctype html><html lang="en"><head><meta charset="utf8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vai · Perpetual Process</title>
<style>
:root{
  --bg:#08090e; --bg-2:#0c0e16; --panel:#0f1119; --panel-2:#13161f; --line:rgba(255,255,255,.07);
  --ink:#eef1f7; --ink-dim:#9aa1b2; --ink-faint:#5e6678;
  --accent:#6a9bff; --good:#4fd6a6; --warn:#f3c970; --bad:#ff708e; --idle:#4a5163;
  --r:18px; --r-sm:12px; --ease:cubic-bezier(.4,0,.2,1);
  --font:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,'SF Mono',Menlo,monospace;
}
/* THEMES — accent only; the surface stays calm + dark. */
html[data-theme="aurora"]{--accent:#67e8ff;--good:#5af2c0}
html[data-theme="ember"]{--accent:#ff9d5c;--good:#ffd27a;--bad:#ff6b6b}
html[data-theme="mono"]{--accent:#cdd2dc;--good:#cdd2dc;--warn:#cdd2dc}
html[data-theme="violet"]{--accent:#b18cff;--good:#7af2c0}
html[data-theme="paper"]{--bg:#f7f7f4;--bg-2:#f1f1ec;--panel:#fff;--panel-2:#fafafa;--ink:#15171d;--ink-dim:#5a6170;--ink-faint:#9098a6;--accent:#3b6fff;--good:#0f9d6b;--warn:#b8820a;--bad:#d6395c;--line:rgba(0,0,0,.08)}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--ink);font-family:var(--font);
  -webkit-font-smoothing:antialiased;line-height:1.55;letter-spacing:-.011em;min-height:100vh}
.wrap{max-width:760px;margin:0 auto;padding:40px 24px 140px}
/* ── header ── */
.top{display:flex;align-items:center;gap:13px;margin-bottom:34px}
.glyph{width:32px;height:32px;position:relative;flex:none}
.glyph::after{content:"";position:absolute;inset:0;border-radius:50%;border:1.5px solid var(--accent);opacity:.45;animation:breathe 3.6s var(--ease) infinite}
.glyph i{position:absolute;inset:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 18px var(--accent);animation:pulse 3.6s var(--ease) infinite}
@keyframes breathe{0%,100%{transform:scale(1);opacity:.4}50%{transform:scale(1.55);opacity:0}}
@keyframes pulse{0%,100%{opacity:.65}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
h1{font-size:17px;font-weight:600;margin:0;letter-spacing:-.02em}
.sub{color:var(--ink-faint);font-size:12.5px;margin:1px 0 0}
.spacer{flex:1}
.themes{display:flex;gap:8px;align-items:center}
.swatch{width:15px;height:15px;border-radius:50%;cursor:pointer;border:1.5px solid transparent;
  transition:transform .18s var(--ease),border-color .18s;outline:none}
.swatch:hover,.swatch:focus-visible{transform:scale(1.2)} .swatch.on{border-color:var(--ink)}
input[type=color]{width:18px;height:18px;padding:0;border:none;background:none;cursor:pointer;border-radius:50%;overflow:hidden}
/* ── HERO CARD: the one question — is it improving the app? ── */
.hero{background:linear-gradient(180deg,var(--panel-2),var(--panel));border:1px solid var(--line);
  border-radius:var(--r);padding:24px 26px;margin-bottom:14px}
.hero-top{display:flex;align-items:center;gap:11px;margin-bottom:18px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--idle);flex:none}
.dot.live{background:var(--good);box-shadow:0 0 0 0 var(--good);animation:ring 2s var(--ease) infinite}
.dot.blocked{background:var(--warn)}
@keyframes ring{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--good) 60%,transparent)}70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
.state{font-size:15px;font-weight:600;letter-spacing:-.01em}
.state-meta{color:var(--ink-faint);font-size:12px;margin-left:auto;font-variant-numeric:tabular-nums}
.verdict{font-size:18px;font-weight:600;letter-spacing:-.02em;line-height:1.35}
.verdict.good{color:var(--good)} .verdict.bad{color:var(--bad)} .verdict.warn{color:var(--warn)} .verdict.dim{color:var(--ink-dim)}
.meaning{font-size:13px;color:var(--ink-dim);margin-top:10px}
.meaning b{color:var(--accent);font-weight:600}
/* ── metric grid ── */
.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px}
.metric{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-sm);padding:15px 16px}
.metric b{display:block;font-size:24px;font-weight:600;letter-spacing:-.03em;font-variant-numeric:tabular-nums;font-family:var(--mono)}
.metric span{color:var(--ink-faint);font-size:11px;line-height:1.3;display:block;margin-top:3px}
.metric.hl{border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}
.metric.hl b{color:var(--accent)} .metric.good b{color:var(--good)} .metric.bad b{color:var(--bad)}
/* ── trend ── */
.trend{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-sm);padding:14px 16px 8px;margin-bottom:22px}
.trend svg{display:block;width:100%;height:70px;overflow:visible}
.trend .lbl{display:flex;justify-content:space-between;color:var(--ink-faint);font-size:10.5px;
  text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px;font-weight:500}
.trend .lbl b{color:var(--ink);font-family:var(--mono);font-variant-numeric:tabular-nums}
/* ── sections ── */
.sec{border:1px solid var(--line);border-radius:var(--r-sm);margin-bottom:10px;background:var(--panel);overflow:hidden}
.sec>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;
  padding:15px 18px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
  color:var(--ink-dim);transition:color .2s;user-select:none}
.sec>summary:hover{color:var(--ink)}
.sec>summary::-webkit-details-marker{display:none}
.sec .chev{width:13px;height:13px;transition:transform .35s var(--ease);color:var(--ink-faint);flex:none}
.sec[open] .chev{transform:rotate(90deg)}
.sec .count{margin-left:auto;color:var(--ink-faint);font-variant-numeric:tabular-nums;font-family:var(--mono);font-size:12px;letter-spacing:0}
.body{display:grid;grid-template-rows:0fr;transition:grid-template-rows .4s var(--ease),opacity .3s var(--ease);opacity:0}
.sec[open] .body{grid-template-rows:1fr;opacity:1}
.body>div{overflow:hidden;min-height:0}
.inner{padding:2px 18px 18px}
/* ── timeline ── */
.tl{position:relative;padding-left:22px}
.tl::before{content:"";position:absolute;left:4px;top:8px;bottom:8px;width:1px;background:var(--line)}
.ev{position:relative;padding:0 0 18px}
.ev:last-child{padding-bottom:2px}
.ev::before{content:"";position:absolute;left:-22px;top:4px;width:9px;height:9px;border-radius:50%;
  background:var(--panel);border:2px solid var(--idle)}
.ev.landed::before{border-color:var(--good);box-shadow:0 0 8px color-mix(in srgb,var(--good) 70%,transparent)}
.ev.reverted::before{border-color:var(--bad)}
.ev.innovation::before{border-color:var(--accent);box-shadow:0 0 8px color-mix(in srgb,var(--accent) 70%,transparent)}
.ev.escalate::before{border-color:var(--warn)}
.ev.cycle::before{border-color:var(--ink-faint);width:6px;height:6px;left:-20.5px;top:6px}
.ev.cycle .t{color:var(--ink-dim);font-weight:400}
.ev .t{font-size:13.5px;font-weight:500}
.ev .d{color:var(--ink-dim);font-size:12.5px;margin-top:2px}
.ev .when{color:var(--ink-faint);font-size:11px;margin-top:3px;font-variant-numeric:tabular-nums}
.row{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:none}
.row .k{color:var(--ink);font-size:13.5px}
.row .v{color:var(--ink-dim);font-size:12.5px;margin-left:auto;font-variant-numeric:tabular-nums;font-family:var(--mono)}
.bar{height:4px;border-radius:3px;background:var(--line);position:relative;flex:1;max-width:170px;margin:0 12px}
.bar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--accent);transition:width .6s var(--ease)}
.empty{color:var(--ink-faint);font-size:12.5px;padding:4px 0}
.fade{opacity:0;transform:translateY(5px);transition:opacity .45s var(--ease),transform .45s var(--ease)}
.fade.in{opacity:1;transform:none}
code{font-family:var(--mono);font-size:12px;color:var(--ink-dim);background:var(--panel-2);padding:1px 6px;border-radius:5px}
</style></head>
<body><div class="wrap">
  <div class="top">
    <div class="glyph"><i></i></div>
    <div><h1>Vai · Perpetual Process</h1><div class="sub" id="sub">connecting…</div></div>
    <div class="spacer"></div>
    <div class="themes" id="themes">
      <span class="swatch" data-th="default" style="background:#6a9bff" title="Default" tabindex="0"></span>
      <span class="swatch" data-th="aurora" style="background:#67e8ff" title="Aurora" tabindex="0"></span>
      <span class="swatch" data-th="violet" style="background:#b18cff" title="Violet" tabindex="0"></span>
      <span class="swatch" data-th="ember" style="background:#ff9d5c" title="Ember" tabindex="0"></span>
      <span class="swatch" data-th="mono" style="background:#cdd2dc" title="Mono" tabindex="0"></span>
      <span class="swatch" data-th="paper" style="background:#f0f0ec" title="Paper" tabindex="0"></span>
      <input type="color" id="custom" value="#6a9bff" title="Custom accent"/>
    </div>
  </div>

  <div class="hero">
    <div class="hero-top">
      <span class="dot" id="dot"></span>
      <span class="state" id="state">—</span>
      <span class="state-meta" id="meta"></span>
    </div>
    <div class="verdict dim" id="verdict">Reading the loop…</div>
    <div class="meaning" id="meaning"></div>
  </div>

  <div class="metrics" id="metrics"></div>

  <div class="trend" id="trendwrap" style="display:none">
    <div class="lbl"><span>Answer quality over time</span><b id="trendnow"></b></div>
    <svg id="spark" viewBox="0 0 600 70" preserveAspectRatio="none"></svg>
  </div>

  <details class="sec" id="sec-tl" open>
    <summary><svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4"/></svg>Timeline<span class="count" id="tl-count"></span></summary>
    <div class="body"><div><div class="inner"><div class="tl" id="tl"></div></div></div></div>
  </details>

  <details class="sec" id="sec-built">
    <summary><svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4"/></svg>Built itself · proven<span class="count" id="built-count"></span></summary>
    <div class="body"><div><div class="inner" id="built"></div></div></div>
  </details>

  <details class="sec" id="sec-classes">
    <summary><svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4"/></svg>Working on now<span class="count" id="cl-count"></span></summary>
    <div class="body"><div><div class="inner" id="classes"><div class="empty">loading…</div></div></div></div>
  </details>

  <details class="sec" id="sec-need">
    <summary><svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4"/></svg>Needs you<span class="count" id="need-count"></span></summary>
    <div class="body"><div><div class="inner" id="need"></div></div></div>
  </details>

  <details class="sec" id="sec-visual">
    <summary><svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4"/></svg>Visual taste<span class="count" id="taste-count"></span></summary>
    <div class="body"><div><div class="inner" id="taste"><div class="empty">no visual run yet</div></div></div></div>
  </details>

  <details class="sec" id="sec-council">
    <summary><svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4"/></svg>Council on your UI</summary>
    <div class="body"><div><div class="inner">${councilPanel()}</div></div></div>
  </details>

  <details class="sec" id="sec-engine">
    <summary><svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4"/></svg>Engine — live cycles<span class="count" id="eng-count"></span></summary>
    <div class="body"><div><div class="inner" id="engine"><div class="empty">no engine cycles yet</div></div></div></div>
  </details>

  <details class="sec" id="sec-live">
    <summary><svg class="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4"/></svg>Live view</summary>
    <div class="body"><div><div class="inner">${liveFramePanel()}</div></div></div>
  </details>

<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function ago(iso){if(!iso)return '';let s=Math.round((Date.now()-new Date(iso))/1000);
  if(s<0)s=0; if(s<60)return s+'s ago'; if(s<3600)return Math.round(s/60)+'m ago';
  if(s<86400)return Math.round(s/3600)+'h ago'; return Math.round(s/86400)+'d ago';}

// THEME persistence
function applyTheme(t,custom){
  if(t==='default') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme',t);
  if(custom) document.documentElement.style.setProperty('--accent',custom);
  document.querySelectorAll('.swatch').forEach(s=>s.classList.toggle('on',s.dataset.th===t));
  localStorage.setItem('vai-theme',t); if(custom) localStorage.setItem('vai-accent',custom);
}
document.querySelectorAll('.swatch').forEach(s=>s.onclick=()=>applyTheme(s.dataset.th,null));
$('custom').oninput=e=>{document.documentElement.style.setProperty('--accent',e.target.value);localStorage.setItem('vai-accent',e.target.value);};
applyTheme(localStorage.getItem('vai-theme')||'default',localStorage.getItem('vai-accent'));

// SPARKLINE
function spark(points){
  const wrap=$('trendwrap'); if(!points||points.length<2){wrap.style.display='none';return;}
  wrap.style.display='block';
  const W=600,H=70,pad=6,vals=points.map(p=>p.avg);
  const min=Math.min(...vals,0),max=Math.max(...vals,10);
  const x=i=>pad+(W-2*pad)*i/(points.length-1);
  const y=v=>H-pad-(H-2*pad)*(v-min)/((max-min)||1);
  let d='',area='';
  points.forEach((p,i)=>{const px=x(i),py=y(p.avg);d+=(i?'L':'M')+px+' '+py+' ';});
  area=d+'L'+x(points.length-1)+' '+H+' L'+x(0)+' '+H+' Z';
  const last=points[points.length-1];
  $('trendnow').textContent=last.avg.toFixed(1)+' / 10';
  $('spark').innerHTML=
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0" stop-color="var(--accent)" stop-opacity=".18"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>'
    +'<path d="'+area+'" fill="url(#g)"/>'
    +'<path d="'+d+'" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    +'<circle cx="'+x(points.length-1)+'" cy="'+y(last.avg)+'" r="3.5" fill="var(--accent)"/>';
}

function render(s){
  // status
  const blocked=s.blocked, running=s.running&&!blocked;
  $('dot').className='dot'+(running?' live':blocked?' blocked':'');
  $('state').textContent=blocked?'Waiting on Vai runtime':running?'Working':'Idle';
  $('sub').textContent='polishing the whole app — frontend, backend, structure & polish';
  const cyc=s.lastCycleSeconds!=null?('last cycle '+s.lastCycleSeconds+'s'+(s.lastCycleBounded?' · bounded':'')):'';
  $('meta').textContent=cyc;
  // verdict — the ONE answer: is the app actually getting better?
  const v=$('verdict');
  if(blocked){v.className='verdict warn';v.textContent='Runtime is down — start it and the process resumes automatically.';}
  else if(s.health){const w=s.health.working;
    v.className='verdict '+(w===true?'good':w===false?'bad':'dim');
    v.textContent=w===true?'Improving the codebase':w===false?'Running — not yet moving the needle':'Too early to tell';
  } else {v.className='verdict dim';v.textContent='Warming up…';}
  // meaning — what it has decided to work on
  if(s.meaning&&s.meaning.lane){
    const names={quality:'answer quality',capability:'new capabilities',routing:'routing correctness',reliability:'recurring weaknesses'};
    $('meaning').innerHTML='Focus → <b>'+esc(names[s.meaning.lane]||s.meaning.lane)+'</b> · '+esc(s.meaning.reason||'');
  } else if(s.passPct!=null){$('meaning').textContent='Routing accuracy '+s.passPct+'%';} else $('meaning').textContent='';
  // trend
  spark(s.qualityTrend);
  // metrics — co-residency fix means cycles should now climb steadily; landed is the real KPI
  const c=s.counts||{};
  $('metrics').innerHTML=
    '<div class="metric"><b>'+(c.cyclesRun||0)+'</b><span>engine cycles</span></div>'
    +'<div class="metric"><b>'+(c.prototypesBuilt||0)+'</b><span>fixes prototyped</span></div>'
    +'<div class="metric hl"><b>'+(c.landed||0)+'</b><span>landed &amp; verified</span></div>'
    +'<div class="metric bad"><b>'+(c.reverted||0)+'</b><span>caught wrong</span></div>';
  // timeline
  const evs=s.events||[]; $('tl-count').textContent=evs.length||'';
  $('tl').innerHTML=evs.length?evs.map(e=>
    '<div class="ev '+esc(e.kind)+' fade"><div class="t">'+esc(e.title)+'</div><div class="d">'+esc(e.detail||'').slice(0,140)+'</div><div class="when">'+esc(ago(e.at))+'</div></div>'
  ).join(''):'<div class="empty">No landed changes yet — it proves a fix against real prompts before keeping it.</div>';
  // built
  const inn=s.innovations||[]; $('built-count').textContent=inn.length||'';
  $('built').innerHTML=inn.length?inn.map(x=>
    '<div class="ev innovation fade" style="padding-bottom:16px"><div class="t">'+esc(x.what).slice(0,90)+'</div>'+(x.proof?'<div class="d">'+esc(x.proof).slice(0,150)+'</div>':'')+'<div class="when">'+esc(ago(x.at))+'</div></div>'
  ).join(''):'<div class="empty">Nothing yet.</div>';
  // needs you
  const es=s.escalations||[]; $('need-count').textContent=es.length||'';
  $('need').innerHTML=es.length?es.map(x=>
    '<div class="ev escalate fade"><div class="t">'+esc(x.what).slice(0,90)+'</div>'+(x.why?'<div class="d">'+esc(x.why).slice(0,150)+'</div>':'')+'<div class="when">'+esc(ago(x.at))+'</div></div>'
  ).join(''):'<div class="empty">Nothing needs you right now.</div>';
  // weakest class (single, in "where it's working")
  if(s.weakest){$('cl-count').textContent=s.weakest.pct+'%';
    $('classes').innerHTML='<div class="row"><span class="k"><code>'+esc(s.weakest.class)+'</code></span><span class="bar"><i style="width:'+s.weakest.pct+'%"></i></span><span class="v">'+s.weakest.pct+'% · '+s.weakest.passed+'/'+s.weakest.total+'</span></div><div class="empty" style="margin-top:8px">Weakest class the loop is currently working on.</div>';
  } else { // CLEAR the stale card when the payload no longer carries a weakest class (CodeRabbit #25)
    $('cl-count').textContent='';
    $('classes').innerHTML='<div class="empty">No weak class right now.</div>';
  }
  // visual taste (from loop.json) — previously gathered but never shown (CodeRabbit #25)
  const t=s.taste;
  if(t&&t.overall!=null){$('taste-count').textContent=t.overall+'/10';
    const sc=t.scores||{};
    const rows=Object.keys(sc).map(k=>'<div class="row"><span class="k">'+esc(k)+'</span><span class="bar"><i style="width:'+Math.round((Number(sc[k])||0)/10*100)+'%"></i></span><span class="v">'+esc(sc[k])+'/10</span></div>').join('');
    $('taste').innerHTML='<div class="row"><span class="k"><b>overall</b></span><span class="v"><b>'+esc(t.overall)+'/10</b></span></div>'+rows+(t.lesson?'<div class="empty" style="margin-top:8px">'+esc(t.lesson)+'</div>':'');
  } else { $('taste-count').textContent=''; $('taste').innerHTML='<div class="empty">no visual run yet</div>'; }
  // engine — live cycles (the --engine heartbeat, from loop.json) — previously gathered but the
  // redesigned shell never surfaced it (CodeRabbit #25).
  const ev=s.loopEvents||[];
  if(ev.length){
    const byCycle=new Map();
    for(const e of ev){ const c=e.cycle??'?'; if(!byCycle.has(c))byCycle.set(c,[]); byCycle.get(c).push(e); }
    const blocks=[...byCycle.entries()].slice(0,8).map(([cycle,evs])=>{
      const rows=evs.slice(0,12).map(e=>'<div class="row"><span class="k">'+esc(e.type||e.kind||'event')+'</span><span class="v">'+esc(String(e.detail??e.message??'').slice(0,90))+'</span></div>').join('');
      return '<div class="ev fade" style="padding-bottom:10px"><div class="t">cycle '+esc(cycle)+'</div>'+rows+'</div>';
    }).join('');
    const bn=s.banned||[];
    const banBlock=bn.length?'<div class="ev escalate fade" style="margin-top:8px"><div class="t">🚫 quarantined dead fixes (won\'t retry)</div>'+bn.map(b=>'<div class="d"><code>'+esc(String(b.file||"").split("/").pop())+'</code> '+esc(String(b.find).slice(0,32))+' → '+esc(String(b.replace).slice(0,32))+' ('+esc(b.strikes)+' strikes)</div>').join('')+'</div>':'';
    $('eng-count').textContent=byCycle.size;
    $('engine').innerHTML=(blocks||'')+banBlock||'<div class="empty">no engine cycles yet</div>';
  } else { $('eng-count').textContent=''; $('engine').innerHTML='<div class="empty">no engine cycles yet</div>'; }
  // reveal fades
  requestAnimationFrame(()=>document.querySelectorAll('.fade:not(.in)').forEach((el,i)=>setTimeout(()=>el.classList.add('in'),i*45)));
}

async function tick(){
  try{const s=await(await fetch('/loop.json',{cache:'no-store'})).json();render(s);}catch(e){}
  setTimeout(tick,4000);
}
tick();
</script>
</div></body></html>`;
}

/** Compact JSON for council/helper polling — no page reload, no screenshots. */
function visualJson() {
  const db = openDb(DB_PATH);
  const packet = buildVisualCouncilPacket(db);
  const live = readVisualLive(db);
  db.close();
  return { packet, live };
}

function adoptionJson() {
  const db = openDb(DB_PATH);
  try {
    return validateAdoptionBoard(buildAdoptionBoard(db));
  } finally {
    db.close();
  }
}

const CORS_ORIGINS = new Set([
  ...['localhost', '127.0.0.1'].flatMap((host) => [
    `http://${host}:${platformValues.ports.viteDev}`,
    `http://${host}:${platformValues.ports.viteDevAlternate}`,
    `http://${host}:${platformValues.ports.vitePreview}`,
  ]),
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]);
const jsonHeaders = (req) => {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  const origin = String(req.headers.origin ?? '');
  if (CORS_ORIGINS.has(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  return headers;
};

createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  // Lightweight machine-readable surfaces so a council member or helper can poll the
  // latest visual verdict without parsing HTML or reloading the dashboard.
  if (req.url === '/visual.json') {
    res.writeHead(200, jsonHeaders(req));
    res.end(JSON.stringify(visualJson()));
    return;
  }
  if (req.url === '/adoption.json') {
    try {
      res.writeHead(200, jsonHeaders(req));
      res.end(JSON.stringify(adoptionJson()));
    } catch (error) {
      res.writeHead(503, jsonHeaders(req));
      res.end(JSON.stringify({ error: String(error.message ?? error).slice(0, 160) }));
    }
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
    try {
      body = JSON.stringify({ ...loopStatus(), config: LOOP_CONFIG, configSources: LOOP_CONFIG_SOURCES });
    } catch (e) { body = JSON.stringify({ error: String(e).slice(0, 120) }); }
    res.writeHead(200, jsonHeaders(req));
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
      res.writeHead(200, jsonHeaders(req));
      res.end(JSON.stringify({ ageMs: Date.now() - s.mtimeMs, mtime: s.mtimeMs }));
    }).catch(() => { res.writeHead(200, jsonHeaders(req)); res.end(JSON.stringify({ ageMs: null })); });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page());
}).listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`\n  👁  Watch the loop live:  http://localhost:${PORT}\n  (reads ${DB_PATH}, auto-refreshes while running)\n\n`);
});
