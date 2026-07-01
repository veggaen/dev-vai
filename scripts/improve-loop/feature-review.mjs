/**
 * feature-review — the Council's peer-review protocol for a FEATURE it built (not a one-line fix).
 *
 * The existing review-gate is a SINGLE reviewer scoring a find/replace. A feature the council
 * builds is bigger (new function / multi-line change / new file) and V3gga's contract is stricter:
 *
 *   1. SELF-MATCH   — re-read the built change and score whether it actually does what the
 *                     ORIGINAL instruction asked (did we build the thing we set out to build?).
 *   2. PEER REVIEW  — the OTHER council members (persona lenses) each vote accept/reject WITH a
 *                     reason AND concrete change-tips. Aggregation biases toward MODERNIZATION +
 *                     FUTURISTIC SCALE (an explicit scoring axis, not a vibe).
 *   3. DECIDE       — not a boolean:
 *        · accept                       → integrate.
 *        · reject (1st time)            → REBUILD using the collected reasons + tips, re-review.
 *        · reject (2nd time)            → re-collect reasons + ask each peer the extra question
 *                                         "should we keep chasing this idea?". If ALL say stop →
 *                                         SHELVE.
 *   4. SHELVE       — the council agrees a SHORT TOKENIZED summary (a memory-optimised fingerprint)
 *                     of the rejected idea, stored on the rejected-ideas knowledge shelf so a future
 *                     similar message can PULL it ("we tried this; here's why it failed"). Discarded
 *                     is NOT forgotten — a shelved idea can be REVIVED when several members later
 *                     flag that new knowledge makes it valid again.
 *
 * This module is PURE + I/O-free at its core (scoring, aggregation, the state machine, the
 * fingerprint). The model calls and the DB are INJECTED so every branch is unit-testable without a
 * GPU. Orchestration (which real model, VRAM guard, the actual rebuild) lives in the caller.
 */

import { createHash } from 'node:crypto';

// A peer vote clears as ACCEPT at or above this soundness score [0..1]. Slightly stricter than the
// single-fix gate (0.6): a whole feature landing autonomously deserves a higher bar than a one-liner.
export const PEER_ACCEPT_SCORE = 0.62;

// The council-level decision needs a MAJORITY of peers to accept AND the modernization/scale axis
// to clear its own floor — a feature that works but entrenches a legacy pattern should not sail
// through just because it's locally correct. Tuned so one grumpy peer can't veto, but a split does.
export const COUNCIL_ACCEPT_RATIO = 0.6;
export const MODERN_SCALE_FLOOR = 0.5;

// Shelf revival: a rejected idea is only reconsidered once its knowledge-shelf confidence climbs
// back above this floor (members re-flagging "new knowledge makes this valid" bump confirmations).
// Same floor topKnowledge uses so a revived idea is one the store would actually surface.
export const REVIVAL_CONFIDENCE_FLOOR = 0.5;

/**
 * Build the SELF-MATCH prompt: does the built change satisfy the ORIGINAL instruction? This is the
 * "re-read its own creation and match it up with the initial instructions" step. Asks for a strict
 * parseable verdict so we can decide deterministically.
 */
export function buildSelfMatchPrompt({ instruction, built } = {}) {
  const b = built ?? {};
  return (
    `You built a change. RE-READ it and judge whether it actually does what was ASKED.\n\n` +
    `ORIGINAL INSTRUCTION:\n${instruction ?? '(none given)'}\n\n` +
    `WHAT YOU BUILT:\n` +
    `  file:    ${b.file ?? '(unknown)'}\n` +
    (b.summary ? `  summary: ${b.summary}\n` : '') +
    `  change:\n${indent(b.diff ?? b.replace ?? '(no diff captured)', 4)}\n\n` +
    `Judge ONLY: does this change fulfil the original instruction, without scope-creep or leaving\n` +
    `the asked-for behaviour unbuilt? Respond in EXACTLY this format, nothing else:\n` +
    `MATCH: <yes|partial|no>\n` +
    `SCORE: <0.0-1.0>\n` +
    `GAP: <one sentence naming what, if anything, is still unbuilt, or "none">`
  );
}

