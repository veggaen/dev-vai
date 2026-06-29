#!/usr/bin/env node
/**
 * propose-fix — close the self-improvement loop's PROPOSE step.
 *
 * For a queued fix candidate, this:
 *   1. Reads the REAL source at the candidate's best-guess location (grounding —
 *      qwen sees actual code, not its imagination).
 *   2. Asks qwen3:8b to localize the bug and propose the SMALLEST change, as a
 *      strict JSON {file, find, replace, why}.
 *   3. Writes the proposal to the db (status='proposed') for a human/architect
 *      grade. It does NOT touch source. qwen proposes; it never commits.
 *
 * SAFETY: an 8B local model cannot be trusted to edit a codebase. This stage is
 * deliberately read-only on source. The grade+apply gate lives outside qwen.
 *
 * Usage: node scripts/improve-loop/propose-fix.mjs --class routing/fresh-data-trigger
 */
import { readFileSync } from 'node:fs';
import { openDb, recordKnowledge, topKnowledge, priorRejection } from './db.mjs';
import { ollamaGenerate, waitForVramHeadroom } from './driver.mjs';
import { fetchFixWebEvidence, fixSearchQuery } from './web-evidence.mjs';
import { verifyProposal, summarizeVerdicts } from './proposal-verifier.mjs';
import { CLASS_LOCATION } from './brain.mjs';
import { parseProposal } from './parse-proposal.mjs';

/** KNOWLEDGE-SPINE scope for this stage: facts about how the LOCAL model proposes fixes. */
const KNOW_SCOPE = `propose-fix:${process.env.IMPROVE_GEN_MODEL ?? process.env.LOCAL_MODEL ?? 'qwen3:8b'}`;

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DB_PATH = opt('--db', 'scripts/improve-loop/.corpus.sqlite');
const TARGET_CLASS = opt('--class', null);
const MODEL = process.env.IMPROVE_GEN_MODEL ?? process.env.LOCAL_MODEL ?? 'qwen3:8b';

const db = openDb(DB_PATH);
// Ensure a proposals table (additive; never drops existing data).
db.exec(`CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fix_id INTEGER, class TEXT NOT NULL,
  file TEXT, find TEXT, replace TEXT, why TEXT, raw TEXT,
  status TEXT NOT NULL DEFAULT 'proposed', created_at TEXT NOT NULL);`);

const run = db.prepare('SELECT id FROM runs ORDER BY id DESC LIMIT 1').get();
// When a class is targeted (the prototype always targets the campaign-wide weakest class), use
// the latest fix for THAT class across ALL runs — not just the current run. The prototype runs
// every cycle but observe (which mines fixes) rarely wins the budget, so the latest run usually
// has no fixes; run-scoping starved propose-fix → no proposal → no knowledge (the bottleneck).
// LOCATION-RESILIENT SELECTION: a concurrent observe mints a NEW fix row every run, and a class
// not (yet) in CLASS_LOCATION gets location "(unknown — investigate)". Blindly taking ORDER BY id
// DESC then lets one junk row shadow a good, resolvable location forever (the routing/comparison
// race: a stale-code observe wrote an unknown-location row newer than the migrated real one). So for
// a targeted class, prefer the most-recent fix row whose location RESOLVES to a real path; only fall
// back to the newest row (and, last resort, the static CLASS_LOCATION map) if none resolve.
const RESOLVABLE = /[\\/].+\.(ts|tsx|js|jsx|mjs|cjs|json|md)/i;
let fix;
if (TARGET_CLASS) {
  const recent = db.prepare('SELECT id,class,location,summary FROM fixes WHERE class=? ORDER BY id DESC LIMIT 8').all(TARGET_CLASS);
  fix = recent.find((r) => RESOLVABLE.test(String(r.location ?? ''))) ?? recent[0];
  // Static fallback: if EVERY recent row is junk but the class has a known location, synthesize one
  // from CLASS_LOCATION so a poisoned corpus can't permanently block a class we DO know how to ground.
  if (fix && !RESOLVABLE.test(String(fix.location ?? '')) && CLASS_LOCATION[TARGET_CLASS]) {
    fix = { ...fix, location: CLASS_LOCATION[TARGET_CLASS] };
  }
} else {
  fix = db.prepare('SELECT id,class,location,summary FROM fixes WHERE run_id=? ORDER BY failure_count DESC LIMIT 1').get(run.id);
}
if (!fix) { console.log('no queued fix for that class'); process.exit(0); }

