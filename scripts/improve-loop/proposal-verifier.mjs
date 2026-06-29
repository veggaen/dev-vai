/**
 * proposal-verifier — knowledge as EXECUTABLE GUARDS, not model prose.
 *
 * The Zig-grade objection to "AI knowledge stores": they fill with model opinions that the
 * next model averages into slop. The answer is to encode what the loop LEARNS as MECHANICAL,
 * verifiable checks. The loop's most-repeated, provable failure (recorded but never acted on)
 * is: qwen proposes a `find` line that DOES NOT EXIST in the file it claims to edit
 * ("hallucinated code that does not exist"), or edits a comment/string instead of logic.
 *
 * Those are not opinions — they are decidable. This module decides them, deterministically,
 * with no model call. A proposal that fails here is rejected at the SOURCE (cheap, ungameable),
 * the failure becomes a counted fact (knowledge), and that fact is fed back into the next
 * prompt so the mistake stops repeating. Knowledge → guard → measured behaviour change.
 *
 * Pure + I/O-light (only reads the target file), so it unit-tests with an injected reader.
 */

import { readFileSync } from 'node:fs';

/** A `find` is non-executable if it is a comment, a bare string, or empty/prose. These are
 *  the lines that "look like a fix" but change no behaviour — qwen's #2 recurring failure. */
