#!/usr/bin/env node
/**
 * consensus-fix — many grounded rounds, many expert personas, keep only the
 * patch the experts AGREE on AND that is REAL.
 *
 * Pipeline per failure class:
 *   for each persona (× repeats): run the grounded tool-loop → a proposal
 *   → VERIFY each proposal's "find" actually exists in the real file (grep)
 *   → CLUSTER verified proposals by the line they touch
 *   → the winning patch is the most-agreed, verified cluster
 *
 * Why this beats one prompt: a single 8B call is a noisy guess. Independent
 * expert framings that CONVERGE on the same real line is consensus signal; a
 * patch only one persona invented (or that fails grep-verify) is discarded as
 * hallucination. Universally-good = survives diverse framing + is grounded.
 *
 * Still PROPOSE-only. The winner is graded + applied by the human/architect gate.
 *
 * Usage:
 *   node scripts/improve-loop/consensus-fix.mjs --class answer/opportunity-framing
 *   node scripts/improve-loop/consensus-fix.mjs --class routing/build-verb-poison --repeats 2 --steps 7
 */
import { openDb } from './db.mjs';
import { proposeGrounded } from './agent.mjs';
import { selectPersonas, personaPreamble } from './personas.mjs';
import { grep_repo } from './tools.mjs';
import { installedModels } from './driver.mjs';
import { pickRoster, assignRoles, proposers } from './model-router.mjs';
import { verifyProposal } from './proposal-verifier.mjs';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DB_PATH = opt('--db', 'scripts/improve-loop/.corpus.sqlite');
const TARGET = opt('--class', 'answer/opportunity-framing');
const REPEATS = Number(opt('--repeats', '1'));
const STEPS = Number(opt('--steps', '7'));
// Multi-model roundtable: route personas across DIFFERENT installed models (biggest-first, each
// within the VRAM budget). Cross-MODEL agreement is far stronger than one model repeating itself —
// one model's truncated regex is another's clean line. --vram-gb caps which models are eligible.
const VRAM_GB = Number(opt('--vram-gb', '8.5'));
const MAX_MODELS = Number(opt('--models', '3'));

const db = openDb(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS consensus (
  id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT, file TEXT, find TEXT, replace TEXT,
  agree_count INTEGER, personas TEXT, verified INTEGER, why TEXT, created_at TEXT);`);

const run = db.prepare('SELECT id FROM runs ORDER BY id DESC LIMIT 1').get();
// CROSS-RUN lookup (same fix propose-fix.mjs already has): observe rarely wins the compute budget,
// so the latest run usually has no fixes/results for the class. Run-scoping here starved the whole
// consensus→apply stage — verified proposals piled up but never converged ("no queued failure").
// Use the latest fix + failing cases for THIS class across ALL runs so the pipeline can flow.
const fix = db.prepare('SELECT class,location,summary FROM fixes WHERE class=? ORDER BY id DESC LIMIT 1').get(TARGET);
const fails = db.prepare(
  'SELECT p.prompt, r.read_as, r.grade_reason FROM results r JOIN prompts p ON p.id=r.prompt_id WHERE r.class=? AND r.passed=0 ORDER BY r.run_id DESC LIMIT 4',
).all(TARGET);
if (!fix || fails.length === 0) { console.log('no queued failure for', TARGET); process.exit(0); }
const hintFile = (fix.location.split(/[:\s(]/)[0] || '').trim();
const summary = fix.summary;

/** Normalise a code line for clustering (collapse whitespace). */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** FULL verification gate (not just "does the line exist"): the find must exist, be executable,
 *  unique, AND the find→replace edit must keep bracket/regex balance — so a TRUNCATED find (the
 *  recurring fresh-data-trigger break: find ended "…|fore", replace was the whole regex) is rejected
 *  HERE, at consensus, instead of slipping through as verified=1 and failing tsc at apply. Falls back
 *  to a grep-only check when there's no replace yet (proposal stage). */
function verifyEdit(file, find, replace) {
  if (!find || find.length < 6) return false;
  if (file && replace != null) {
    try {
      const v = verifyProposal({ file, find, replace }, { readFile: (p) => readFileSync(p, 'utf8') });
      return v.ok;
    } catch { /* fall through to grep check */ }
  }
  const esc = norm(find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 80);
  const hits = grep_repo(esc, { glob: '**/*.ts' });
  return hits !== '(no matches)' && !hits.startsWith('(error');
}

const panel = selectPersonas(TARGET);
// Build the model roster (VRAM-eligible, biggest-first). Fall back to a single default if Ollama
// is unreachable, so the loop still works offline-ish. Each persona gets a model by rotation, so
// the panel is a DIVERSE set of models, not one model wearing hats.
const installed = await installedModels().catch(() => []);
const roster = pickRoster(installed, { budgetBytes: VRAM_GB * 1024 ** 3, max: MAX_MODELS });
// Role-by-strength (default ALL seated, configurable): coders/general PROPOSE via the tool-loop;
// reasoning models (deepseek-r1) are bad/slow at the loop, so they JUDGE instead. We run the
// proposers here; the judges' role (best-answer vote) kicks in below when there's no clean winner.
const roles = assignRoles(roster);
const proposeModels = proposers(roles);
const models = proposeModels.length ? proposeModels : (roster.length ? roster : [undefined]);
const rosterRank = (m) => { const i = models.indexOf(m); return i < 0 ? 99 : i; }; // bigger/earlier = lower
const judgeModels = roles.filter((r) => r.role === 'judge').map((r) => r.name);

console.log(`\n━━━ consensus-fix [${TARGET}] · roles: ${roles.map((r) => `${r.name}→${r.role}`).join(', ') || 'default'} ━━━`);
console.log(`   proposers (tool-loop): [${models.map((m) => m ?? 'default').join(', ')}]${judgeModels.length ? ` · judges: [${judgeModels.join(', ')}]` : ''}`);
const proposals = [];
// SEED from EXISTING verified proposals (the propose-fix step already produced + verified these and
// they sit in the `proposals` table). Re-rolling the council from scratch every cycle threw that
// work away — and a single noisy 8B round often yields 0 verified proposals → "No verified
// consensus" → nothing ever applies (the loop never lands a fix). Seeding gives consensus a real
// starting set; each is RE-verified against current source (a proposal can go stale if the file
// changed). Found by grading the live loop: 2 applyable proposals sat unused while consensus re-rolled.
try {
  const prior = db.prepare(
    "SELECT file, find, \"replace\", why FROM proposals WHERE class=? AND status='proposed' ORDER BY id DESC LIMIT 12",
  ).all(TARGET);
  const seen = new Set();
  for (const p of prior) {
    const key = `${norm(p.find)}|${p.replace}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const verified = verifyEdit(p.file, norm(p.find), p.replace);
    if (verified) {
      proposals.push({ persona: 'prior-verified', model: 'propose-fix', file: p.file, find: norm(p.find), replace: p.replace, why: p.why, verified: true });
    }
  }
  if (proposals.length) console.log(`   seeded ${proposals.length} prior-verified proposal(s) from the proposals table (re-verified)`);
} catch { /* no proposals table yet — proceed with fresh rounds only */ }