// Pull the failing prompts + how Vai read them — qwen needs the evidence. Across ALL runs for
// the class (not just the latest run, which is usually empty) so qwen always has real failing
// examples to ground on — ungrounded proposals are the #1 source of hallucinated `find` lines.
const fails = db.prepare(
  `SELECT p.prompt, r.read_as, r.grade_reason FROM results r JOIN prompts p ON p.id=r.prompt_id
   WHERE r.class=? AND r.passed=0 ORDER BY r.run_id DESC LIMIT 8`,
).all(fix.class);

// Ground qwen in the REAL file at the candidate location. Guard a missing location so a class with
// no location doesn't throw on .split (CodeRabbit #25) — it just falls through the no-file guard.
const filePath = (String(fix.location ?? '').split(/[:\s(]/)[0] || '').trim();
let source = '';
let readOk = false;
try { source = readFileSync(filePath, 'utf8'); readOk = source.trim().length > 0; }
catch { source = '(could not read ' + filePath + ')'; }

// NO-FILE GUARD (anti-waste): if the class's location does NOT resolve to a real, readable source
// file, qwen has nothing to ground on and WILL hallucinate a `no-file` patch — every cycle, forever
// (the routing/comparison stall: 49 wasted cycles). Don't spend a model call on an ungroundable
// class. Record a counted fact so the engine's class-selection can deprioritise it, then exit.
if (!readOk) {
  const claim = `class "${fix.class}" has no resolvable source file (location="${fix.location}") — propose cannot ground a fix`;
  recordKnowledge(db, { scope: 'propose:no-file', claim, kind: 'guard', confirm: true, evidence: `filePath="${filePath}"` });
  console.log(`⛔ no-file: class ${fix.class} → "${filePath}" is not a readable source. Skipping (recorded so the loop deprioritises it).`);
  process.exit(0);
}
// LOCATION-AWARE EXCERPT: show qwen the RELEVANT slice, not just the head. A 1840-line file shown
// head-only made qwen hallucinate `find` lines it never saw (the opportunity-framing stall: the
// real logic is at line 526+). Center the window on the location's :line hint if present, else on
// the best keyword match for the class; fall back to the head only when nothing matches.
const lines = source.split('\n');
const WINDOW = 150;
function excerptAround(centerIdx) {
  const start = Math.max(0, centerIdx - Math.floor(WINDOW / 2));
  const end = Math.min(lines.length, start + WINDOW);
  return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
}
// FUNCTION-SCOPED EXCERPT: a flat ±75-line window around a :line hint sweeps in NEIGHBOURING
// functions, and qwen patches the wrong one (measured: the comparison hint at L1162 also showed
// asksAboutVaiEngine at L1225 → qwen patched the latter, verified, wrong-target). When we have a
// precise line, isolate the ENCLOSING function so the model can only edit the right one. Find the
// nearest declaration at/above the line, then its matching close brace by depth. Returns the line
// range [start,end) or null when it can't bound a function (then we fall back to the flat window).
function enclosingFunction(centerIdx) {
  const DECL = /^\s*(?:export\s+)?(?:async\s+)?(?:function\b|const\s+\w+\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|\w+\s*=>)|\w+\s*\([^)]*\)\s*[:{])/;
  let declIdx = -1;
  for (let i = Math.min(centerIdx, lines.length - 1); i >= 0 && i > centerIdx - 200; i--) {
    if (DECL.test(lines[i])) { declIdx = i; break; }
  }
  if (declIdx < 0) return null;
  // Walk braces from the decl line to its matching close (skip until the first '{').
  let depth = 0; let seenOpen = false; let endIdx = -1;
  for (let i = declIdx; i < lines.length && i < declIdx + 220; i++) {
    for (const ch of lines[i]) { if (ch === '{') { depth++; seenOpen = true; } else if (ch === '}') depth--; }
    if (seenOpen && depth <= 0) { endIdx = i; break; }
  }
  if (endIdx < 0 || endIdx - declIdx < 1) return null;
  return { start: declIdx, end: endIdx + 1 };
}
let centerIdx = -1;
// (1) explicit :line in the location, e.g. "build-execution-intent.ts:88"
const lineHint = /:(\d+)/.exec(fix.location);
if (lineHint) centerIdx = Math.max(0, Number(lineHint[1]) - 1);
// (2) else grep for the most distinctive term from the class name / failing prompts.
if (centerIdx < 0) {
  const terms = [...new Set(
    (`${fix.class} ${fix.summary} ${fails.map((f) => f.prompt).join(' ')}`)
      .toLowerCase().match(/[a-z]{5,}/g) || [],
  )].filter((t) => !['answer', 'routing', 'where', 'which', 'should', 'about', 'these', 'their'].includes(t));
  let best = -1; let bestIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const low = lines[i].toLowerCase();
    const score = terms.reduce((s, t) => s + (low.includes(t) ? 1 : 0), 0);
    if (score > best) { best = score; bestIdx = i; }
  }
  if (best > 0) centerIdx = bestIdx;
}
// Prefer the ENCLOSING FUNCTION when we have a precise line hint — it stops qwen patching a
// neighbouring function that merely shares the window. Only when the function is a sane size
// (≤ WINDOW lines); a giant function falls back to the centered window. No hint → keyword window.
let fnRange = null;
if (lineHint && centerIdx >= 0) {
  const r = enclosingFunction(centerIdx);
  if (r && (r.end - r.start) <= WINDOW) fnRange = r;
}
// Track the EXCERPTED line range [excerptStart, excerptEnd) (1-based, inclusive start) so we can
// later reject a findLine the model invented OUTSIDE what it actually saw (CodeRabbit #25).
let excerptStartLine; let excerptEndLine;
let sourceExcerpt;
if (fnRange) {
  excerptStartLine = fnRange.start + 1; excerptEndLine = fnRange.end;
  sourceExcerpt = lines.slice(fnRange.start, fnRange.end).map((l, i) => `${fnRange.start + i + 1}: ${l}`).join('\n');
} else if (centerIdx >= 0 && lines.length > WINDOW) {
  const start = Math.max(0, centerIdx - Math.floor(WINDOW / 2));
  excerptStartLine = start + 1; excerptEndLine = Math.min(lines.length, start + WINDOW);
  sourceExcerpt = excerptAround(centerIdx);
} else {
  excerptStartLine = 1; excerptEndLine = Math.min(lines.length, WINDOW);
  sourceExcerpt = lines.slice(0, WINDOW).map((l, i) => `${i + 1}: ${l}`).join('\n');
}
if (fnRange) console.log(`🎯 scoped excerpt to the enclosing function (lines ${fnRange.start + 1}–${fnRange.end})`);

