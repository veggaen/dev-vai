/**
 * Generation, grading, and failure-mining — the "intelligence" of the loop.
 *
 * generatePrompts(): qwen3:8b invents new test prompts WITHIN a known failure
 *   class, seeded by examples. This is how the corpus grows beyond the few real
 *   failures we hand-seed (Norway, BTC, …) to cover the whole class.
 *
 * gradeInterpretation(): the decisive grader. It does NOT ask "is the answer
 *   nice"; it asks "did Vai READ the question the way the class demands" — the
 *   exact dimension that beat us on Norway (legal-forms vs opportunity). Uses
 *   council.realIntent (council's own "what the user wants") so the grade is
 *   grounded in Vai's stated interpretation, not vibes.
 *
 * mineFailures(): clusters failures by class and emits ONE fix candidate per
 *   class with a best-guess code location — queued for human approval, never
 *   auto-applied (loop is read-only on source).
 */
import { ollamaGenerate, residentModel } from './driver.mjs';
import { scoreVagueOverconfident } from './vague-answer.mjs';

const GEN_MODEL = process.env.IMPROVE_GEN_MODEL ?? process.env.LOCAL_MODEL ?? 'qwen3:8b';

/** Best-guess code location per class — where a fix for this class likely lives. Exported so
 *  propose-fix can synthesize a fix target for ANY class without depending on a mined `fixes`
 *  row (the fragile chain that starved the prototype loop). */
export const CLASS_LOCATION = {
  'routing/build-verb-poison':
    'packages/core/src/chat/build-execution-intent.ts:100 (BUILD_VERB_ANYWHERE disqualifies clean questions)',
  'routing/fresh-data-trigger':
    'packages/core/src/chat/build-execution-intent.ts:88 (FRESH_DATA_LEAD too narrow) + search/pipeline.ts:247',
  'answer/opportunity-framing':
    'packages/core/src/chat/deterministic-facts-router.ts (no idea/opportunity answer contract)',
  'answer/vague-overconfident':
    'packages/core/src/chat/service.ts (draft quality contract) + council redraft gate (grounding not enforced before ship)',
  // Real source locations for the four classes that were stuck at "(unknown — investigate)" —
  // they were REAL weak classes (35–73% pass-rate, 78 failing rows) the loop could never fix
  // because no file was mapped, so every proposal died at the no-file guard. Grounded against
  // the actual router thicket (deterministic-facts-router.ts) + the follow-up resolver.
  'routing/comparison':
    'packages/core/src/chat/deterministic-facts-router.ts:1162 (comparePair matcher answers/defines one entity instead of comparing the two)',
  'answer/curated-trap':
    'packages/core/src/chat/deterministic-facts-router.ts:526 (longest-curated-key-wins fires a hardcoded answer too broadly)',
  'answer/freshness-staleness':
    'packages/core/src/chat/build-execution-intent.ts:88 (FRESH_DATA_LEAD misses time-sensitive facts → answered from frozen memory)',
  'followup/context-carry':
    'packages/core/src/chat/contextual-resolver.ts:27 (THING_REF pronoun/ordinal resolution against the prior turn)',
};

