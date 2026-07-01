/**
 * feature-build — the instruction-driven codegen `build` effect for the feature-review protocol.
 *
 * `propose-fix.mjs` localizes a BUG for a known failure CLASS (it needs corpus tables, seed
 * failing-prompts, CLASS_LOCATION). The feature-review protocol needs something more general: given
 * a plain INSTRUCTION and a target FILE, ground the local model in the real source and produce the
 * SAME artifact shape propose-fix does — `{ file, find, replace, diff, summary, sourceExcerpt }` —
 * so the pure review protocol (self-match → peer review → integrate) can act on it.
 *
 * The grounding logic (excerpt-scoping around a line/keyword, enclosing-function isolation, the
 * line-number "point at the line, we copy it verbatim" anti-corruption trick) is lifted from
 * propose-fix's PROVEN implementation, but here it is pure + I/O-injected so every piece is
 * unit-testable without a model or a real filesystem. Orchestration (the real model call, VRAM
 * guard) lives in feature-review-run.mjs.
 *
 * SAFETY: this only PRODUCES a candidate artifact. It never writes source. The verify gate
 * (proposal-verifier) + the review protocol + the branch-guarded apply path decide if it lands.
 */

import { parseProposal } from './parse-proposal.mjs';
import { verifyProposal } from './proposal-verifier.mjs';

export const EXCERPT_WINDOW = 150;

/** Split a location string like "service.ts:526" into { file, line } (line may be null).
 *  Windows-safe: only a TRAILING ":<digits>" is treated as the line — a drive letter like "C:/..."
 *  is preserved in `file` (splitting on every ':' truncated "C:/Users/..." to "C"). */
export function parseTargetLocation(location = '') {
  const s = String(location).trim();
  const lineHint = /:(\d+)\s*$/.exec(s);
  const line = lineHint ? Number(lineHint[1]) : null;
  // Strip only the trailing ":<line>" (if any); everything before it is the file path.
  const file = (lineHint ? s.slice(0, lineHint.index) : s).trim();
  return { file, line };
}

/**
 * Find the enclosing function/const-arrow around a center line so the model can only edit the RIGHT
 * one (a flat window sweeps in neighbours → wrong-target edits, measured in propose-fix). Returns a
 * [start, end) line range (0-based indices) or null when it can't bound a function. Pure over `lines`.
 */
export function enclosingFunction(lines, centerIdx) {
  const DECL = /^\s*(?:export\s+)?(?:async\s+)?(?:function\b|const\s+\w+\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|\w+\s*=>)|\w+\s*\([^)]*\)\s*[:{])/;
  let declIdx = -1;
  for (let i = Math.min(centerIdx, lines.length - 1); i >= 0 && i > centerIdx - 200; i--) {
    if (DECL.test(lines[i])) { declIdx = i; break; }
  }
  if (declIdx < 0) return null;
  let depth = 0; let seenOpen = false; let endIdx = -1;
  for (let i = declIdx; i < lines.length && i < declIdx + 220; i++) {
    for (const ch of lines[i]) { if (ch === '{') { depth++; seenOpen = true; } else if (ch === '}') depth--; }
    if (seenOpen && depth <= 0) { endIdx = i; break; }
  }
  if (endIdx < 0 || endIdx - declIdx < 1) return null;
  return { start: declIdx, end: endIdx + 1 };
}

/**
 * Choose the source excerpt to show the model, keyed to (in priority order): an explicit :line hint
 * (prefer its enclosing function when reasonably sized), else the best keyword match for the
 * instruction, else the file head. Returns { text, startLine, endLine } with REAL 1-based line
 * numbers prefixed on each line (so the model can point at a line and we copy it verbatim). Pure.
 */
export function selectExcerpt(source, { instruction = '', line = null, window = EXCERPT_WINDOW } = {}) {
  const lines = String(source).split('\n');
  let centerIdx = -1;
  if (line != null && Number.isInteger(line)) centerIdx = Math.max(0, line - 1);
  if (centerIdx < 0) {
    const terms = keywordTerms(instruction);
    let best = -1; let bestIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      const score = terms.reduce((s, t) => s + (low.includes(t) ? 1 : 0), 0);
      if (score > best) { best = score; bestIdx = i; }
    }
    if (best > 0) centerIdx = bestIdx;
  }
  // Enclosing function when we have a precise line and the function is a sane size.
  if (line != null && centerIdx >= 0) {
    const r = enclosingFunction(lines, centerIdx);
    if (r && (r.end - r.start) <= window) {
      return { text: numbered(lines, r.start, r.end), startLine: r.start + 1, endLine: r.end, scope: 'function' };
    }
  }
  if (centerIdx >= 0 && lines.length > window) {
    const start = Math.max(0, centerIdx - Math.floor(window / 2));
    const end = Math.min(lines.length, start + window);
    return { text: numbered(lines, start, end), startLine: start + 1, endLine: end, scope: 'window' };
  }
  const end = Math.min(lines.length, window);
  return { text: numbered(lines, 0, end), startLine: 1, endLine: end, scope: 'head' };
}

/**
 * Build the instruction-driven codegen prompt. Unlike propose-fix (bug + failing cases), this asks
 * the model to make a MINIMAL, precise change that fulfils an INSTRUCTION, grounded in the real
 * excerpt. Same strict JSON contract + the findLine anti-corruption trick.
 */