// Free web evidence (Vegga: council/Vai run local but HAVE web — use it). Opt-in via
// VAI_FIX_WEB_EVIDENCE=1; best-effort, never blocks. Grounds the patch in current docs/discussion.
let webBlock = '';
if (/^(1|true|on|yes)$/i.test((process.env.VAI_FIX_WEB_EVIDENCE ?? '').trim())) {
  const baseUrl = process.env.VAI_API ?? 'http://localhost:3006';
  webBlock = await fetchFixWebEvidence({ baseUrl, query: fixSearchQuery(fix.class, fix.summary) });
  if (webBlock) console.log('🌐 pulled free web evidence for the fix');
}

// APPLY the knowledge spine: inject the model's OWN recent, verified failure modes so it
// stops repeating them. These are counted facts (e.g. "3/5 of your proposals cited a
// non-existent line"), not vibes — the anti-slop contract. Empty on a fresh corpus.
const learned = topKnowledge(db, KNOW_SCOPE, { limit: 4, minConfidence: 0.5 });
const learnedBlock = learned.length
  ? `\nLEARNED ABOUT YOUR OWN PROPOSALS (verified facts from past cycles — heed them):\n${learned.map((k) => `- ${k.claim}${k.evidence ? ` (${k.evidence})` : ''}`).join('\n')}\n`
  : '';