/** Parse the self-match verdict. parsed=false when no SCORE was readable → caller treats as
 *  indeterminate (proceed to peer review; don't let a format hiccup block on its own). */
export function parseSelfMatch(raw) {
  const s = String(raw ?? '');
  const match = pick(s, /MATCH:\s*(yes|partial|no)/i);
  let score = numPick(s, /SCORE:\s*([0-9]*\.?[0-9]+)/i);
  const gap = linePick(s, /GAP:\s*(.+?)(?:\n|$)/i);
  if (score == null || !Number.isFinite(score) || score < 0 || score > 1) {
    return { match, score: null, gap, parsed: false };
  }
  return { match, score, gap, parsed: true };
}

/**
 * Build a PEER prompt for one persona lens. Each peer votes accept/reject with a reason and
 * concrete change-tips, AND scores modernization + scale so the aggregate can bias toward
 * futuristic, scalable design (V3gga's explicit steer).
 */
export function buildPeerPrompt(persona, { instruction, built, sourceExcerpt } = {}) {
  const b = built ?? {};
  return (
    `You are ${persona?.title ?? 'a senior engineer'}.\n` +
    `Review a feature ANOTHER member just built, through your lens:\n${persona?.lens ?? ''}\n\n` +
    `ORIGINAL INSTRUCTION:\n${instruction ?? '(none)'}\n\n` +
    (sourceExcerpt ? `SURROUNDING SOURCE:\n\`\`\`\n${sourceExcerpt}\n\`\`\`\n\n` : '') +
    `THE BUILT FEATURE:\n  file: ${b.file ?? '(unknown)'}\n${b.summary ? `  summary: ${b.summary}\n` : ''}  change:\n${indent(b.diff ?? b.replace ?? '(no diff)', 4)}\n\n` +
    `Judge it. Bias toward MODERN, FUTURE-PROOF, SCALABLE design — reject a change that works but\n` +
    `entrenches a legacy pattern or won't scale. Respond in EXACTLY this format, nothing else:\n` +
    `VERDICT: <accept|reject>\n` +
    `SCORE: <0.0-1.0>\n` +
    `MODERN: <0.0-1.0>\n` +
    `SCALE: <0.0-1.0>\n` +
    `REASON: <one sentence: why accept or reject>\n` +
    `TIP: <one concrete change you would make, or "none">`
  );
}

/** Parse one peer's reply into a structured vote. Tolerant of stray prose (models add it). */
export function parsePeerVote(personaId, raw) {
  const s = String(raw ?? '');
  const verdict = pick(s, /VERDICT:\s*(accept|reject)/i);
  const score = numPick(s, /SCORE:\s*([0-9]*\.?[0-9]+)/i);
  const modern = numPick(s, /MODERN:\s*([0-9]*\.?[0-9]+)/i);
  const scale = numPick(s, /SCALE:\s*([0-9]*\.?[0-9]+)/i);
  const reason = linePick(s, /REASON:\s*(.+?)(?:\n|$)/i);
  const tip = linePick(s, /TIP:\s*(.+?)(?:\n|$)/i);
  const inRange = (n) => n != null && Number.isFinite(n) && n >= 0 && n <= 1;
  const parsed = verdict != null && inRange(score);
  return {
    personaId,
    verdict: verdict ?? null,
    score: inRange(score) ? score : null,
    modern: inRange(modern) ? modern : null,
    scale: inRange(scale) ? scale : null,
    reason: reason || null,
    tip: tip && !/^none$/i.test(tip) ? tip : null,
    parsed,
  };
}

/**
 * Aggregate peer votes into a council verdict. The algorithm (V3gga's steer):
 *   - consider HOW MANY peers reject and WHY (reasons carried through, never dropped).
 *   - bias for modernization + futuristic scale: the mean modern/scale of the votes must clear
 *     MODERN_SCALE_FLOOR even if a bare majority accepts.
 *   - ACCEPT requires accept-ratio ≥ COUNCIL_ACCEPT_RATIO AND modernScale ≥ floor.
 * Only PARSED votes count toward the tally; unparsed ones are surfaced but don't sway the ratio
 * (an unreadable reply is not a vote). Returns the full breakdown so the caller can log/act on it.
 */
