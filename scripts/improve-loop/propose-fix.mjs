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
import { openDb, recordKnowledge, topKnowledge } from './db.mjs';
import { ollamaGenerate, waitForVramHeadroom } from './driver.mjs';
import { fetchFixWebEvidence, fixSearchQuery } from './web-evidence.mjs';
import { verifyProposal, summarizeVerdicts } from './proposal-verifier.mjs';

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
const fix = TARGET_CLASS
  ? db.prepare('SELECT id,class,location,summary FROM fixes WHERE class=? ORDER BY id DESC LIMIT 1').get(TARGET_CLASS)
  : db.prepare('SELECT id,class,location,summary FROM fixes WHERE run_id=? ORDER BY failure_count DESC LIMIT 1').get(run.id);
if (!fix) { console.log('no queued fix for that class'); process.exit(0); }

// Pull the failing prompts + how Vai read them — qwen needs the evidence. Across ALL runs for
// the class (not just the latest run, which is usually empty) so qwen always has real failing
// examples to ground on — ungrounded proposals are the #1 source of hallucinated `find` lines.
const fails = db.prepare(
  `SELECT p.prompt, r.read_as, r.grade_reason FROM results r JOIN prompts p ON p.id=r.prompt_id
   WHERE r.class=? AND r.passed=0 ORDER BY r.run_id DESC LIMIT 8`,
).all(fix.class);

// Ground qwen in the REAL file at the candidate location.
const filePath = (fix.location.split(/[:\s(]/)[0] || '').trim();
let source = '';
try { source = readFileSync(filePath, 'utf8'); } catch { source = '(could not read ' + filePath + ')'; }
// Keep it within context: head of file (where the regexes/guards live).
const sourceExcerpt = source.split('\n').slice(0, 130).map((l, i) => `${i + 1}: ${l}`).join('\n');

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
ACTUAL SOURCE (${filePath}, first 130 lines):
\`\`\`typescript
${sourceExcerpt}
\`\`\`

RULES (critical — most proposals fail by ignoring these):
- Fix the DECISION LOGIC (a regex, an if-condition, a return). NEVER edit a comment, a // line, a log/grade message, or a string literal — those do not change behaviour.
- The "find" must be a line of executable code (a const REGEX = /.../, or an if(...) , or a return ...). If your find contains "//" or is plain prose, it is WRONG.
- Think: which exact line decided the wrong branch for the failing input? Quote THAT line.

Worked reasoning for this class: the failing inputs are QUESTIONS that merely contain a build-ish gerund (creating/building). A guard that treats "any build verb anywhere" as disqualifying is too broad — a clean interrogative should still qualify. The fix narrows that guard.

Respond with ONLY a JSON object, no prose:
{"file":"${filePath}","find":"<exact executable line copied from source>","replace":"<new line>","why":"<one sentence>"}
The "find" must be an EXACT substring copied from the source above so it can be matched literally, and must be CODE, not a comment or string.`;

console.log('⏳ grounding qwen in', filePath, '— asking for minimal patch…');
await waitForVramHeadroom(7 * 1024 ** 3);
let raw = '';
try { raw = await ollamaGenerate(MODEL, prompt, { numPredict: 400, timeoutMs: 120000 }); }
catch (e) { console.log('qwen unavailable:', String(e)); process.exit(1); }

// Extract the JSON object.
let parsed = null;
const jmatch = raw.match(/\{[\s\S]*\}/);
if (jmatch) { try { parsed = JSON.parse(jmatch[0]); } catch {} }

// VERIFY mechanically (knowledge-as-guard): does the cited line actually exist + is it
// executable + unique? This is the loop's most-repeated failure encoded as a deterministic
// check — caught at the SOURCE, no model, ungameable. The verdict drives BOTH the proposal
// status and the captured knowledge, so the same mistake teaches the next cycle.
const verdict = parsed
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
  }[verdict.code];
  if (guardClaim) recordKnowledge(db, { scope: KNOW_SCOPE, claim: guardClaim, kind: 'guard', confirm: true, evidence: `observed on ${fix.class}` });
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