const prompt =
`You are fixing a bug in a TypeScript codebase. Be precise and minimal.

FAILURE CLASS: ${fix.class}
SYMPTOM: ${fix.summary}
${learnedBlock}

FAILING CASES (prompt → how the AI wrongly read/answered it):
${fails.map((f) => `- "${f.prompt}" → read:"${f.read_as ?? '?'}" → ${f.grade_reason}`).join('\n')}
${webBlock ? '\n' + webBlock + '\n' : ''}
ACTUAL SOURCE (${filePath} — the relevant excerpt; line numbers are REAL, quote a "find" only from these lines):
\`\`\`typescript
${sourceExcerpt}
\`\`\`

RULES (critical — most proposals fail by ignoring these):
- Fix the DECISION LOGIC (a regex, an if-condition, a return). NEVER edit a comment, a // line, a log/grade message, or a string literal — those do not change behaviour.
- The "find" must be a line of executable code (a const REGEX = /.../, or an if(...) , or a return ...). If your find contains "//" or is plain prose, it is WRONG.
- Think: which exact line decided the wrong branch for the failing input? Quote THAT line.

Worked reasoning for this class: the failing inputs are QUESTIONS that merely contain a build-ish gerund (creating/building). A guard that treats "any build verb anywhere" as disqualifying is too broad — a clean interrogative should still qualify. The fix narrows that guard.

Respond with ONLY a JSON object, no prose:
{"file":"${filePath}","findLine":<the REAL line number from the source excerpt of the line to change>,"find":"<that exact line copied verbatim>","replace":"<new line>","why":"<one sentence>"}
CRITICAL — the "find" and "replace" rules (most fixes fail by breaking these):
- ALWAYS set "findLine" to the line number (shown as \`N:\` in the source excerpt) of the single line you are changing. We copy that exact line for you, so you CANNOT corrupt a regex by retyping it — this is the most reliable way to avoid a rejected fix. Still fill "find" too as a cross-check.
- "find" must be a COMPLETE line/statement copied verbatim from the source — NEVER a partial line. If the line is a regex like \`const X = /.../i;\`, copy the WHOLE regex through the closing \`/i;\`. A truncated find (e.g. ending mid-pattern at "|fore") corrupts the file and is REJECTED.
- "replace" must have the SAME balanced brackets () [] {} and the SAME number of \`/\` as "find". If "find" has one \`(\` and one \`/\`, so must "replace" — otherwise the edit breaks the syntax.
- Both must be CODE (a regex / if / return), not a comment or string.`;

