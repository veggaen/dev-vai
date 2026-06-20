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
import { ollamaGenerate } from './driver.mjs';

const GEN_MODEL = process.env.IMPROVE_GEN_MODEL ?? process.env.LOCAL_MODEL ?? 'qwen3:8b';

/** Best-guess code location per class — where a fix for this class likely lives. */
const CLASS_LOCATION = {
  'routing/build-verb-poison':
    'packages/core/src/chat/build-execution-intent.ts:100 (BUILD_VERB_ANYWHERE disqualifies clean questions)',
  'routing/fresh-data-trigger':
    'packages/core/src/chat/build-execution-intent.ts:88 (FRESH_DATA_LEAD too narrow) + search/pipeline.ts:247',
  'answer/opportunity-framing':
    'packages/core/src/chat/deterministic-facts-router.ts (no idea/opportunity answer contract)',
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
    raw = await ollamaGenerate(GEN_MODEL, prompt, { numPredict: 400 });
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

  if (klass === 'routing/build-verb-poison') {
    // The prompt is a QUESTION that merely mentions a build gerund. It must be
    // answered as a question, not turned into a build / treated as build-intent.
    const builtSomething = /```|title=|installed dependencies|scaffold|here('?s| is) (your|the) (app|project)/i.test(answer);
    if (builtSomething) return { passed: false, reason: 'turned an innocent question into a build' };
    if (readAs && /build|scaffold|create an app|make an app/.test(readAs)) {
      return { passed: false, reason: `council read it as a build: "${readAs}"` };
    }
    return { passed: true, reason: 'answered as a question, not a build' };
  }

  // Generic fallback: cheap LLM judge of interpretation match. Blind to prettiness.
  const judgePrompt =
    `A user asked: "${prompt}"\n` +
    `The expected interpretation is: ${expectedIntent}.\n` +
    `The assistant read it as: "${vai.council?.realIntent ?? '(unknown)'}" and answered (excerpt):\n` +
    `"${(vai.text ?? '').slice(0, 400)}"\n\n` +
    `Did the assistant interpret the question the way expected? Answer strictly "YES" or "NO" then a 6-word reason.`;
  try {
    const verdict = await ollamaGenerate(GEN_MODEL, judgePrompt, { numPredict: 40 });
    const passed = /^\s*yes\b/i.test(verdict);
    return { passed, reason: verdict.replace(/^\s*(yes|no)\b[:.\-\s]*/i, '').slice(0, 80) || 'judge verdict' };
  } catch {
    return { passed: false, reason: 'grader unavailable — counted as fail (conservative)' };
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
