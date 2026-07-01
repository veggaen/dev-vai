/**
 * feature-review-job — run ONE self-improvement job (from the queue) through the gated pipeline:
 *   feature-build (ground the model, produce a verified artifact)
 *     → feature-review (self-match → multi-member peer review → rebuild-once → keep-chasing)
 *       → integrate | shelve | held.
 *
 * This is the DRAIN worker: `drainSelfImproveQueue` calls `runSelfImproveJob(job, opts)` for each
 * queued job. It shares the exact effects the interactive `feature-review-run.mjs` CLI uses, so a
 * job the Council TRIGGERED goes through the same peer-reviewed, branch-guarded path — no shortcut.
 *
 * SAFETY: PREVIEW by default (reviews, does not integrate). integrate:true only ever records intent
 * on the council/auto-improve branch (the real file apply stays in apply-consensus). Strictly serial
 * + VRAM-guarded (one heavy task at a time) via the injected `generate`.
 */

import { readFileSync } from 'node:fs';
import { selectPersonas } from './personas.mjs';
import { buildFeatureArtifact } from './feature-build.mjs';
import {
  runFeatureReview,
  buildSelfMatchPrompt,
  buildPeerPrompt,
  parsePeerVote,
  buildKeepChasingPrompt,
  parseKeepChasing,
  shelveRejectedIdea,
  REVIEW_OUTCOME,
} from './feature-review.mjs';
import { recordKnowledge } from './db.mjs';
import { appendChangelogEntry } from './changelog.mjs';

/**
 * Build a serial, VRAM-guarded single-generate against the resident local model. Shared with the
 * CLI. Returns an async (prompt, {numPredict}) => string.
 */
export function makeGenerator({ vramGb = 8.5, timeoutMs = 90_000 } = {}) {
  return async (prompt, { numPredict = 200 } = {}) => {
    const { residentModel, installedModels, waitForVramHeadroom, ollamaGenerate } = await import('./driver.mjs');
    await waitForVramHeadroom(vramGb * 1024 ** 3, { maxWaitMs: 60_000 }).catch(() => {});
    const resident = await residentModel().catch(() => null);
    const installed = await installedModels().catch(() => []);
    const model = resident ?? installed[0]?.name;
    if (!model) throw new Error('no local model available');
    return ollamaGenerate(model, prompt, { timeoutMs, numPredict, think: false });
  };
}

/**
 * Run one self-improvement job end-to-end. `job` is a queue row: { instruction, location, klass }.
 * Returns { outcome, detail } (what drainSelfImproveQueue records + closes the job with).
 * Injected `generate` (defaults to a live VRAM-guarded generator) + `db` for the shelf.
 */
export async function runSelfImproveJob(job, {
  db,
  generate = makeGenerator(),
  integrate = false,
  log = () => {},
  changelogPath, // injectable so tests don't mutate the real docs changelog
} = {}) {
  const instruction = job.instruction;
  const location = job.location;
  const klass = job.klass ?? 'capability';
  if (!instruction) return { outcome: 'aborted', detail: 'job has no instruction' };
  if (!location) return { outcome: 'aborted', detail: 'job has no location to ground codegen on' };

  const personas = selectPersonas(klass);
  log(`  self-improve job: "${String(instruction).slice(0, 70)}" · ${personas.length} peer lens(es)${integrate ? ' · integrate-armed' : ' · preview'}`);

  const effects = {
    build: async (brief) => {
      const out = await buildFeatureArtifact(
        { instruction: brief || instruction, location },
        { generate: (p) => generate(p, { numPredict: 400 }), readFile: (f) => readFileSync(f, 'utf8') },
      );
      if (!out.ok) { log(`    build failed: ${out.reason}`); return null; }
      return out.artifact;
    },
    selfMatch: async (prompt) => generate(prompt, { numPredict: 160 }),
    peerReview: async (artifact) => {
      const votes = [];
      for (const persona of personas) {
        let raw = '';
        try { raw = await generate(buildPeerPrompt(persona, { instruction, built: artifact, sourceExcerpt: artifact.sourceExcerpt }), { numPredict: 200 }); }
        catch { /* an unavailable peer is a non-vote */ }
        votes.push(parsePeerVote(persona.id, raw));
      }
      return votes;
    },
    keepChasing: async (artifact, priorReasons) => {
      const votes = [];
      for (const persona of personas) {
        let raw = '';
        try { raw = await generate(buildKeepChasingPrompt(persona, { instruction, built: artifact, priorReasons }), { numPredict: 120 }); }
        catch { /* non-vote */ }
        votes.push(parseKeepChasing(persona.id, raw));
      }
      return votes;
    },
    integrate: async () => {
      if (!integrate) return { ok: false, detail: 'preview-only (integration not armed)' };
      const { currentBranch, AUTO_IMPROVE_BRANCH } = await import('./apply-runners.mjs');
      if (currentBranch() !== AUTO_IMPROVE_BRANCH) return { ok: false, detail: `off-branch (need ${AUTO_IMPROVE_BRANCH})` };
      return { ok: true, detail: 'integration intent recorded (apply via apply-consensus)' };
    },
    shelve: async (idea) => shelveRejectedIdea(db, idea, { recordKnowledge }),
  };

  const result = await runFeatureReview({ instruction }, effects);

  // Record the outcome to the changelog so it's visible in the same side-note as everything else.
  const changelogKind = {
    [REVIEW_OUTCOME.INTEGRATED]: 'integrated',
    [REVIEW_OUTCOME.SHELVED]: 'shelved',
    [REVIEW_OUTCOME.HELD]: 'held',
    [REVIEW_OUTCOME.ABORTED]: null,
  }[result.outcome];
  if (changelogKind) {
    appendChangelogEntry({
      kind: changelogKind,
      title: `${klass}: ${String(instruction).slice(0, 90)}`,
      why: `Council-triggered self-improvement (member ${job.member_id ?? '?'}).`,
      class: klass,
      files: result.built?.file ? [result.built.file] : [],
      verification: result.integrate?.detail ?? (result.outcome === REVIEW_OUTCOME.SHELVED ? 'peer-rejected (2 rounds)' : 'peer-reviewed'),
      peers: result.aggregate ? { accept: result.aggregate.accept, ratio: result.aggregate.ratio, modernScale: result.aggregate.modernScale } : null,
    }, changelogPath ? { path: changelogPath } : undefined);
  }

  const detail = result.outcome === REVIEW_OUTCOME.SHELVED
    ? `shelved (fingerprint ${result.fingerprint?.id})`
    : result.outcome === REVIEW_OUTCOME.HELD
      ? `held — a peer still champions it`
      : result.integrate?.detail ?? result.outcome;
  return { outcome: result.outcome, detail };
}
