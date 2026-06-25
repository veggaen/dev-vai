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
import { pickRoster } from './model-router.mjs';

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

/** Does this exact code line really exist in the repo? (grounding gate) */
function verifyFind(find) {
  if (!find || find.length < 6) return false;
  // escape regex specials so we match the literal line
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
const models = roster.length ? roster : [undefined]; // undefined → proposeGrounded uses its default
const rosterRank = (m) => { const i = models.indexOf(m); return i < 0 ? 99 : i; }; // bigger/earlier = lower

console.log(`\n━━━ consensus-fix [${TARGET}] · ${panel.length} engineers × ${models.length} model(s) [${models.map((m) => m ?? 'default').join(', ')}] · ${STEPS} steps ━━━`);
const proposals = [];
for (let r = 0; r < REPEATS; r++) {
  for (let i = 0; i < panel.length; i++) {
    const persona = panel[i];
    const model = models[i % models.length]; // rotate models across personas → cross-model diversity
    process.stdout.write(`  ▸ ${persona.id} @ ${model ?? 'default'} (round ${r + 1})… `);
    let res;
    try {
      res = await proposeGrounded({
        klass: TARGET, summary, fails, hintFile, maxSteps: STEPS, model,
        preamble: personaPreamble(persona, { klass: TARGET, summary }),
      });
    } catch (e) { console.log('error', String(e).slice(0, 50)); continue; }
    const p = res.proposal;
    if (!p || !p.find) { console.log('no proposal'); continue; }
    const verified = verifyFind(p.find);
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
  console.log('→ This is a SIGNAL: the bug needs human analysis, not more qwen rounds.');
} else {
  const [find, group] = ranked[0];
  const top = group[0];
  const distinctModels = [...new Set(group.map((g) => g.model ?? 'default'))];
  console.log(`WINNER · ${group.length}/${proposals.length} agreement · ${distinctModels.length} distinct model(s): ${distinctModels.join(', ')} · personas: ${[...new Set(group.map((g) => g.persona))].join(', ')}`);
  console.log('file:', top.file);
  console.log('find:', JSON.stringify(find));
  console.log('replace:', JSON.stringify(top.replace));
  console.log('why:', top.why);
  db.prepare('INSERT INTO consensus (class,file,find,replace,agree_count,personas,verified,why,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(TARGET, top.file, find, top.replace ?? '', group.length, [...new Set(group.map((g) => g.persona))].join(','), 1, top.why ?? '', new Date().toISOString());
  console.log('\n→ saved to consensus table. Human/architect grades + applies the winner.');
}