// PREFER A CODE MODEL for code localization. Localizing a TS bug + writing a precise find/replace is
// a CODE task — a dedicated coder model (qwen2.5-coder) does it better than a general chat model
// (qwen3:8b). Measured the gap: qwen3 proposed shallow, low-diversity patches (re-proposing "exclude
// build" 6×). Pick an installed coder model when available; honour an explicit override; else fall
// back. Cheap (one installed-list read), and the resident-first order avoids a VRAM evict/cold-load.
let genModel = MODEL;
if (!process.env.IMPROVE_GEN_MODEL && !process.env.LOCAL_MODEL) {
  try {
    const { installedModels, residentModel } = await import('./driver.mjs');
    const installed = await installedModels().catch(() => []);
    const resident = await residentModel().catch(() => null);
    // installedModels() returns {name,sizeBytes} objects — read .name (the earlier string assumption
    // was the bug: regex over an object never matched, so the coder model was never picked).
    const names = installed.map((m) => (typeof m === 'string' ? m : m?.name)).filter(Boolean);
    const coder = names.find((m) => /coder/i.test(m));
    // Prefer the coder model; if it's not already resident but another coder is, still use a coder.
    if (coder) genModel = (resident && /coder/i.test(resident)) ? resident : coder;
  } catch { /* keep MODEL default */ }
}
console.log(`⏳ grounding ${genModel} in ${filePath} — asking for minimal patch…`);
await waitForVramHeadroom(7 * 1024 ** 3);
let raw = '';
try { raw = await ollamaGenerate(genModel, prompt, { numPredict: 400, timeoutMs: 120000 }); }
catch (e) { console.log('model unavailable:', String(e)); process.exit(1); }

// Extract the JSON object — strict parse first, then a regex-escape repair so a sound regex fix
// (\b \s \w …) isn't discarded as "unparseable" (the measured comparison-class false-reject).
const parsed = parseProposal(raw);

// LINE-NUMBER GROUNDING (the highest-leverage anti-corruption move): regex-heavy `find` lines are
// the #1 source of hallucinated-find — the 7B model has to RE-TYPE + JSON-escape a line like
// `const X = /\b(?:a|b)\s+c/i;` and reliably drops the \b or mangles \s+ (measured live on the
// REFINEMENT_REQUEST case). The source excerpt already carries REAL line numbers, so if the model
// cites `findLine` (a number), we COPY that exact source line ourselves instead of trusting its
// retype. The model's job becomes "point at the line" (which it does well); the verbatim copy is
// deterministic. Falls back to the model's `find` string when no usable line number is given.
if (parsed && parsed.findLine != null) {
  const ln = Number(parsed.findLine);
  // Reject a findLine OUTSIDE the excerpted range the model actually saw — a number beyond it is a
  // hallucination, not a real pointer (CodeRabbit #25). Keep parsed.find (the model's string) so the
  // mechanical verify can still try to locate it, but don't copy an out-of-excerpt source line.
  if (Number.isInteger(ln) && ln >= excerptStartLine && ln <= excerptEndLine && ln <= lines.length) {
    const exact = lines[ln - 1];
    if (exact && exact.trim()) {
      parsed.find = exact.trim();
      parsed._findFromLine = ln; // breadcrumb for the log/raw
    }
  } else {
    parsed._findLineRejected = `findLine ${ln} outside excerpt ${excerptStartLine}-${excerptEndLine}`;
  }
}

// VERIFY mechanically (knowledge-as-guard): does the cited line actually exist + is it
// executable + unique? This is the loop's most-repeated failure encoded as a deterministic
// check — caught at the SOURCE, no model, ungameable. The verdict drives BOTH the proposal
// status and the captured knowledge, so the same mistake teaches the next cycle.
// OUTCOME-MEMORY GUARD (runs BEFORE the mechanical verify): if this EXACT patch was already
// rejected or reverted in a past cycle, it is dead on arrival — re-verifying + re-queuing it just
// re-spends the budget on a known-dead patch (the 66× re-proposal of a senior-superseded fix). Catch
// it here, record it as a counted lesson, and skip. This is the difference between a loop that learns
// and one that re-tries the same dead end forever.
const rejected = parsed ? priorRejection(db, parsed) : null;
const verdict = rejected
  ? { ok: false, code: 'already-rejected', detail: rejected }
  : parsed
    ? verifyProposal(parsed, { readFile: (p) => readFileSync(p, 'utf8') })
    : { ok: false, code: 'no-find', detail: 'qwen produced no parseable JSON proposal' };