export function aggregatePeerVotes(votes, { acceptRatio = COUNCIL_ACCEPT_RATIO, modernScaleFloor = MODERN_SCALE_FLOOR } = {}) {
  const parsed = votes.filter((v) => v.parsed);
  const accepts = parsed.filter((v) => v.verdict === 'accept' && (v.score ?? 0) >= PEER_ACCEPT_SCORE);
  const rejects = parsed.filter((v) => !(v.verdict === 'accept' && (v.score ?? 0) >= PEER_ACCEPT_SCORE));
  const ratio = parsed.length ? accepts.length / parsed.length : 0;
  const modernScale = mean(parsed.flatMap((v) => [v.modern, v.scale].filter((n) => n != null)));
  // Decision: majority accept AND the design is modern/scalable enough. A high accept-ratio with a
  // low modern/scale mean is HELD — locally-correct but future-fragile is exactly what we gate.
  const accept = parsed.length > 0 && ratio >= acceptRatio && modernScale >= modernScaleFloor;
  const heldForScale = parsed.length > 0 && ratio >= acceptRatio && modernScale < modernScaleFloor;
  return {
    accept,
    heldForScale,
    ratio,
    modernScale,
    acceptCount: accepts.length,
    rejectCount: rejects.length,
    parsedCount: parsed.length,
    totalCount: votes.length,
    // Every reject reason + tip, so a rebuild has concrete material to work from.
    reasons: rejects.map((v) => ({ personaId: v.personaId, reason: v.reason, tip: v.tip })).filter((r) => r.reason || r.tip),
    tips: rejects.map((v) => v.tip).filter(Boolean),
    accepts: accepts.map((v) => v.personaId),
    rejects: rejects.map((v) => v.personaId),
  };
}

/**
 * Build the REBUILD brief from the aggregated reject reasons + tips. This is what turns "peers said
 * no" into an actionable next attempt (V3gga: "rebuild using the reasons why and the tips given by
 * each pair"). Kept compact so it slots into the builder prompt.
 */
export function buildRebuildBrief(aggregate, { instruction } = {}) {
  const lines = [`Rebuild the feature. Original goal: ${instruction ?? '(unchanged)'}.`, '', 'Peers rejected the last build. Address every point:'];
  for (const r of aggregate.reasons) {
    lines.push(`  · [${r.personaId}] ${r.reason ?? '(no reason)'}${r.tip ? ` — TIP: ${r.tip}` : ''}`);
  }
  if (aggregate.heldForScale) {
    lines.push('', `Also: the design must be MORE modern/scalable (it was held at modernScale=${aggregate.modernScale.toFixed(2)} < ${MODERN_SCALE_FLOOR}).`);
  }
  return lines.join('\n');
}

/**
 * Build the SECOND-rejection prompt: after a rebuild is ALSO rejected, ask each peer for fresh
 * reasons AND the extra question — should we keep chasing this idea at all? (V3gga's protocol.)
 */
export function buildKeepChasingPrompt(persona, { instruction, built, priorReasons = [] } = {}) {
  const b = built ?? {};
  return (
    `You are ${persona?.title ?? 'a senior engineer'}.\n` +
    `This feature was built, rejected, rebuilt addressing feedback, and rejected AGAIN.\n\n` +
    `ORIGINAL GOAL:\n${instruction ?? '(none)'}\n\n` +
    (priorReasons.length ? `EARLIER OBJECTIONS:\n${priorReasons.map((r) => `  · ${r}`).join('\n')}\n\n` : '') +
    `LATEST BUILD:\n  file: ${b.file ?? '(unknown)'}\n  change:\n${indent(b.diff ?? b.replace ?? '(no diff)', 4)}\n\n` +
    `Answer in EXACTLY this format, nothing else:\n` +
    `VERDICT: <accept|reject>\n` +
    `REASON: <one sentence>\n` +
    `KEEP_CHASING: <yes|no>   (is this idea worth pursuing further, or should we shelve it?)`
  );
}

