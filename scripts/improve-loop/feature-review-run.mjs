#!/usr/bin/env node
/**
 * feature-review-run — the LIVE orchestration around the pure feature-review protocol. It builds
 * the real effects (persona peers via the local model, VRAM-guarded + serial) and drives
 * build → self-match → peer-review → rebuild-once → keep-chasing → integrate | shelve, then writes
 * the outcome to the Council changelog and (on shelve) the rejected-ideas shelf.
 *
 * SAFETY (mirrors the supervisor's --apply discipline, one heavy task at a time):
 *   - PREVIEW by default: it runs the whole review but does NOT integrate. Pass --integrate to let a
 *     cleared feature actually call the integrate effect.
 *   - The integrate effect itself is the caller's to supply; this CLI's built-in integrate refuses
 *     unless HEAD is council/auto-improve (branch-guarded, like every other apply path).
 *   - Peer calls are strictly serial and VRAM-guarded so two heavy models never load at once.
 *
 * This is deliberately a SHIM: the pure protocol (feature-review.mjs) holds the logic and is fully
 * unit-tested; this file only wires real I/O. The `build` effect is the instruction-driven grounded
 * codegen in feature-build.mjs (ground the model in the real target file → verified {file,find,
 * replace,diff} artifact). Pass --location <file[:line]> to point it at the source to change. A
 * pre-built --artifact <json> still overrides codegen (useful for reviewing a diff you already have).
 */

import { readFileSync } from 'node:fs';
import { openDb, recordKnowledge, topKnowledge, knowledgeConfidence } from './db.mjs';
import { selectPersonas } from './personas.mjs';
import { buildFeatureArtifact } from './feature-build.mjs';
import { isCodeRabbitAvailable, reviewWithCodeRabbit, CodeRabbitBudget } from './coderabbit.mjs';
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
import { appendChangelogEntry } from './changelog.mjs';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const has = (f) => args.includes(f);

const DB_PATH = opt('--db', 'scripts/improve-loop/.corpus.sqlite');
const INTEGRATE = has('--integrate');
const CLASS = opt('--class', 'feature');
const INSTRUCTION = opt('--instruction', '');
const ARTIFACT_PATH = opt('--artifact', '');
const LOCATION = opt('--location', ''); // file[:line] to ground codegen on
const APPLY_BRANCH = opt('--apply-branch', ''); // override the branch --integrate is allowed to commit to
const PKG_TSCONFIG = opt('--tsconfig', 'packages/core/tsconfig.json'); // tsconfig the verify step typechecks
const VRAM_GB = Number(opt('--vram-gb', '8.5'));
const PEER_TIMEOUT = Number(opt('--peer-timeout', '90000'));
// CodeRabbit augmentation: run the built change through CodeRabbit (free tier, cooldown-gated) so
// peers can improve their own suggestion before review. On by default when the CLI is available;
// --no-coderabbit forces it off. A no-op (peers proceed without it) when the binary isn't present.
const USE_CODERABBIT = !has('--no-coderabbit');

function log(m) { process.stdout.write(`[feature-review ${new Date().toLocaleTimeString()}] ${m}\n`); }

/** Load a pre-built artifact (the feature diff to review) from a JSON file. */
function loadArtifact() {
  if (!ARTIFACT_PATH) return null;
  try {
    const a = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8'));
    if (!a || typeof a !== 'object') return null;
    return { file: a.file ?? '(unknown)', summary: a.summary ?? '', diff: a.diff ?? a.replace ?? '', replace: a.replace, sourceExcerpt: a.sourceExcerpt ?? '' };
  } catch (e) {
    log(`could not read --artifact: ${String(e).slice(0, 80)}`);
    return null;
  }
}

/** Serial, VRAM-guarded single generate against the resident local model. */
async function generate(prompt, { numPredict = 200 } = {}) {
  const { residentModel, installedModels, waitForVramHeadroom, ollamaGenerate } = await import('./driver.mjs');
  await waitForVramHeadroom(VRAM_GB * 1024 ** 3, { maxWaitMs: 60_000 }).catch(() => {});
  const resident = await residentModel().catch(() => null);
  const installed = await installedModels().catch(() => []);
  const model = resident ?? installed[0]?.name;
  if (!model) throw new Error('no local model available');
  return ollamaGenerate(model, prompt, { timeoutMs: PEER_TIMEOUT, numPredict, think: false });
}