const status = verdict.ok ? 'proposed' : `auto-rejected: ${verdict.code} — ${verdict.detail}`;
db.prepare(`INSERT INTO proposals (fix_id,class,file,find,replace,why,raw,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
  .run(fix.id, fix.class, parsed?.file ?? filePath, parsed?.find ?? null, parsed?.replace ?? null, parsed?.why ?? null, raw.slice(0, 2000), status, new Date().toISOString());

// CAPTURE knowledge: every verdict is a counted fact about how THIS model proposes fixes.
// A good proposal CONFIRMS "the model can cite a real, executable, unique line"; a bad one
// CONTRADICTS it (and is itself recorded as the specific failure mode, raising its confidence).
recordKnowledge(db, {
  scope: KNOW_SCOPE,
  claim: 'the model cites a real, executable, unique source line',
  kind: 'observation',
  confirm: verdict.ok,
  evidence: verdict.ok ? `confirmed on ${fix.class}` : `failed: ${verdict.code}`,
});
if (!verdict.ok && verdict.code !== 'no-find') {
  // Record the SPECIFIC failure mode as its own guard-claim so the apply-step can quote it.
  const guardClaim = {
    'hallucinated-find': 'copy the "find" as an EXACT verbatim substring from the SOURCE — do not reconstruct it from memory (you have hallucinated non-existent lines before)',
    'non-executable-find': 'the "find" must be executable decision logic (a regex/if/return), never a comment or string',
    'noop-replace': 'the "replace" must differ from "find" — a no-op change fixes nothing',
    'ambiguous-find': 'pick a "find" that occurs exactly once so the patch has a unique anchor',
    'already-rejected': 'this exact find→replace was tried in a past cycle and rejected/reverted — propose a DIFFERENT line or a different replacement; do not re-submit a known-dead patch',
  }[verdict.code];
  if (guardClaim) recordKnowledge(db, { scope: KNOW_SCOPE, claim: guardClaim, kind: 'guard', confirm: true, evidence: `observed on ${fix.class}` });

  // MODEL-GROUNDING DEAD-END: if THIS class keeps getting hallucinated/unparseable finds, the
  // model cannot ground a fix here (file too big, logic too diffuse for an 8B). After 3 strikes,
  // flag it ungroundable so the engine targets a class the model CAN actually fix — instead of
  // spinning on opportunity-framing forever. The propose:no-file scope drives ungroundableClasses().
  const HALLUC_CODES = new Set(['hallucinated-find', 'no-find', 'ambiguous-find']);
  if (HALLUC_CODES.has(verdict.code)) {
    const recent = db.prepare(
      "SELECT COUNT(*) c FROM proposals WHERE class=? AND status LIKE 'auto-rejected:%' AND (status LIKE '%hallucinated-find%' OR status LIKE '%no-find%' OR status LIKE '%ambiguous-find%')",
    ).get(fix.class);
    if (Number(recent.c) >= 3) {
      recordKnowledge(db, {
        scope: 'propose:no-file',
        claim: `class "${fix.class}" has no resolvable source file (location="${fix.location}") — the model cannot ground a fix (≥3 hallucinated/empty proposals)`,
        kind: 'guard', confirm: true, evidence: `${recent.c} ungroundable proposals on a real but un-localisable file`,
      });
      console.log(`⛔ model-grounding dead-end on ${fix.class} (${recent.c} hallucinated) → flagged ungroundable; engine will move on.`);
    }
  }
}

console.log('\n━━━ qwen proposal ['+fix.class+'] ━━━');
if (parsed) {
  console.log('file:', parsed.file);
  console.log('find:', JSON.stringify(parsed.find));
  console.log('replace:', JSON.stringify(parsed.replace));
  console.log('why:', parsed.why);
} else {
  console.log('(could not parse JSON; raw saved)\n', raw.slice(0, 600));
}
console.log(verdict.ok ? '\n✅ VERIFIED (find exists, executable, unique) → status=proposed' : `\n⛔ AUTO-REJECTED: ${verdict.code} — ${verdict.detail}`);
if (learned.length) console.log(`   (injected ${learned.length} learned fact(s) into the prompt this cycle)`);
console.log('→ saved to proposals table. Human/architect grades the VERIFIED ones next.');
