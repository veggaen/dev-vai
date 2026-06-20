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
import { openDb } from './db.mjs';
import { ollamaGenerate, waitForVramHeadroom } from './driver.mjs';

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
const fix = db.prepare(
  `SELECT id,class,location,summary FROM fixes WHERE run_id=? ${TARGET_CLASS ? 'AND class=?' : ''} ORDER BY failure_count DESC LIMIT 1`,
).get(...(TARGET_CLASS ? [run.id, TARGET_CLASS] : [run.id]));
if (!fix) { console.log('no queued fix for that class'); process.exit(0); }

// Pull the failing prompts + how Vai read them — qwen needs the evidence.
const fails = db.prepare(
  `SELECT p.prompt, r.read_as, r.grade_reason FROM results r JOIN prompts p ON p.id=r.prompt_id
   WHERE r.run_id=? AND r.class=? AND r.passed=0`,
).all(run.id, fix.class);

// Ground qwen in the REAL file at the candidate location.
const filePath = (fix.location.split(/[:\s(]/)[0] || '').trim();
let source = '';
try { source = readFileSync(filePath, 'utf8'); } catch { source = '(could not read ' + filePath + ')'; }
// Keep it within context: head of file (where the regexes/guards live).
const sourceExcerpt = source.split('\n').slice(0, 130).map((l, i) => `${i + 1}: ${l}`).join('\n');

const prompt =
`You are fixing a bug in a TypeScript codebase. Be precise and minimal.

FAILURE CLASS: ${fix.class}
SYMPTOM: ${fix.summary}

FAILING CASES (prompt → how the AI wrongly read/answered it):
${fails.map((f) => `- "${f.prompt}" → read:"${f.read_as ?? '?'}" → ${f.grade_reason}`).join('\n')}

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

db.prepare(`INSERT INTO proposals (fix_id,class,file,find,replace,why,raw,created_at) VALUES (?,?,?,?,?,?,?,?)`)
  .run(fix.id, fix.class, parsed?.file ?? filePath, parsed?.find ?? null, parsed?.replace ?? null, parsed?.why ?? null, raw.slice(0, 2000), new Date().toISOString());

console.log('\n━━━ qwen proposal ['+fix.class+'] ━━━');
if (parsed) {
  console.log('file:', parsed.file);
  console.log('find:', JSON.stringify(parsed.find));
  console.log('replace:', JSON.stringify(parsed.replace));
  console.log('why:', parsed.why);
} else {
  console.log('(could not parse JSON; raw saved)\n', raw.slice(0, 600));
}
console.log('\n→ saved to proposals table (status=proposed). Human/architect grades next.');
