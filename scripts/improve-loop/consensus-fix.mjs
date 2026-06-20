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

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DB_PATH = opt('--db', 'scripts/improve-loop/.corpus.sqlite');
const TARGET = opt('--class', 'answer/opportunity-framing');
const REPEATS = Number(opt('--repeats', '1'));
const STEPS = Number(opt('--steps', '7'));

const db = openDb(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS consensus (
  id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT, file TEXT, find TEXT, replace TEXT,
  agree_count INTEGER, personas TEXT, verified INTEGER, why TEXT, created_at TEXT);`);

const run = db.prepare('SELECT id FROM runs ORDER BY id DESC LIMIT 1').get();
const fix = db.prepare('SELECT class,location,summary FROM fixes WHERE run_id=? AND class=? LIMIT 1').get(run.id, TARGET);
const fails = db.prepare(
  'SELECT p.prompt, r.read_as, r.grade_reason FROM results r JOIN prompts p ON p.id=r.prompt_id WHERE r.run_id=? AND r.class=? AND r.passed=0 LIMIT 4',
).all(run.id, TARGET);
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
console.log(`\n━━━ consensus-fix [${TARGET}] · ${panel.length} engineers (${panel.map((p) => p.discipline ?? 'debug').join(',')}) × ${REPEATS} · ${STEPS} steps ━━━`);
const proposals = [];
for (let r = 0; r < REPEATS; r++) {
  for (const persona of panel) {
    process.stdout.write(`  ▸ ${persona.id} (round ${r + 1})… `);
    let res;
    try {
      res = await proposeGrounded({
        klass: TARGET, summary, fails, hintFile, maxSteps: STEPS,
        preamble: personaPreamble(persona, { klass: TARGET, summary }),
      });
    } catch (e) { console.log('error', String(e).slice(0, 50)); continue; }
    const p = res.proposal;
    if (!p || !p.find) { console.log('no proposal'); continue; }
    const verified = verifyFind(p.find);
    proposals.push({ persona: persona.id, file: p.file, find: norm(p.find), replace: p.replace, why: p.why, verified });
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
  console.log(`WINNER · ${group.length}/${proposals.length} agreement · personas: ${[...new Set(group.map((g) => g.persona))].join(', ')}`);
  console.log('file:', top.file);
  console.log('find:', JSON.stringify(find));
  console.log('replace:', JSON.stringify(top.replace));
  console.log('why:', top.why);
  db.prepare('INSERT INTO consensus (class,file,find,replace,agree_count,personas,verified,why,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(TARGET, top.file, find, top.replace ?? '', group.length, [...new Set(group.map((g) => g.persona))].join(','), 1, top.why ?? '', new Date().toISOString());
  console.log('\n→ saved to consensus table. Human/architect grades + applies the winner.');
}