/** Parse the keep-chasing reply. */
export function parseKeepChasing(personaId, raw) {
  const s = String(raw ?? '');
  const verdict = pick(s, /VERDICT:\s*(accept|reject)/i);
  const reason = linePick(s, /REASON:\s*(.+?)(?:\n|$)/i);
  const keep = pick(s, /KEEP_CHASING:\s*(yes|no)/i);
  return {
    personaId,
    verdict: verdict ?? null,
    reason: reason || null,
    keepChasing: keep == null ? null : /^yes$/i.test(keep),
    parsed: keep != null || verdict != null,
  };
}

/**
 * Decide, after the keep-chasing round, whether to shelve. V3gga's rule: shelve only if ALL peers
 * say don't keep chasing. If ANY peer (with a parsed vote) still wants to chase, we DON'T shelve —
 * the idea stays alive (the caller decides whether to leave it queued for a human). A peer who
 * flipped to accept obviously counts as "keep".
 */
export function decideShelve(keepVotes) {
  const parsed = keepVotes.filter((v) => v.parsed);
  if (parsed.length === 0) return { shelve: false, reason: 'no parseable keep-chasing votes — do not shelve on silence' };
  const wantsToChase = parsed.filter((v) => v.keepChasing === true || v.verdict === 'accept');
  if (wantsToChase.length > 0) {
    return { shelve: false, reason: `${wantsToChase.length}/${parsed.length} peer(s) still want to chase this`, championIds: wantsToChase.map((v) => v.personaId) };
  }
  return { shelve: true, reason: `all ${parsed.length} peer(s) agreed to stop chasing`, reasons: parsed.map((v) => v.reason).filter(Boolean) };
}

/**
 * The TOKENIZED shelf fingerprint — a memory-optimised summary of a rejected idea so a future
 * similar message can PULL it. V3gga: "a very short tokenized message that summarises the rejected
 * ideas into a memory-optimised state that can be pulled if any messages should trigger similar
 * tokenizations." Deterministic: a stable set of lowercased salient tokens (so a later message can
 * be tokenized the same way and overlap-matched) + a stable hash id. Pure — no model needed, so the
 * fingerprint is reproducible and testable; the caller MAY additionally ask the council for a
 * one-line human gloss, but the retrieval key is deterministic.
 */
