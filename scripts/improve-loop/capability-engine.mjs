/**
 * capability-engine — the generative twin of the innovation engine.
 *
 * innovation-engine.mjs proposes EXPERIMENTS (model/prompt/grader tweaks) when the
 * loop stalls. This engine proposes FEATURE-LEVEL UPGRADES (voice, vision, tool-use,
 * council process, delegation) toward the locked north-star — the real answer to
 * "make Vai more capable". Each capability lens (capability-lenses.mjs) investigates
 * the REAL codebase through the grounded tool loop (tools.mjs), then emits ONE
 * proposal. The council-rubric scores each proposal and the whole roundtable; the
 * best, deduped against what's already in flight, are appended to the backlog.
 *
 * PROPOSE-ONLY, like the rest of the loop: it writes to the corpus DB + the backlog
 * markdown. It NEVER edits Vai source. Humans (V3gga/Opus) approve and implement.
 */
import { ollamaGenerate, waitForVramHeadroom } from './driver.mjs';
import { TOOL_SPEC, runTool } from './tools.mjs';
import { selectLenses, lensPreamble } from './capability-lenses.mjs';
import { assembleContext, PERPETUAL_GOAL } from './capability-context.mjs';
import { scoreCapabilityProposal, scoreCouncilProcess } from './council-rubric.mjs';
import { QUALITY_BAR } from './compute-roi.mjs';
import { deriveGenerationPolicy } from './adoption-control.mjs';

const MODEL = process.env.IMPROVE_GEN_MODEL ?? process.env.LOCAL_MODEL ?? 'qwen3:8b';

/** The terminal tool the council emits to end its investigation: a feature proposal. */
export const PROPOSAL_SPEC = `When you have read enough real code, emit ONE final proposal as strict JSON:
  {"tool":"propose","area":"<voice|vision|tooling|council|reliability|delegation|capability-gap|research|brainstorm|design|brand|growth|external-pull>",
   "title":"<short upgrade name>","capability":"<one sentence: the new thing Vai could DO>",
   "evidence":["<file.ts:line you actually read>", "..."],
   "steps":["<ordered build step>", "..."],
   "firstSlice":"<the smallest first slice to ship>","verify":"<how to confirm it works>",
   "buildsOn":"<optional: the title/area of an earlier proposal this extends, else omit>",
   "why":"<one sentence tying it to the north-star>"}`;

/** Pull the first JSON object out of a model reply (same tolerant parse as agent.mjs). */
export function parseProposal(raw) {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** Coerce a raw model proposal into the canonical shape, defaulting area from the lens. */
export function normalizeProposal(p, lens = {}) {
  if (!p || typeof p !== 'object') return null;
  const arr = (x) => (Array.isArray(x) ? x.filter(Boolean).map((s) => String(s)) : x ? [String(x)] : []);
  const title = String(p.title ?? '').trim();
  const capability = String(p.capability ?? '').trim();
  if (!title || !capability) return null;
  return {
    area: String(p.area ?? lens.area ?? 'capability-gap').trim(),
    title, capability,
    evidence: arr(p.evidence), steps: arr(p.steps),
    firstSlice: p.firstSlice ? String(p.firstSlice).trim() : '',
    verify: p.verify ? String(p.verify).trim() : '',
    buildsOn: p.buildsOn ? String(p.buildsOn).trim() : '',
    why: p.why ? String(p.why).trim() : '',
    lens: lens.id ?? null,
  };
}

/** Near-duplicate key: area + the first few significant title words, lowercased. */
function dedupeKey(area, title) {
  const words = String(title).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
  return `${String(area).toLowerCase()}::${words.join(' ')}`;
}

/** Drop proposals that duplicate each other, an already-open backlog item, or a
 *  previously-recorded capability. Backlog/prior are arrays of {area?,title} or strings. */
export function dedupeProposals(proposals = [], { backlog = [], prior = [] } = {}) {
  const seen = new Set();
  const asKey = (x) => (typeof x === 'string' ? dedupeKey('', x) : dedupeKey(x.area ?? '', x.title ?? ''));
  // Backlog headlines have no area; index them by title-words alone for a loose match.
  const titleWords = (t) => String(t).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 3).slice(0, 3).join(' ');
  const flightWords = new Set([...backlog, ...prior].map((x) => titleWords(typeof x === 'string' ? x : x.title ?? '')).filter(Boolean));
  const out = [];
  for (const p of proposals) {
    if (!p) continue;
    const key = asKey(p);
    if (seen.has(key)) continue;
    if (flightWords.has(titleWords(p.title))) continue;
    seen.add(key); out.push(p);
  }
  return out;
}