const seededCount = proposals.length;
// WALL-CLOCK BOUND for the council (the stall fix, applied to consensus like observe): a single
// hung 8B tool-loop call froze the whole loop for minutes (measured live: stuck on persona round 1
// with no timeout firing). Cap total council wall-time; stop STARTING new persona rounds past it.
const COUNCIL_MS = Math.max(0, Number(opt('--council-ms', String(4 * 60_000))) || 0);
// SEED SHORT-CIRCUIT: if seeds already gave us verified proposals, we don't NEED a full 6-persona
// council — run a small diversity sample, not the whole panel. This is the difference between a
// 6-10 min consensus (often hanging) and a fast one that converges on what the loop already verified.
const personaCap = seededCount >= 1 ? Math.min(2, panel.length) : panel.length;
const councilStart = Date.now();
let councilStopped = false;
for (let r = 0; r < REPEATS && !councilStopped; r++) {
  for (let i = 0; i < personaCap; i++) {
    if (COUNCIL_MS > 0 && Date.now() - councilStart >= COUNCIL_MS) {
      console.log(`   ⏱ council wall-clock budget reached (${Math.round(COUNCIL_MS / 60000)}m) — proceeding with ${proposals.filter((p) => p.verified).length} verified proposal(s)`);
      councilStopped = true; break;
    }
    const persona = panel[i];
    const model = models[i % models.length]; // rotate models across personas → cross-model diversity
    process.stdout.write(`  ▸ ${persona.id} @ ${model ?? 'default'} (round ${r + 1})… `);
    let res;
    try {
      // PER-PERSONA TIMEOUT: a tool-loop call can hang indefinitely (measured: stuck on round 1 with
      // no internal timeout). Race it against a hard deadline so ONE slow model can't freeze the loop;
      // a timed-out persona just contributes nothing (we still have seeds + the others).
      const PERSONA_MS = Math.max(30_000, Number(opt('--persona-ms', '90000')) || 90_000);
      res = await Promise.race([
        proposeGrounded({
          klass: TARGET, summary, fails, hintFile, maxSteps: STEPS, model,
          preamble: personaPreamble(persona, { klass: TARGET, summary }),
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`persona timeout ${PERSONA_MS}ms`)), PERSONA_MS)),
      ]);
    } catch (e) { console.log('error', String(e).slice(0, 50)); continue; }
    const p = res.proposal;
    if (!p || !p.find) { console.log('no proposal'); continue; }
    const verified = verifyEdit(p.file, norm(p.find), p.replace);
    proposals.push({ persona: persona.id, model: model ?? 'default', file: p.file, find: norm(p.find), replace: p.replace, why: p.why, verified });
    console.log(`proposed ${verified ? '✓verified' : '✗unverified'}: ${norm(p.find).slice(0, 50)}`);
  }
}