async function main() {
  if (!INSTRUCTION && !ARTIFACT_PATH) {
    log('usage: --instruction "<goal>" [--location file[:line]] [--artifact artifact.json] [--integrate] [--class <name>]');
    log('  PREVIEW by default (reviews but does not integrate). --integrate to apply a cleared feature.');
    process.exit(1);
  }
  if (INSTRUCTION && !LOCATION && !ARTIFACT_PATH) {
    log('note: no --location given → codegen has nothing to ground on. Pass --location <file[:line]> or --artifact <json>.');
    process.exit(1);
  }
  const db = openDb(DB_PATH);
  const personas = selectPersonas(CLASS);
  log(`reviewing with ${personas.length} peer lens(es)${INTEGRATE ? ' · INTEGRATE armed' : ' · PREVIEW (no integrate)'}`);

  const suppliedArtifact = loadArtifact();

  // CodeRabbit availability is probed ONCE up front (honest: false on Windows today → the whole
  // augmentation no-ops and peers proceed without it). The cooldown budget persists across runs.
  const crStatus = USE_CODERABBIT ? isCodeRabbitAvailable() : { available: false, detail: 'disabled (--no-coderabbit)' };
  if (USE_CODERABBIT) log(`CodeRabbit: ${crStatus.available ? `available (${crStatus.bin}) — peers will use it, cooldown-gated` : `not used — ${crStatus.detail}`}`);
  const crBudget = new CodeRabbitBudget();

  // Fold CodeRabbit findings into the artifact so self-match + peer review SEE them → the peer's
  // suggestion improves because the review considers CodeRabbit's flags. No-op when unavailable /
  // cooling down. Writes the diff to a temp file for `cr --agent` to read.
  const augmentWithCodeRabbit = async (artifact) => {
    if (!crStatus.available || !artifact) return artifact;
    let target = '';
    try {
      const os = await import('node:os');
      const path = await import('node:path');
      const fs = await import('node:fs');
      target = path.join(os.tmpdir(), `vai-cr-diff-${Date.now()}.patch`);
      fs.writeFileSync(target, artifact.diff ?? '');
    } catch { return artifact; }
    const r = reviewWithCodeRabbit({ target, bin: crStatus.bin, budget: crBudget });
    if (r.skipped) { log(`  CodeRabbit: ${r.reason}`); return artifact; }
    if (r.findings.length === 0) { log('  CodeRabbit: no findings on this change'); return artifact; }
    log(`  CodeRabbit: ${r.findings.length} finding(s) folded into the review`);
    // Append the findings to the excerpt so buildPeerPrompt/buildSelfMatchPrompt carry them.
    return { ...artifact, sourceExcerpt: `${artifact.sourceExcerpt ?? ''}\n\n${r.block}`, codeRabbit: r.findings };
  };

  const effects = {
    // The build effect: a supplied --artifact overrides; otherwise ground the local model in the
    // real target file and produce a verified {file,find,replace,diff} artifact. `brief` is the
    // original instruction on the first pass and the REBUILD brief (reasons+tips) on a retry.
    build: async (brief) => {
      if (suppliedArtifact) return augmentWithCodeRabbit(suppliedArtifact); // review a diff you already have
      const out = await buildFeatureArtifact(
        { instruction: brief || INSTRUCTION, location: LOCATION },
        { generate: (p) => generate(p, { numPredict: 400 }), readFile: (f) => readFileSync(f, 'utf8') },
      );
      if (!out.ok) { log(`build failed: ${out.reason}`); return null; }
      log(`built: ${out.artifact.file} — ${out.artifact.why || '(no rationale)'}`);
      return augmentWithCodeRabbit(out.artifact);
    },
    selfMatch: async (prompt) => {
      log('self-match: re-reading the built change against the instruction…');
      return generate(prompt, { numPredict: 160 });
    },
    peerReview: async (artifact) => {
      const votes = [];
      for (const persona of personas) {
        const prompt = buildPeerPrompt(persona, { instruction: INSTRUCTION, built: artifact, sourceExcerpt: artifact.sourceExcerpt });
        let raw = '';
        try { raw = await generate(prompt, { numPredict: 200 }); } catch (e) { log(`peer ${persona.id} unavailable: ${String(e).slice(0, 60)}`); }
        const vote = parsePeerVote(persona.id, raw);
        log(`  peer ${persona.id}: ${vote.verdict ?? 'unparsed'}${vote.score != null ? ` (${vote.score})` : ''}${vote.tip ? ` — tip: ${vote.tip.slice(0, 60)}` : ''}`);
        votes.push(vote);
      }
      return votes;
    },
    keepChasing: async (artifact, priorReasons) => {
      const votes = [];
      for (const persona of personas) {
        const prompt = buildKeepChasingPrompt(persona, { instruction: INSTRUCTION, built: artifact, priorReasons });
        let raw = '';
        try { raw = await generate(prompt, { numPredict: 120 }); } catch (e) { log(`keep-chasing ${persona.id} unavailable: ${String(e).slice(0, 60)}`); }
        const v = parseKeepChasing(persona.id, raw);
        log(`  keep-chasing ${persona.id}: ${v.keepChasing === true ? 'keep' : v.keepChasing === false ? 'stop' : 'unparsed'}`);
        votes.push(v);
      }
      return votes;
    },
    integrate: async (artifact) => {
      if (!INTEGRATE) {
        log('PREVIEW: feature cleared review — would integrate (pass --integrate to apply).');
        return { ok: false, detail: 'preview-only (integration not armed)' };
      }
      // REAL branch-guarded apply: risk-gate → exact find/replace → tsc(+colocated test) →
      // commit-or-revert. This is what makes "the Council implements + verifies" real. The default
      // guard branch is council/auto-improve; --apply-branch overrides it (for a safe proof branch).
      const { currentBranch, realApplyDeps, AUTO_IMPROVE_BRANCH } = await import('./apply-runners.mjs');
      const branch = APPLY_BRANCH || AUTO_IMPROVE_BRANCH;
      if (currentBranch() !== branch) {
        log(`refusing to integrate: HEAD is '${currentBranch()}', not '${branch}'`);
        return { ok: false, detail: `off-branch (need ${branch})` };
      }
      const { applyVerifiedFix } = await import('./apply-fix.mjs');
      const { colocatedTestPath } = await import('./colocated-test.mjs');
      const testPath = colocatedTestPath(artifact.file);
      log(`integrate armed on ${branch} — applying + verifying (tsc${testPath ? ` + ${testPath}` : ''})…`);
      const deps = realApplyDeps({ pkgTsconfig: PKG_TSCONFIG, branch, testPath });
      const r = await applyVerifiedFix(
        { file: artifact.file, find: artifact.find, replace: artifact.replace, why: artifact.why },
        deps,
      );
      if (r.committed) { log(`✅ COMMITTED + VERIFIED: ${r.verifyDetail}`); return { ok: true, detail: `committed + verified — ${r.verifyDetail}` }; }
      if (r.tier === 'review') { log(`⚠ risk-tier '${r.tier}' — flagged, not applied`); return { ok: false, detail: `risk-tier — ${(r.reasons ?? []).join('; ')}` }; }
      log(`↩ not committed: ${r.verifyDetail || (r.reasons ?? []).join('; ')}`);
      return { ok: false, detail: r.verifyDetail || (r.reasons ?? []).join('; ') || 'apply failed' };
    },
    shelve: async (idea) => shelveRejectedIdea(db, idea, { recordKnowledge }),
  };

  const result = await runFeatureReview({ instruction: INSTRUCTION }, effects);
  log(`OUTCOME: ${result.outcome}`);

  // Write the outcome to the changelog side-note (integrate/shelve/held all leave a trace).
  if (result.outcome === REVIEW_OUTCOME.INTEGRATED) {
    const agg = result.aggregate;
    appendChangelogEntry({
      kind: 'integrated',
      title: `${CLASS}: ${INSTRUCTION.slice(0, 90)}`,
      why: INSTRUCTION,
      class: CLASS,
      files: result.built?.file ? [result.built.file] : [],
      verification: result.integrate?.detail ?? 'peer-reviewed',
      peers: agg ? { accept: agg.accept, ratio: agg.ratio, modernScale: agg.modernScale, dissent: (agg.reasons ?? []).map((r) => `${r.personaId}: ${r.reason ?? ''}`).slice(0, 3) } : null,
    });
  } else if (result.outcome === REVIEW_OUTCOME.SHELVED) {
    appendChangelogEntry({
      kind: 'shelved',
      title: `shelved: ${INSTRUCTION.slice(0, 90)}`,
      why: `rejected twice and all peers agreed to stop chasing. Tokenized fingerprint ${result.fingerprint?.id} stored on the rejected-ideas shelf.`,
      class: CLASS,
      files: result.built?.file ? [result.built.file] : [],
      verification: 'peer-rejected (2 rounds)',
    });
    log(`shelved fingerprint: ${result.fingerprint?.key}`);
  } else if (result.outcome === REVIEW_OUTCOME.HELD) {
    appendChangelogEntry({
      kind: 'held',
      title: `held for review: ${INSTRUCTION.slice(0, 90)}`,
      why: 'rejected but a peer still champions it — left for a human rather than shelved or force-integrated.',
      class: CLASS,
    });
  }

  // Print the trace so a human can read exactly what the council decided and why.
  log('trace:');
  for (const step of result.trace ?? []) log(`  · ${step.step}: ${JSON.stringify(step.detail).slice(0, 140)}`);
  db.close();
}

main().catch((e) => { log('fatal: ' + String(e)); process.exit(1); });