/** Attach rubric scores and sort best-first (highest impact). Stable for ties. */
export function rankProposals(proposals = []) {
  return proposals
    .map((p) => ({ ...p, score: scoreCapabilityProposal(p) }))
    .sort((a, b) => b.score.impact - a.score.impact);
}

/** The chair's contract: converge the round, or honestly say none converge. */
export const SYNTHESIS_SPEC = `You are the council CHAIR. Read the proposals below and find the
single highest-leverage CONVERGENCE — 2-3 proposals that together form one coherent direction
toward the north-star. Emit strict JSON:
  {"title":"<short name for the combined direction>",
   "capability":"<one sentence: what Vai could DO if these are built TOGETHER>",
   "buildsOn":["<exact title of a proposal you are combining>", "..."],
   "firstSlice":"<the smallest first slice of the COMBINED direction>",
   "why":"<one sentence tying it to the north-star>"}
Only combine proposals that GENUINELY reinforce each other. If none truly converge, reply {"none":true}.`;

const titleWordSet = (s) => new Set(String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
const sameTitle = (a, b) => { const A = titleWordSet(a); return [...titleWordSet(b)].some((w) => A.has(w)); };

/**
 * The CHAIR step — the real council mechanism. After the lenses propose in isolation, one
 * more pass reads them all and converges the 2-3 that genuinely reinforce each other into a
 * single grounded, linked direction (its `buildsOn` names the real siblings, and its evidence
 * is the union of theirs, so it stays grounded). Returns the synthesized proposal, or null
 * when nothing truly converges (honest — convergence then stays low rather than faked).
 * `generate` is injectable so this unit-tests without a model.
 */
export async function synthesizeRound({ proposals = [], goal = PERPETUAL_GOAL, generate } = {}) {
  const usable = proposals.filter((p) => p && p.title && p.capability);
  if (usable.length < 2 || typeof generate !== 'function') return null;
  const list = usable
    .map((p, i) => `${i + 1}. [${p.area}] ${p.title} — ${p.capability} (evidence: ${(p.evidence ?? []).slice(0, 2).join(', ') || 'none'})`)
    .join('\n');
  let raw;
  try { raw = await generate(`North-star: ${goal}\n\n${SYNTHESIS_SPEC}\n\nPROPOSALS:\n${list}\n\nYour synthesis JSON:`); }
  catch { return null; }
  const j = parseProposal(raw);
  if (!j || j.none || !j.title || !j.capability) return null;
  const names = Array.isArray(j.buildsOn) ? j.buildsOn.map(String) : (j.buildsOn ? [String(j.buildsOn)] : []);
  const linked = usable.filter((p) => names.some((nm) => sameTitle(nm, p.title)));
  // A real synthesis must LINK ≥2 actual sibling proposals. Don't fabricate one from usable.slice(0,2)
  // when buildsOn didn't resolve — that inflated convergence scoring and persisted phantom backlog
  // entries (CodeRabbit #25). Nothing genuinely converged ⇒ null, as the docstring promises.
  if (linked.length < 2) return null;
  const evidence = [...new Set(linked.flatMap((p) => p.evidence ?? []))].slice(0, 6);
  return normalizeProposal({
    tool: 'propose', area: 'council', title: `Synthesis: ${j.title}`, capability: j.capability,
    evidence, steps: linked.map((p) => p.firstSlice).filter(Boolean).slice(0, 5),
    firstSlice: j.firstSlice ?? '', verify: j.verify ?? 'ship the first slice and confirm the combined behavior',
    buildsOn: linked.map((p) => p.title).slice(0, 3).join('; '),
    why: j.why ?? '',
  }, { id: 'council-chair', area: 'council' });
}

/**
 * Run ONE lens's grounded investigation → proposal. `generate` is injectable so the
 * loop unit-tests without a model: it receives the running transcript and returns the
 * model's next reply (a tool call, then eventually a propose). Serial + VRAM-guarded
 * when using the real driver.
 */
export async function proposeCapability({
  lens, context, goal = PERPETUAL_GOAL, focus = '', maxSteps = 6,
  priorProposals = [], generate, runToolImpl = runTool, vramGuard,
} = {}) {
  const transcript = [];
  // The round-so-far: earlier council members' proposals, so this lens can SYNTHESISE
  // (build on / refine / converge) instead of proposing in isolation. Guarded against
  // fake agreement — a distinct, higher-leverage gap is still worth standing alone.
  const roundSoFar = (priorProposals ?? []).filter((p) => p && p.title);
  const synthesisBlock = roundSoFar.length
    ? `\n\nROUND SO FAR (proposals from earlier council members this round):\n` +
      roundSoFar.map((p, i) => `${i + 1}. [${p.area}] ${p.title} — ${p.capability}`).join('\n') +
      `\n\nConverge where it is GENUINE: if your strongest idea extends or depends on one of the\n` +
      `above, add "buildsOn":"<that title or area>" to your propose JSON and make your firstSlice\n` +
      `the next slice on top of it. Do NOT force agreement — a distinct, higher-leverage gap is\n` +
      `still worth proposing on its own.`
    : '';
  const sys =
`${lensPreamble(lens, { goal, focus })}

You are on a capability-innovation council for the dev-vai TypeScript codebase.
Investigate the REAL code before proposing — do NOT invent files you have not read.

${TOOL_SPEC}

${PROPOSAL_SPEC}

PROJECT CONTEXT:
${context}${synthesisBlock}

Rules:
- Use grep_repo / find_symbol / read_file to GROUND your proposal in real code.
- Every "evidence" entry MUST be a file:line you actually read this session.
- Propose the SMALLEST first slice that moves the north-star, not a rewrite.
- Emit exactly ONE tool call per reply, as strict JSON, no prose around it.
- You have a budget of ${maxSteps} investigation steps. Investigate for the first
  few to gather real evidence, then you MUST emit "propose" — do NOT spend the whole
  budget reading. A grounded proposal beats more grepping.

Begin: your first reply must be a grep_repo or find_symbol call.`;

  // Tolerant: accept either {"tool":"propose",...} OR a bare proposal object that
  // already carries the proposal shape (the model sometimes drops the tool field).
  const asProposal = (call) =>
    call && (call.tool === 'propose' || (!call.tool && (call.title || call.capability)))
      ? normalizeProposal(call, lens) : null;

  let convo = sys;
  for (let step = 0; step < maxSteps; step++) {
    if (vramGuard) await vramGuard();
    let raw;
    try { raw = await generate(convo + '\n\nYour JSON tool call:'); }
    catch (e) { transcript.push(`step ${step}: model error ${String(e)}`); break; }

    const call = parseProposal(raw);
    if (!call || !call.tool) {
      const p = asProposal(call);
      if (p) { transcript.push(`step ${step}: PROPOSE ${p.area} :: ${p.title}`); return { proposal: p, transcript }; }
      transcript.push(`step ${step}: unparseable → "${String(raw).slice(0, 80)}"`); convo += '\n\n[harness] Emit ONE JSON tool call.'; continue;
    }

    if (call.tool === 'propose') {
      const proposal = normalizeProposal(call, lens);
      transcript.push(`step ${step}: PROPOSE ${proposal ? `${proposal.area} :: ${proposal.title}` : '(invalid shape)'}`);
      return { proposal, transcript };
    }
    // Contain a tool failure to THIS step — a thrown grep_repo/read_file must not abort the whole
    // round (CodeRabbit #25). Record it in the transcript + tell the model so it keeps steering this
    // lens toward a proposal (or a clean give-up) instead of crashing proposeCapability().
    let result;
    try { result = await runToolImpl(call); }
    catch (e) {
      const err = String(e?.message ?? e).slice(0, 200);
      transcript.push(`step ${step}: ${call.tool} FAILED → ${err}`);
      convo += `\n\n[you called] ${JSON.stringify(call)}\n[tool error] ${err}\n[harness] That tool call failed. Try a different call, or emit the final "propose" JSON from what you've already read.`;
      continue;
    }
    const shown = String(result).slice(0, 1400);
    transcript.push(`step ${step}: ${call.tool}(${JSON.stringify(call.pattern ?? call.path ?? call.name ?? call.query ?? '')}) → ${shown.split('\n').length} lines`);
    // Escalate pressure as the step budget runs out so the model converges on a
    // proposal instead of investigating forever (the live "0 proposals" failure).
    const left = maxSteps - 1 - step;
    const nudge = left <= 2
      ? `\n\n[harness] Only ${left} step(s) left. You have read real code above. Emit the final "propose" JSON NOW, citing file:line entries you already read as evidence. Do NOT call grep_repo/find_symbol/read_file again.`
      : `\n\nContinue: emit the next JSON tool call (investigate more, or propose).`;
    convo += `\n\n[you called] ${JSON.stringify(call)}\n[real result]\n${shown}${nudge}`;
  }

  // Budget exhausted with no proposal — one guaranteed forced attempt. The model has
  // read real code by now, so this converts a wasted investigation into a grounded
  // proposal rather than returning empty (which scores the whole council "broken").
  if (vramGuard) await vramGuard();
  try {
    const forced = await generate(convo +
      '\n\n[harness] Investigation budget exhausted. Based ONLY on the real code you read above, ' +
      'emit the final "propose" JSON now (tool:"propose"), citing file:line entries you already ' +
      'read as evidence. Output the JSON object and nothing else.\n\nYour propose JSON:');
    const p = asProposal(parseProposal(forced));
    if (p) { transcript.push(`forced: PROPOSE ${p.area} :: ${p.title}`); return { proposal: p, transcript }; }
    transcript.push(`forced: no valid propose → "${String(forced).slice(0, 80)}"`);
  } catch (e) { transcript.push(`forced: model error ${String(e)}`); }
  return { proposal: null, transcript };
}

// ── DB: the capabilities ledger (self-contained, like the experiments table) ───────
function ensureCapabilityTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS capabilities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    area TEXT, title TEXT, capability TEXT, lens TEXT,
    impact REAL, evidence TEXT, steps TEXT, first_slice TEXT, verify TEXT, why TEXT,
    council_overall REAL, status TEXT NOT NULL DEFAULT 'proposed', created_at TEXT NOT NULL
  )`);
}

/** Persist one ranked proposal (status='proposed'; never auto-applied). */
export function recordCapability(db, p, councilOverall = null) {
  ensureCapabilityTable(db);
  db.prepare(
    `INSERT INTO capabilities (area,title,capability,lens,impact,evidence,steps,first_slice,verify,why,council_overall,status,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'proposed', ?)`,
  ).run(p.area, p.title, p.capability, p.lens ?? null, p.score?.impact ?? null,
    JSON.stringify(p.evidence ?? []), JSON.stringify(p.steps ?? []), p.firstSlice ?? '',
    p.verify ?? '', p.why ?? '', councilOverall, new Date().toISOString());
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
}

/** Recent capability proposals (newest first) — for dedup + operator preview. */
export function capabilityHistory(db, limit = 20) {
  ensureCapabilityTable(db);
  try { return db.prepare('SELECT * FROM capabilities ORDER BY id DESC LIMIT ?').all(limit); }
  catch { return []; }
}

// ── DB: per-round compute accounting (feeds compute-roi.mjs — is compute being wasted?) ─
function ensureComputeTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS compute_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_calls INTEGER, wall_ms INTEGER, proposals INTEGER, qualified INTEGER,
    adopted INTEGER NOT NULL DEFAULT 0, council_overall REAL, cross_refs INTEGER,
    created_at TEXT NOT NULL
  )`);
}