// Cluster verified proposals by the line they touch.
const clusters = new Map();
for (const p of proposals.filter((x) => x.verified)) {
  const key = p.find.slice(0, 80);
  if (!clusters.has(key)) clusters.set(key, []);
  clusters.get(key).push(p);
}
const ranked = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length);

console.log('\n━━━ RESULT ━━━');
if (ranked.length === 0) {
  console.log('No verified consensus. ' + (proposals.length ? proposals.length + ' proposals, none survived grep-verify (likely hallucinated lines).' : 'No proposals at all (hard bug — honest punt).'));
  // JUDGE ROLE: give the reasoning model(s) a real voice — let them weigh the unverified candidates
  // and name the most promising one for a human. Advisory ONLY: a candidate still has to pass
  // grep-verify + tsc before anything applies. This is how every model contributes by its strength.
  if (judgeModels.length && proposals.length) {
    try {
      const { buildBestAnswerVote, parseBestVote } = await import('./model-router.mjs');
      const { ollamaGenerate } = await import('./driver.mjs');
      const cands = proposals.map((p) => ({ model: p.model, summary: `${p.find.slice(0, 60)} → ${String(p.replace).slice(0, 60)}` }));
      const votePrompt = buildBestAnswerVote(`${TARGET}: ${summary}`, cands);
      const judge = judgeModels[0];
      const raw = await ollamaGenerate(judge, votePrompt, { numPredict: 200, timeoutMs: 120000, think: false });
      const vote = parseBestVote(raw, cands.length);
      if (vote) console.log(`⚖️  judge [${judge}] favours candidate #${vote.best} (${cands[vote.best - 1]?.model}): ${vote.why}`);
    } catch { /* judging is best-effort; never blocks */ }
  }
  console.log('→ This is a SIGNAL: the bug needs human analysis, not more qwen rounds.');
} else {
  const [, group] = ranked[0];
  const top = group[0];
  // CRITICAL: store the WINNER's ACTUAL full find (top.find), NOT the cluster KEY (which was
  // find.slice(0,80) for grouping only). Storing the 80-char-truncated key was the apply-time
  // revert bug: a truncated find ends mid-regex → unbalanced parens/slashes → tsc fails → revert
  // every cycle, even though the model's real proposal was clean and verified. (Found by grading
  // the live loop: routing/comparison reverted-red twice on a find cut at "…|\\bdiffer".)
  const find = top.find;
  // RE-VERIFY the exact (find, replace) we are about to store — it must pass the full mechanical
  // gate (exists, executable, unique, balanced). Only mark verified=1 when it genuinely is, so a
  // truncated/unbalanced patch can never reach apply-consensus as "verified".
  const finalVerdict = verifyProposal({ file: top.file, find, replace: top.replace ?? '' }, { readFile: (p) => readFileSync(p, 'utf8') });
  // If the verifier whitespace-recovered a near-miss find to its EXACT source text, store THAT —
  // otherwise the model's slightly-off find would fail the literal apply-time replace and revert.
  const storedFind = finalVerdict.correctedFind ?? find;
  const distinctModels = [...new Set(group.map((g) => g.model ?? 'default'))];
  console.log(`WINNER · ${group.length}/${proposals.length} agreement · ${distinctModels.length} distinct model(s): ${distinctModels.join(', ')} · personas: ${[...new Set(group.map((g) => g.persona))].join(', ')}`);
  console.log('file:', top.file);
  console.log('find:', JSON.stringify(storedFind) + (finalVerdict.correctedFind ? ' (whitespace-recovered from the model\'s near-miss)' : ''));
  console.log('replace:', JSON.stringify(top.replace));
  console.log('why:', top.why);
  if (!finalVerdict.ok) {
    console.log(`\n⛔ winner FAILED final verification (${finalVerdict.code}: ${finalVerdict.detail}) — NOT saved (would revert at apply). The bug needs human analysis.`);
  } else {
    db.prepare('INSERT INTO consensus (class,file,find,replace,agree_count,personas,verified,why,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(TARGET, top.file, storedFind, top.replace ?? '', group.length, [...new Set(group.map((g) => g.persona))].join(','), 1, top.why ?? '', new Date().toISOString());
    console.log('\n→ saved to consensus table (re-verified). apply-consensus applies the winner.');
  }
}