export function isNonExecutableFind(find) {
  if (!find || typeof find !== 'string') return true;
  const t = find.trim();
  if (t.length < 3) return true;
  if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return true; // comment
  // A bare quoted string with no code around it (e.g. a log/grade message).
  if (/^["'`].*["'`],?$/.test(t)) return true;
  return false;
}

/**
 * WHITESPACE-TOLERANT RECOVERY of a near-miss `find`. The loop's most-counted lesson (×29) is the
 * model citing a `find` that isn't a VERBATIM substring — but very often it's a *near* miss: the
 * intended line exists, the model just collapsed runs of spaces, dropped indentation, or used a
 * different quote glyph. Binary-rejecting those as "hallucinated" discards landable fixes. This
 * recovers them MECHANICALLY (no model call): if the find's whitespace-normalized form matches
 * exactly ONE source line — OR one consecutive MULTI-LINE source span — return that source's EXACT
 * text. The multi-line case is the dominant real failure (measured ~33 live "hallucinated-find"
 * rejections): the model writes a wrapped declaration as ONE line, e.g. `const X = /regex/;`, but
 * the source wraps it across two lines (`const X =\n  /regex/;`). Normalising newlines reconciles
 * them. Conservative throughout — only a UNIQUE match (single- or multi-line) is recovered.
 * @returns {string|null} the exact source substring to use as find, or null if not recoverable.
 */
export function recoverFind(source, find) {
  if (typeof source !== 'string' || typeof find !== 'string') return null;
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const target = norm(find);
  if (target.length < 5) return null;            // too short to anchor safely

  const lines = source.split('\n');
  const matches = [];

  // (a) single-line match (the original, fast path) — only when the find itself is single-line.
  if (!find.includes('\n')) {
    for (const line of lines) {
      if (norm(line) === target) {
        const exact = line.trim();
        if (exact && !matches.includes(exact)) matches.push(exact);
      }
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null; // ambiguous
  }

  // (b) multi-line span match: slide a window of 2..4 consecutive source lines, normalise the JOIN,
  // and compare to the find's normalised form. Recovers a model's single-line cite of a wrapped
  // construct. Returns the EXACT multi-line source slice (verbatim, so the literal replace will hit).
  for (let span = 2; span <= 4; span++) {
    const hits = []; // every matching POSITION (not deduped) — 2 identical spans are still ambiguous
    for (let i = 0; i + span <= lines.length; i++) {
      const slice = lines.slice(i, i + span);
      if (norm(slice.join(' ')) === target) hits.push(slice.join('\n'));
    }
    if (hits.length === 1) return hits[0]; // exactly one position at the smallest span wins
    if (hits.length > 1) return null;      // ambiguous (multiple positions) — never guess
  }
  return null;
}

/**
 * Verify a proposal against the REAL file. Returns a structured verdict — never throws.
 * @param proposal {{ file, find, replace, why }}
 * @param {{ readFile?: (path)=>string }} opts  injectable reader for tests
 * @returns {{ ok:boolean, code:string, detail:string, correctedFind?:string }}
 *   code ∈ no-find | no-file | hallucinated-find | non-executable-find | noop-replace | ok
 *   correctedFind is set when a near-miss find was whitespace-recovered to its exact source text.
 */
export function verifyProposal(proposal, { readFile } = {}) {
  // ESM-safe default reader — `require` is not defined in an ES module, so the old fallback threw
  // and turned every readable proposal into a false no-file when readFile was omitted (CodeRabbit #25).
  const reader = readFile ?? ((p) => readFileSync(p, 'utf8'));
  if (!proposal || !proposal.find) return { ok: false, code: 'no-find', detail: 'proposal has no find line' };
  if (!proposal.file) return { ok: false, code: 'no-file', detail: 'proposal has no file' };

  let source = '';
  try { source = reader(proposal.file); }
  catch { return { ok: false, code: 'no-file', detail: `cannot read ${proposal.file}` }; }

  // THE core learned guard: does the cited line actually exist in the file? (hallucination)
  // Before rejecting, try a whitespace-tolerant recovery of a near-miss — this rescues the common
  // case where the line IS there but the model collapsed spacing. A recovered find is re-validated
  // below exactly like a verbatim one (uniqueness, executability, balance all still apply).
  let correctedFind = null;
  if (!source.includes(proposal.find)) {
    const recovered = recoverFind(source, proposal.find);
    if (!recovered) {
      return { ok: false, code: 'hallucinated-find', detail: `find not present in ${proposal.file} (model hallucinated the line)` };
    }
    correctedFind = recovered;
    proposal = { ...proposal, find: recovered };
  }
  // Editing a comment/string changes no behaviour.
  if (isNonExecutableFind(proposal.find)) {
    return { ok: false, code: 'non-executable-find', detail: 'find is a comment/string/prose, not decision logic' };
  }
  // A find==replace (or whitespace-only diff) is a no-op.
  if (proposal.replace != null && proposal.find.trim() === String(proposal.replace).trim()) {
    return { ok: false, code: 'noop-replace', detail: 'replace equals find (no change)' };
  }
  // Multiple matches make a literal find/replace ambiguous (apply-fix refuses these too).
  const count = source.split(proposal.find).length - 1;
  if (count > 1) {
    return { ok: false, code: 'ambiguous-find', detail: `find occurs ${count}× — not a unique anchor` };
  }
  // BALANCED-EDIT guard: a TRUNCATED find (a fragment that opens a (), [], {} or / regex it never
  // closes) corrupts the file when replaced — the old tail dangles after the new text. This is the
  // fresh-data-trigger break: find ended "…|fore", replace was the WHOLE regex, leaving "cast|…)/i;"
  // orphaned → tsc failure every time. The verifier passed it (it WAS a unique substring) but the
  // EDIT is structurally unsound. Require: applying find→replace keeps bracket/regex balance.
  if (proposal.replace != null) {
    const bal = (s) => {
      const c = { '(': 0, '[': 0, '{': 0, slash: 0 };
      for (const ch of String(s)) {
        if (ch === '(') c['(']++; else if (ch === ')') c['(']--;
        else if (ch === '[') c['[']++; else if (ch === ']') c['[']--;
        else if (ch === '{') c['{']++; else if (ch === '}') c['{']--;
        else if (ch === '/') c.slash++;
      }
      return c;
    };
    // The replaced span must have the SAME open/close delta as the find it replaces — otherwise the
    // surrounding line's brackets/regex no longer balance after the swap.
    const f = bal(proposal.find); const r = bal(proposal.replace);
    const drift = ['(', '[', '{'].some((k) => f[k] !== r[k]) || (f.slash % 2) !== (r.slash % 2);
    if (drift) {
      return { ok: false, code: 'unbalanced-edit', detail: 'find/replace change bracket or regex-delimiter balance — the edit would corrupt the surrounding code (truncated find?)' };
    }
  }
  return {
    ok: true,
    code: 'ok',
    detail: correctedFind
      ? 'find whitespace-recovered to exact source text, executable, unique, and changes the line'
      : 'find exists, is executable, unique, and changes the line',
    ...(correctedFind ? { correctedFind } : {}),
  };
}

/**
 * Roll up a window of recent proposal verdicts into the FEEDBACK the next prompt needs.
 * This is the "apply" half of the knowledge spine: the system tells the model about its OWN
 * recent, COUNTED failure modes so it stops repeating them. Returns null when there's no
 * signal yet (don't inject noise). `verdicts` are { code } objects (newest first or any order).
 * @returns {{ total, byCode, hallucinationRate, promptHint }|null}
 */
export function summarizeVerdicts(verdicts = []) {
  if (!verdicts.length) return null;
  const byCode = {};
  for (const v of verdicts) byCode[v.code] = (byCode[v.code] ?? 0) + 1;
  const total = verdicts.length;
  const hallucinated = byCode['hallucinated-find'] ?? 0;
  const nonExec = byCode['non-executable-find'] ?? 0;
  const hallucinationRate = hallucinated / total;

  // Build a SPECIFIC, evidence-bound hint — counts, not vibes (the anti-slop contract).
  const hints = [];
  if (hallucinated > 0) {
    hints.push(`${hallucinated}/${total} of your recent proposals cited a "find" line that DOES NOT EXIST in the file. Copy the find as an EXACT, verbatim substring from the SOURCE shown — do not paraphrase or reconstruct it from memory.`);
  }
  if (nonExec > 0) {
    hints.push(`${nonExec}/${total} edited a comment/string instead of logic. The find MUST be executable code (a regex const, an if(...), or a return ...).`);
  }
  if (!hints.length) return { total, byCode, hallucinationRate, promptHint: null };
  return {
    total, byCode, hallucinationRate,
    promptHint: `LEARNED FROM YOUR OWN RECENT MISTAKES (verified, counted):\n- ${hints.join('\n- ')}`,
  };
}