/** Ask qwen for N fresh prompts in a class. Returns string[] (best-effort parse). */
export async function generatePrompts(klass, expectedIntent, seedExamples, count) {
  const examples = seedExamples.map((s) => `- "${s}"`).join('\n');
  const prompt =
    `You generate TEST QUESTIONS to stress-test an AI assistant's INTENT classification.\n` +
    `Class under test: ${klass}\n` +
    `These questions should all be ones a human would expect to be read as: ${expectedIntent}.\n` +
    `Here are seed examples of the class:\n${examples}\n\n` +
    `Write ${count} NEW, natural, varied user questions in this same class. Vary topic, phrasing, ` +
    `country, and domain. Keep each under 20 words. Some should contain tempting "trap" words ` +
    `(create/build/make/price) used innocently, to probe misclassification.\n` +
    `Output ONLY the questions, one per line, no numbering, no commentary.`;
  let raw = '';
  try {
    // Generate on the resident model (the one Vai is answering with) so the top-up doesn't
    // evict it and force the next WS turn to cold-load under timeout. Falls back to GEN_MODEL.
    const genModel = (await residentModel()) ?? GEN_MODEL;
    raw = await ollamaGenerate(genModel, prompt, { numPredict: 400 });
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .map((l) => l.replace(/^[\s\-\d.)"]+/, '').replace(/"\s*$/, '').trim())
    .filter((l) => l.length > 8 && l.length < 160 && /[a-z]/i.test(l))
    .slice(0, count);
}

/**
 * Grade whether Vai READ the prompt as the class expects.
 * Deterministic first (cheap, ungameable), model fallback only when ambiguous.
 * Returns { passed, reason }.
 */
export async function gradeInterpretation(klass, expectedIntent, prompt, vai) {
  const readAs = (vai.council?.realIntent ?? '').toLowerCase();
  const answer = (vai.text ?? '').toLowerCase();

  // Class-specific deterministic checks (the fast, reliable path).
  if (klass === 'answer/opportunity-framing' || klass === 'routing/fresh-data-trigger') {
    // The Norway failure signature: enumerated legal company FORMS instead of ideas.
    const dumpedLegalForms = /\b(enk|aksjeselskap|\bas\b|\basa\b|\bans\b|\bnuf\b|sole proprietor|general partnership)\b/i
      .test(answer) && /benefit|disadvantage|liabilit/i.test(answer);
    const gaveIdeas = /\b(idea|opportunit|sector|niche|market|you could|consider building|focus on)\b/i.test(answer);
    if (dumpedLegalForms && !gaveIdeas) {
      return { passed: false, reason: 'enumerated legal company forms instead of business ideas (Norway signature)' };
    }
    if (gaveIdeas) return { passed: true, reason: 'proposed concrete ideas/opportunities' };
  }

  if (klass === 'answer/vague-overconfident') {
    // The class the user flagged: confident-sounding but generic, ungrounded prose
    // ("AI slop"). Deterministic surface scoring — ungameable, no model needed.
    // An EMPTY answer is the worst case — it must fail this class, not pass as "not vague"
    // (CodeRabbit #25: scoreVagueOverconfident('') returns non-vague, polluting recovery metrics).
    if (!String(vai.text ?? '').trim()) {
      return { passed: false, reason: 'empty answer — produced no response at all' };
    }
    const verdict = scoreVagueOverconfident(vai.text ?? '');
    if (verdict.vague) {
      return { passed: false, reason: `vague/overconfident (score ${verdict.score}): ${verdict.signals.slice(0, 2).join('; ')}` };
    }
    return { passed: true, reason: `grounded enough (score ${verdict.score})` };
  }

  if (klass === 'routing/build-verb-poison') {
    // The prompt is a QUESTION that merely mentions a build gerund. It must be
    // answered as a question, not turned into a build / treated as build-intent.
    // The AUTHORITATIVE signal is the ANSWER shape: did Vai actually scaffold, or ask the
    // user for a stack/scaffold target? The council's `readAs` intent string alone is NOT
    // reliable — it routinely contains the word "building"/"build" for a pure advice ask
    // ("seeking guidance on team BUILDING fundamentals"), which produced false-negative
    // grades that dragged the pass rate down even when the answer was a correct advice reply.
    const builtSomething = /```|title=|installed dependencies|scaffold|here('?s| is) (your|the) (app|project)/i.test(answer);
    if (builtSomething) return { passed: false, reason: 'turned an innocent question into a build' };
    // A build-shaped DEFLECTION is itself a build-misread ("give me a target stack and I'll
    // scaffold"). The ANSWER soliciting build inputs is the authoritative signal — do NOT also
    // require readAsBuild (CodeRabbit #25: that let "what stack should I use?" deflections pass
    // whenever the council intent string happened not to say "build"). The solicitation phrases below
    // are build-specific (target stack / I'll scaffold / what to build) so "team building" advice,
    // which doesn't solicit build inputs, still passes.
    const answerSolicitsBuild =
      /\b(?:target stack|tech stack|what (?:stack|framework|language)|one-line goal|i'?ll scaffold|scaffold (?:a|the|something)|what (?:do you )?want (?:me )?to build)\b/i.test(answer);
    if (answerSolicitsBuild) {
      return { passed: false, reason: `answered by soliciting build inputs (build-misread)${readAs ? ` · readAs:"${readAs}"` : ''}` };
    }
    return { passed: true, reason: 'answered as a question, not a build' };
  }

  if (klass === 'answer/curated-trap') {
    // Failure mode: an unrelated hardcoded curated answer fires on a question that isn't
    // asking for it. The known offender is the Norway business-idea/legal-forms block — so
    // its leak into a travel/weather/React/culture ask is a deterministic, ungameable FAIL.
    // Distinctive tokens only (no bare "as"/"ans") so ordinary prose can't false-positive.
    const leakedLegalForms = /\b(enk|aksjeselskap|\basa\b|\bnuf\b|sole proprietorship|general partnership)\b/i.test(answer)
      && /benefit|disadvantage|liabilit|taxation/i.test(answer);
    const leakedBusinessIdeas = /\b(business idea|startup idea|company you could start|business opportunit)\b/i.test(answer);
    if (leakedLegalForms || leakedBusinessIdeas) {
      return { passed: false, reason: 'unrelated curated business answer fired (curated-trap)' };
    }
    // Clean of the known leak → fall through to the (now-cheap, resident-model) judge to
    // catch OTHER curated misfires without auto-passing.
  }

  // Generic fallback: cheap LLM judge of interpretation match. Blind to prettiness.
  // Judge on whatever model is ALREADY resident (no evict+cold-load swap — the grader's #1
  // timeout source and a BSOD-rule violation); only fall back to GEN_MODEL when nothing is loaded.
  const judgePrompt =
    `A user asked: "${prompt}"\n` +
    `The expected interpretation is: ${expectedIntent}.\n` +
    `The assistant read it as: "${vai.council?.realIntent ?? '(unknown)'}" and answered (excerpt):\n` +
    `"${(vai.text ?? '').slice(0, 400)}"\n\n` +
    `Did the assistant interpret the question the way expected? Answer strictly "YES" or "NO" then a 6-word reason.`;
  const judgeModel = (await residentModel()) ?? GEN_MODEL;
  try {
    const verdict = await ollamaGenerate(judgeModel, judgePrompt, { numPredict: 40 });
    const passed = /^\s*yes\b/i.test(verdict);
    return { passed, reason: verdict.replace(/^\s*(yes|no)\b[:.\-\s]*/i, '').slice(0, 80) || 'judge verdict' };
  } catch {
    // Verification-First: a grader-model failure is INFRA, not a Vai logic failure. Signal it
    // so the caller SKIPS (re-readies) instead of polluting the corpus with a false negative.
    return { infra: true, passed: false, reason: 'grader unavailable — infra skip (not a Vai failure)' };
  }
}

/** Cluster a run's failures by class → one queued fix candidate per affected class. */
export function mineFailures(failures) {
  const byClass = new Map();
  for (const f of failures) {
    if (!byClass.has(f.klass)) byClass.set(f.klass, []);
    byClass.get(f.klass).push(f);
  }
  const candidates = [];
  for (const [klass, items] of byClass) {
    const reasons = [...new Set(items.map((i) => i.reason))].slice(0, 3);
    candidates.push({
      klass,
      failureCount: items.length,
      location: CLASS_LOCATION[klass] ?? '(unknown — investigate)',
      summary:
        `${items.length} failures in ${klass}. Dominant reasons: ${reasons.join('; ')}. ` +
        `Smallest-change target at ${CLASS_LOCATION[klass]?.split(' ')[0] ?? 'TBD'}.`,
    });
  }
  return candidates;
}