/** Record one capability round's compute cost + benefit signals (never throws upward). */
export function recordComputeRound(db, rec = {}) {
  ensureComputeTable(db);
  db.prepare(
    `INSERT INTO compute_log (model_calls,wall_ms,proposals,qualified,adopted,council_overall,cross_refs,created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(rec.modelCalls ?? 0, rec.wallMs ?? 0, rec.proposals ?? 0, rec.qualified ?? 0,
    rec.adopted ?? 0, rec.councilOverall ?? null, rec.crossRefs ?? 0, new Date().toISOString());
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
}

/** Chronological round records (oldest→newest) shaped for analyzeRoiTrend(). */
export function computeRoiSeries(db, limit = 30) {
  ensureComputeTable(db);
  try {
    const rows = db.prepare('SELECT * FROM compute_log ORDER BY id DESC LIMIT ?').all(limit).reverse();
    return rows.map((r) => ({
      modelCalls: r.model_calls, wallMs: r.wall_ms, proposals: r.proposals,
      qualified: r.qualified, adopted: r.adopted,
    }));
  } catch { return []; }
}

/** Credit a recorded round with realized adoption(s) — a proposal that ACTUALLY shipped:
 *  a human/Opus merged a backlog item, or the acceptance-verifier returned ACCEPTED on an
 *  applied fix. This is the ONLY honest source of realized compute-ROI; without it `adopted`
 *  stays 0 forever and the meter can only ever report "wasteful · the bottleneck is ADOPTION".
 *  Returns the round's new adopted total, or 0 if the id is unknown/invalid. Never throws. */
export function markRoundAdopted(db, computeId, count = 1) {
  ensureComputeTable(db);
  const id = Number(computeId);
  const n = Math.max(1, Math.floor(Number(count) || 1));
  if (!Number.isInteger(id) || id <= 0) return 0;
  try {
    const info = db.prepare('UPDATE compute_log SET adopted = adopted + ? WHERE id = ?').run(n, id);
    if (!info.changes) return 0;
    return Number(db.prepare('SELECT adopted FROM compute_log WHERE id = ?').get(id)?.adopted ?? 0);
  } catch { return 0; }
}

/** Build the markdown backlog entry for a scored round (propose-only artifact). */
export function formatBacklogEntry(ranked = [], council = {}, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const top = ranked.slice(0, 5);
  const lines = [
    `- **Capability-Innovation ${date} — council round (${council.verdict ?? 'n/a'} ${council.overall ?? '?'}/10)**`,
    `  - Context: generative capability council toward the north-star (voice + interface, any task,`,
    `    reliable, no lost details). ${council.headline ?? ''}`,
    `  - ${council.lesson ?? 'council lesson: n/a'}`,
    `  - Proposals (PROPOSE-only — review + implement by V3gga/Opus; never auto-applied):`,
  ];
  for (const p of top) {
    lines.push(`    - **[${p.area}] ${p.title}** (impact ${p.score?.impact ?? '?'}/10) — ${p.capability}`);
    if (p.firstSlice) lines.push(`      - first slice: ${p.firstSlice}`);
    if (p.verify) lines.push(`      - verify: ${p.verify}`);
    if (p.buildsOn) lines.push(`      - builds on: ${p.buildsOn}`);
    if (p.evidence?.length) lines.push(`      - evidence: ${p.evidence.slice(0, 4).join(', ')}`);
  }
  return lines.join('\n') + '\n';
}

/** Append the round's entry under "## Open" (propose-only write to the backlog md). */
export function appendProposalsToBacklog(fs, entry, { path = 'docs/vai-improvement-backlog.md' } = {}) {
  let md = '';
  try { md = fs.readFileSync(path, 'utf8'); } catch { md = '# Vai Improvement Backlog\n\n## Open\n\n'; }
  const idx = md.indexOf('## Open');
  if (idx < 0) { fs.writeFileSync(path, md + '\n## Open\n\n' + entry); return; }
  const insertAt = md.indexOf('\n', idx) + 1;
  fs.writeFileSync(path, md.slice(0, insertAt) + '\n' + entry + md.slice(insertAt));
}

/**
 * Run a full capability roundtable: assemble context → run each lens serially
 * (VRAM-guarded with the real driver) → score every proposal + the whole round →
 * dedupe against backlog + prior capabilities → rank → persist + append to backlog.
 *
 * SERIAL by construction (one heavy GPU task at a time — the BSOD rule). Every
 * external dependency is injectable so the orchestration unit-tests without a model,
 * a DB, or disk.
 * @returns {{ ranked, council, recorded, transcripts, lensesRun, compute }}
 */
export async function runCapabilityRound({
  db, fsImpl, baseUrl, focus = '', maxLenses = 0, maxSteps = 6,
  generateFor, vramGuard = () => waitForVramHeadroom(7 * 1024 ** 3),
  log = () => {},
} = {}) {
  if (db) {
    const policy = deriveGenerationPolicy(db);
    if (policy.paused) {
      log(`round paused: ${policy.reason}`);
      return {
        paused: true,
        pauseReason: policy.reason,
        generation: policy,
        ranked: [],
        council: { overall: 0, verdict: 'paused', headline: policy.reason },
        recorded: 0,
        transcripts: [],
        lensesRun: 0,
        compute: { id: 0, modelCalls: 0, wallMs: 0, qualified: 0, crossRefs: 0 },
      };
    }
  }
  const fs = fsImpl ?? (await import('node:fs'));
  const { context, goal, parts } = await assembleContext({ fsImpl: fs.readFileSync ? fs : undefined, baseUrl });
  let lenses = selectLenses(focus);
  if (maxLenses > 0) lenses = lenses.slice(0, maxLenses);

  // Compute accounting (feeds compute-roi.mjs): count EVERY model call this round and
  // time the wall-clock, so the loop can later see whether compute returned shipped value.
  let modelCalls = 0;
  const counted = (fn) => (...args) => { modelCalls += 1; return fn(...args); };
  const startedAt = Date.now();

  const proposals = [];
  const transcripts = [];
  for (const lens of lenses) {
    log(`lens ${lens.id} …`);
    const gen = counted(generateFor
      ? (prompt) => generateFor(lens, prompt)
      : (prompt) => ollamaGenerate(MODEL, prompt, { numPredict: 640, timeoutMs: 120000 }));
    // Pass the round-so-far so each later lens can build on earlier proposals (convergence).
    const { proposal, transcript } = await proposeCapability({ lens, context, goal, focus, maxSteps, priorProposals: proposals.slice(), generate: gen, vramGuard });
    transcripts.push({ lens: lens.id, transcript });
    if (proposal) proposals.push(proposal);
  }

  const prior = db ? capabilityHistory(db, 30).map((r) => ({ area: r.area, title: r.title })) : [];
  const unique = dedupeProposals(proposals, { backlog: parts?.backlog ?? [], prior });
  let ranked = rankProposals(unique);

  // CHAIR step: converge the round into one synthesised direction (the real council
  // mechanism). Serial + VRAM-guarded like the lenses. Null when nothing truly converges.
  if (ranked.length >= 2) {
    const synthGen = counted(generateFor
      ? (prompt) => generateFor({ id: 'council-chair', area: 'council', title: 'chair', lens: 'synthesise' }, prompt)
      : (prompt) => ollamaGenerate(MODEL, prompt, { numPredict: 512, timeoutMs: 120000 }));
    if (vramGuard) await vramGuard();
    try {
      const synth = await synthesizeRound({ proposals: ranked, goal, generate: synthGen });
      if (synth) { log(`chair: synthesis "${synth.title}" builds on ${synth.buildsOn}`); ranked = rankProposals([...unique, synth]); }
    } catch {}
  }
  const council = scoreCouncilProcess({ proposals: ranked });

  let recorded = 0;
  if (db) for (const p of ranked) { try { recordCapability(db, p, council.overall); recorded++; } catch {} }
  if (ranked.length && fs.writeFileSync) {
    try { appendProposalsToBacklog(fs, formatBacklogEntry(ranked, council)); } catch {}
  }

  // Persist this round's compute cost + benefit signals (propose-only; adopted stays 0
  // until a human/Opus ships a backlog item). qualified = proposals clearing the review bar.
  const wallMs = Date.now() - startedAt;
  const qualified = ranked.filter((p) => (p.score?.impact ?? 0) >= QUALITY_BAR).length;
  const crossRefs = ranked.filter((p) => p.buildsOn).length;
  let computeId = 0;
  if (db) {
    try {
      computeId = recordComputeRound(db, {
        modelCalls, wallMs, proposals: ranked.length, qualified,
        councilOverall: council.overall, crossRefs,
      });
    } catch {}
  }
  log(`round: ${ranked.length} proposals · ${qualified} qualified · ${modelCalls} model calls · ${(wallMs / 1000).toFixed(1)}s · ${council.headline}`);
  return { ranked, council, recorded, transcripts, lensesRun: lenses.length, compute: { id: computeId, modelCalls, wallMs, qualified, crossRefs } };
}

// ── CLI one-shot: node --experimental-sqlite capability-engine.mjs [--focus voice] ──
const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const focus = opt('--focus', '');
  const maxLenses = Number(opt('--max-lenses', '0')) || 0;
  const baseUrl = opt('--base-url', process.env.VAI_API ?? 'http://localhost:3006');
  const dbPath = opt('--db', 'scripts/improve-loop/.corpus.sqlite');
  const { openDb } = await import('./db.mjs');
  const fs = await import('node:fs');
  // --adopt <roundId|latest> [--adopt-count N]: credit a recorded round as SHIPPED (the
  // human/Opus adoption signal). Resolves the "bottleneck is ADOPTION" verdict; no round runs.
  const adoptArg = opt('--adopt', '');
  if (adoptArg) {
    const db = openDb(dbPath);
    let id = adoptArg;
    if (String(adoptArg).toLowerCase() === 'latest') {
      try { id = db.prepare('SELECT MAX(id) AS id FROM compute_log').get()?.id ?? 0; } catch { id = 0; }
    }
    const total = markRoundAdopted(db, id, Number(opt('--adopt-count', '1')) || 1);
    const { analyzeRoiTrend, formatRoi } = await import('./compute-roi.mjs');
    process.stdout.write(total > 0
      ? `Credited round #${id}: adopted now ${total}.\n\n${formatRoi(analyzeRoiTrend(computeRoiSeries(db, 30)))}\n`
      : `No compute round #${id} to credit (check id via operator status).\n`);
    db.close();
    process.exit(total > 0 ? 0 : 1);
  }
  const db = openDb(dbPath);
  const out = await runCapabilityRound({
    db, fsImpl: fs, baseUrl, focus, maxLenses,
    log: (m) => process.stdout.write(`[capability ${new Date().toLocaleTimeString()}] ${m}\n`),
  });
  db.close();
  process.stdout.write(`\nTop proposals:\n`);
  for (const p of out.ranked.slice(0, 5)) process.stdout.write(`  [${p.area}] ${p.title} (impact ${p.score.impact}/10)\n`);
  process.stdout.write(`\n${out.council.headline}\n`);
  process.stdout.write(`convergence ${out.council.dimensions.convergence}/10 · crossRefs ${out.council.crossRefs} · ${out.council.lesson}\n`);
  // Compute-ROI verdict across recorded rounds (is the GPU spend returning shipped value?).
  try {
    const dbR = openDb(dbPath);
    const { analyzeRoiTrend, formatRoi } = await import('./compute-roi.mjs');
    process.stdout.write(`\n${formatRoi(analyzeRoiTrend(computeRoiSeries(dbR, 30)))}\n`);
    dbR.close();
  } catch {}
}