export function tokenizeRejectedIdea({ instruction = '', file = '', reasons = [] } = {}) {
  const text = `${instruction} ${file} ${reasons.join(' ')}`.toLowerCase();
  // Salient tokens: alphanumerics ≥3 chars, minus stopwords, deduped, capped + sorted so the key is
  // order-independent (the same idea phrased differently still overlaps). This is the retrieval key.
  const tokens = [...new Set(
    (text.match(/[a-z0-9][a-z0-9+.#-]{2,}/g) ?? []).filter((t) => !STOPWORDS.has(t)),
  )].sort().slice(0, 12);
  const id = createHash('sha1').update(tokens.join(' ')).digest('hex').slice(0, 12);
  return { id, tokens, key: tokens.join(' ') };
}

/**
 * Overlap score [0..1] between a live message's tokens and a shelved idea's tokens — Jaccard over
 * the token sets. The caller tokenizes an incoming message the same way (tokenizeRejectedIdea with
 * just the message as instruction) and pulls shelved ideas whose overlap clears a threshold, so the
 * council can say "we already tried this" instead of re-proposing it. Pure.
 */
export function ideaOverlap(aTokens, bTokens) {
  const a = new Set(aTokens ?? []);
  const b = new Set(bTokens ?? []);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * SHELVE an idea onto the rejected-ideas knowledge shelf (the DB half). Stores the tokenized
 * fingerprint as the claim under scope 'idea:rejected' so topKnowledge/knowledgeConfidence apply
 * for free. confirm=true means "this rejection held" (confidence that it's a dead end RISES).
 * Returns the fingerprint. The db is injected; on a null db it's a no-op (test/preview safety).
 */
export function shelveRejectedIdea(db, { instruction, file, reasons = [], gloss = '' }, { recordKnowledge } = {}) {
  const fp = tokenizeRejectedIdea({ instruction, file, reasons });
  if (db && typeof recordKnowledge === 'function') {
    recordKnowledge(db, {
      scope: 'idea:rejected',
      claim: fp.key,
      kind: 'shelf',
      confirm: true,
      evidence: JSON.stringify({ id: fp.id, gloss: gloss || undefined, file: file || undefined, reasons: reasons.slice(0, 4) }).slice(0, 500),
    });
  }
  return fp;
}

/**
 * REVIVE check: given a live message, return shelved ideas that OVERLAP it — but only those whose
 * shelf confidence still sits ABOVE the revival floor are treated as "still-dead / warn". An idea
 * whose confidence has DECAYED below the floor (members contradicted the rejection with new
 * knowledge) is considered revivable and is returned with revivable=true. V3gga: "don't bring it up
 * again unless several members suggest a rejected proposal now might be valid because of new
 * knowledge." Injected topKnowledge + knowledgeConfidence keep it pure/testable.
 */
export function checkShelvedIdeas(db, message, { topKnowledge, knowledgeConfidence, overlapThreshold = 0.34, floor = REVIVAL_CONFIDENCE_FLOOR } = {}) {
  if (!db || typeof topKnowledge !== 'function') return [];
  const liveTokens = tokenizeRejectedIdea({ instruction: message }).tokens;
  // Pull ALL shelf rows (both above and below floor) — topKnowledge with minConfidence:0 returns them.
  const rows = topKnowledge(db, 'idea:rejected', { limit: 50, minConfidence: 0 }) ?? [];
  const hits = [];
  for (const row of rows) {
    const shelfTokens = String(row.claim ?? '').split(' ').filter(Boolean);
    const overlap = ideaOverlap(liveTokens, shelfTokens);
    if (overlap < overlapThreshold) continue;
    const confidence = typeof knowledgeConfidence === 'function' ? knowledgeConfidence(row) : (row.confidence ?? 1);
    hits.push({
      key: row.claim,
      overlap: Number(overlap.toFixed(3)),
      confidence: Number(confidence.toFixed(3)),
      // Below the floor ⇒ the rejection has been contradicted enough (new knowledge) to reconsider.
      revivable: confidence < floor,
      evidence: safeParse(row.evidence),
    });
  }
  return hits.sort((a, b) => b.overlap - a.overlap);
}

/**
 * RECORD a revival signal: a council member flags that new knowledge makes a shelved idea valid
 * again. confirm=false CONTRADICTS the "it's a dead end" claim, lowering its confidence; once enough
 * members do this the confidence drops below the floor and checkShelvedIdeas reports revivable=true.
 * "Several members" is enforced by the caller counting distinct signals; each call is one member.
 */
export function flagIdeaRevivable(db, key, { personaId, evidence } = {}, { recordKnowledge } = {}) {
  if (!db || typeof recordKnowledge !== 'function' || !key) return;
  recordKnowledge(db, {
    scope: 'idea:rejected',
    claim: key,
    kind: 'shelf',
    confirm: false, // contradict the rejection — new knowledge says maybe-valid
    evidence: `revival flagged by ${personaId ?? 'a member'}${evidence ? `: ${evidence}` : ''}`,
  });
}

// ── the full state machine (pure orchestration over injected effects) ──────────────────────────
//
// runFeatureReview drives build → self-match → peer review → (rebuild once) → (keep-chasing) →
// integrate | shelve. Every effect is injected so this whole flow is tested without a GPU:
//   effects.build(brief)         → { file, summary, diff, replace, sourceExcerpt } | null
//   effects.selfMatch(prompt)    → raw string
//   effects.peerReview(built)    → votes[]  (array of parsed peer votes)
//   effects.keepChasing(built,priorReasons) → keepVotes[]
//   effects.integrate(built)     → { ok, detail }
//   effects.shelve(fingerprint)  → void (persist)
// The caller builds these from the real model + personas + apply path.

export const REVIEW_OUTCOME = {
  INTEGRATED: 'integrated',
  SHELVED: 'shelved',
  HELD: 'held', // rejected twice but a peer still champions it → left for a human, not shelved
  ABORTED: 'aborted', // build produced nothing
};

export async function runFeatureReview({ instruction }, effects, { maxRebuilds = 1 } = {}) {
  const trace = [];
  const note = (step, detail) => trace.push({ step, detail });

  let brief = instruction;
  let attempt = 0;
  let built = await effects.build(brief);
  note('build', built ? { file: built.file, summary: built.summary } : 'no artifact');
  if (!built) return { outcome: REVIEW_OUTCOME.ABORTED, trace };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 1. SELF-MATCH — did we build what was asked?
    const selfRaw = await effects.selfMatch(buildSelfMatchPrompt({ instruction, built }));
    const self = parseSelfMatch(selfRaw);
    note('self-match', { match: self.match, score: self.score, gap: self.gap });

    // 2. PEER REVIEW
    const votes = await effects.peerReview(built);
    const agg = aggregatePeerVotes(votes);
    note('peer-review', { accept: agg.accept, ratio: Number(agg.ratio.toFixed(2)), modernScale: Number(agg.modernScale.toFixed(2)), rejects: agg.rejects, heldForScale: agg.heldForScale });

    // A hard self-match "no" blocks integration even if peers were lenient — we didn't build the
    // asked thing. It counts as a rejection for the rebuild machinery.
    const selfBlocks = self.parsed && self.match === 'no';

    if (agg.accept && !selfBlocks) {
      const res = await effects.integrate(built);
      note('integrate', res);
      return { outcome: res?.ok ? REVIEW_OUTCOME.INTEGRATED : REVIEW_OUTCOME.HELD, built, aggregate: agg, self, integrate: res, trace };
    }

    // Rejected. Do we still have a rebuild left?
    if (attempt < maxRebuilds) {
      attempt++;
      brief = buildRebuildBrief(agg, { instruction }) + (selfBlocks ? `\n\nAlso unbuilt per self-review: ${self.gap ?? 'the asked behaviour'}.` : '');
      const rebuilt = await effects.build(brief);
      note('rebuild', { attempt, ok: !!rebuilt, addressing: agg.reasons.length });
      if (!rebuilt) return { outcome: REVIEW_OUTCOME.ABORTED, aggregate: agg, trace };
      built = rebuilt;
      continue; // re-run self-match + peer review on the rebuild
    }

    // Rejected AGAIN after the rebuild → keep-chasing round.
    const priorReasons = agg.reasons.map((r) => r.reason).filter(Boolean);
    const keepVotes = await effects.keepChasing(built, priorReasons);
    const decision = decideShelve(keepVotes);
    note('keep-chasing', decision);

    if (decision.shelve) {
      const fp = await effects.shelve({ instruction, file: built.file, reasons: [...priorReasons, ...(decision.reasons ?? [])] });
      note('shelve', { id: fp?.id, key: fp?.key });
      return { outcome: REVIEW_OUTCOME.SHELVED, fingerprint: fp, aggregate: agg, trace };
    }
    // A champion remains → hold for a human rather than shelve or force-integrate.
    return { outcome: REVIEW_OUTCOME.HELD, aggregate: agg, decision, trace };
  }
}

// ── tiny pure helpers ──────────────────────────────────────────────────────────
function pick(s, re) { const m = s.match(re); return m ? m[1] : null; }
function numPick(s, re) { const m = s.match(re); return m ? Number(m[1]) : null; }
function linePick(s, re) { const m = s.match(re); return m ? m[1].trim() : null; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function indent(text, n) { const pad = ' '.repeat(n); return String(text).split('\n').map((l) => pad + l).join('\n'); }
function safeParse(s) { try { return JSON.parse(s); } catch { return s ?? null; } }

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'not', 'but', 'you', 'our', 'are',
  'was', 'were', 'has', 'have', 'had', 'will', 'would', 'should', 'could', 'can', 'may', 'a', 'an',
  'to', 'of', 'in', 'on', 'it', 'is', 'be', 'as', 'or', 'we', 'if', 'so', 'do', 'does', 'add',
  'use', 'via', 'per', 'any', 'all', 'one', 'its', 'his', 'her', 'them', 'they', 'their', 'when',
  'what', 'which', 'who', 'how', 'why', 'change', 'feature', 'build', 'built', 'idea', 'reason',
]);