export function buildFeaturePrompt({ instruction, file, excerpt, learned = [] } = {}) {
  const learnedBlock = learned.length
    ? `\nLEARNED (verified facts from past cycles — heed them):\n${learned.map((k) => `- ${k}`).join('\n')}\n`
    : '';
  return (
    `You are making a precise, MINIMAL change to a TypeScript/JavaScript codebase to fulfil a request.\n\n` +
    `REQUEST: ${instruction}\n` +
    learnedBlock +
    `\nACTUAL SOURCE (${file} — the relevant excerpt; line numbers are REAL, quote a "find" only from these lines):\n` +
    `\`\`\`typescript\n${excerpt.text}\n\`\`\`\n\n` +
    `RULES (most changes fail by ignoring these):\n` +
    `- Change the smallest amount of REAL code that satisfies the request. Prefer one line/statement.\n` +
    `- The "find" must be a COMPLETE line/statement copied verbatim from the excerpt — never a partial line.\n` +
    `- If you must add code, "find" an existing anchor line and put the anchor + your new code in "replace".\n` +
    `- "replace" must keep balanced brackets () [] {} and the same count of \`/\` as any regex in "find".\n\n` +
    `Respond with ONLY a JSON object, no prose:\n` +
    `{"file":"${file}","findLine":<the REAL line number from the excerpt of the line to anchor on>,"find":"<that exact line copied verbatim>","replace":"<the new code>","why":"<one sentence: how this fulfils the request>"}\n` +
    `CRITICAL: set "findLine" to the \`N:\` number of the anchor line — we copy that exact line for you so you cannot corrupt it. Still fill "find" as a cross-check. "replace" must differ from "find".`
  );
}

/**
 * Turn a raw model reply into a verified artifact for the review protocol. Parses the JSON, applies
 * the line-number grounding (copy the real source line the model pointed at, don't trust its
 * retype), verifies mechanically (find exists / executable / unique), and shapes the artifact.
 * Returns { ok, artifact, verdict, reason }. Pure over injected `readFile` + the raw string.
 */
export function shapeArtifact(raw, { source, excerpt, readFile } = {}) {
  const parsed = parseProposal(raw);
  if (!parsed) return { ok: false, verdict: { code: 'no-json' }, reason: 'model produced no parseable JSON' };

  // LINE-NUMBER GROUNDING: if the model cited a findLine inside the excerpt, copy that exact source
  // line (deterministic) instead of trusting its retype — the #1 anti-corruption move from propose-fix.
  if (parsed.findLine != null && source != null) {
    const lines = String(source).split('\n');
    const ln = Number(parsed.findLine);
    if (Number.isInteger(ln) && ln >= excerpt.startLine && ln <= excerpt.endLine && ln <= lines.length) {
      const exact = lines[ln - 1];
      if (exact && exact.trim()) parsed.find = exact.trim();
    }
  }

  const verify = readFile ? verifyProposal(parsed, { readFile }) : { ok: true, detail: 'verify skipped (no readFile)' };
  if (!verify.ok) return { ok: false, verdict: verify, reason: `${verify.code}: ${verify.detail}`, parsed };

  const findText = verify.correctedFind ?? parsed.find;
  const artifact = {
    file: parsed.file,
    find: findText,
    replace: parsed.replace,
    diff: renderDiff(findText, parsed.replace),
    summary: parsed.why ?? '',
    sourceExcerpt: excerpt.text,
    why: parsed.why ?? '',
  };
  return { ok: true, artifact, verdict: verify };
}

/**
 * The end-to-end build: read the file, select an excerpt, prompt the (injected) model, shape +
 * verify the artifact. `generate(prompt)` and `readFile(path)` are injected so this is testable and
 * so the caller owns the VRAM guard / model choice. Returns { ok, artifact, reason }.
 */
export async function buildFeatureArtifact({ instruction, location, learned = [] }, { generate, readFile } = {}) {
  if (!instruction || !location) return { ok: false, reason: 'instruction and location are required' };
  const { file, line } = parseTargetLocation(location);
  let source;
  try { source = readFile(file); }
  catch (e) { return { ok: false, reason: `could not read ${file}: ${String(e).slice(0, 80)}` }; }
  if (!source || !String(source).trim()) return { ok: false, reason: `no readable source at ${file}` };

  const excerpt = selectExcerpt(source, { instruction, line });
  const prompt = buildFeaturePrompt({ instruction, file, excerpt, learned });
  let raw = '';
  try { raw = await generate(prompt); }
  catch (e) { return { ok: false, reason: `model unavailable: ${String(e).slice(0, 80)}` }; }

  const shaped = shapeArtifact(raw, { source, excerpt, readFile });
  if (!shaped.ok) return { ok: false, reason: shaped.reason, raw: raw.slice(0, 500) };
  return { ok: true, artifact: shaped.artifact, verdict: shaped.verdict };
}

// ── pure helpers ────────────────────────────────────────────────────────────────
function numbered(lines, start, end) {
  return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
}
function keywordTerms(text) {
  return [...new Set((String(text).toLowerCase().match(/[a-z]{4,}/g) || []))]
    .filter((t) => !STOP.has(t));
}
function renderDiff(find, replace) {
  return `- ${find}\n+ ${replace}`;
}
const STOP = new Set([
  'this', 'that', 'with', 'from', 'into', 'when', 'where', 'which', 'should', 'about', 'these',
  'their', 'there', 'would', 'could', 'make', 'want', 'need', 'have', 'them', 'then', 'than',
  'code', 'file', 'line', 'change', 'function', 'feature', 'request', 'they', 'your', 'here',
]);
