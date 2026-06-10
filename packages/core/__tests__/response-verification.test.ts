import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALIBRATION_NOTE,
  classifyGrounding,
  looksLikeConfidentFactualClaim,
  sanitizeForeignScript,
  sanitizeLeakage,
  verifyResponse,
  VERIFICATION_CALIBRATE_CEILING,
} from '../src/chat/response-verification.js';

describe('response-verification — sanitizeLeakage', () => {
  it('strips scratch/template/continuation lines but keeps the real answer', () => {
    const text = [
      '[scratch] continuing from the previous grounded pass',
      'Use a debounce so the handler runs once after the burst settles.',
      'relevant context is: nothing here',
    ].join('\n');
    const { text: cleaned, removed } = sanitizeLeakage(text);
    expect(removed).toBe(2);
    expect(cleaned).toBe('Use a debounce so the handler runs once after the burst settles.');
  });

  it('strips off-topic retrieval-drift lines', () => {
    const text = [
      'Here is the actual answer about Redis caching.',
      'learn how and when to remove this message',
    ].join('\n');
    const { text: cleaned, removed } = sanitizeLeakage(text);
    expect(removed).toBe(1);
    expect(cleaned).toBe('Here is the actual answer about Redis caching.');
  });

  it('leaves a clean answer untouched (no false stripping)', () => {
    const text = 'A `Set` keeps only distinct values; spreading it back gives an array.';
    const { text: cleaned, removed } = sanitizeLeakage(text);
    expect(removed).toBe(0);
    expect(cleaned).toBe(text);
  });
});

describe('response-verification — sanitizeForeignScript (T3 language drift)', () => {
  const NORWEGIAN_PROMPT = 'Hva er en kjent severdighet i Oslo, og hvorfor er den verdt et besøk?';

  it('strips CJK runs spliced into a Latin-script answer and reports the leak', () => {
    const drifted =
      'En kjent severdighet i Oslo er奥斯陆是挪威的首都。Vigelandsparken, fordi den er gratis og åpen hele året.\n这句话的意思是奥斯陆有很多雕塑。';
    const { text, leakedScripts } = sanitizeForeignScript(drifted, NORWEGIAN_PROMPT);
    expect(leakedScripts).toEqual(['cjk']);
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    expect(text).toContain('Vigelandsparken');
  });

  it('does not strip when the prompt explicitly requests another language', () => {
    const answer = '«God morgen» på kinesisk er 早上好.';
    const { text, leakedScripts } = sanitizeForeignScript(answer, 'Hvordan sier jeg god morgen på kinesisk?');
    expect(leakedScripts).toEqual([]);
    expect(text).toBe(answer);
  });

  it('does not strip when the prompt itself uses that script', () => {
    const { leakedScripts } = sanitizeForeignScript('你好！我可以帮你。', '你好，你能帮我吗？');
    expect(leakedScripts).toEqual([]);
  });

  it('leaves CJK inside fenced code blocks untouched', () => {
    const answer = 'Use a localized constant:\n```js\nconst greeting = "早上好，世界";\n```\nThat keeps the string out of templates.';
    const { text, leakedScripts } = sanitizeForeignScript(answer, 'How do I store a localized greeting constant in JS?');
    expect(leakedScripts).toEqual([]);
    expect(text).toBe(answer);
  });

  it('ignores a stray glyph below the threshold (no false positives)', () => {
    const answer = 'The symbol 中 means "middle".';
    const { text, leakedScripts } = sanitizeForeignScript(answer, 'What does that one symbol mean?');
    expect(leakedScripts).toEqual([]);
    expect(text).toBe(answer);
  });
});

describe('response-verification — verifyResponse', () => {
  it('passes a clean, confident answer through unchanged', () => {
    const verdict = verifyResponse({ text: 'The capital of France is Paris.', confidence: 0.9 });
    expect(verdict.action).toBe('pass');
    expect(verdict.changed).toBe(false);
  });

  it('reports sanitize when only leak lines were removed', () => {
    const verdict = verifyResponse({
      text: 'Real answer line.\n[scratch] thinking out loud about the next turn',
      confidence: 0.9,
    });
    expect(verdict.action).toBe('sanitize');
    expect(verdict.text).toBe('Real answer line.');
    expect(verdict.reasons).toContain('leak-stripped:1');
  });

  it('re-detects a decline in the produced text the entrance gate missed', () => {
    const verdict = verifyResponse({ text: "Honestly i don't know enough about that to answer." });
    expect(verdict.action).toBe('decline');
    expect(verdict.reasons).toContain('post-hoc-decline');
  });

  it('calibrates a thin-confidence answer (below the ceiling, above the floor)', () => {
    const verdict = verifyResponse({
      text: 'You should probably shard the table.',
      confidence: VERIFICATION_CALIBRATE_CEILING - 0.1,
    });
    expect(verdict.action).toBe('calibrate');
    expect(verdict.calibrationNote).toBe(DEFAULT_CALIBRATION_NOTE);
    expect(verdict.reasons.some((r) => r.startsWith('thin-confidence'))).toBe(true);
  });

  it('moves an existing calibration preamble into metadata', () => {
    const verdict = verifyResponse({
      text: 'Calibrated take (lower confidence on this topic): Use a smaller batch size.',
      confidence: 0.5,
    });
    expect(verdict.action).toBe('calibrate');
    expect(verdict.text).toBe('Use a smaller batch size.');
    expect(verdict.reasons).toContain('calibration-moved-to-metadata');
    expect(verdict.calibrationNote).toBe(DEFAULT_CALIBRATION_NOTE);
  });

  it('does NOT calibrate a high-confidence answer', () => {
    const verdict = verifyResponse({ text: 'Use Postgres for relational data.', confidence: 0.8 });
    expect(verdict.action).toBe('pass');
  });

  it('calibrates a confident factual claim with zero evidence only when opted in', () => {
    const input = {
      text: 'Yes, Tesla makes phones.',
      confidence: 0.7,
      hasEvidence: false,
    } as const;

    // Default (opt-out): a confident claim is NOT calibrated — avoids over-hedging.
    expect(verifyResponse(input).action).toBe('pass');

    // Opt-in: the unsupported confident assertion is calibrated (Confident-Bullshitter gate).
    const opted = verifyResponse({ ...input, config: { requireEvidenceForFactualClaims: true } });
    expect(opted.action).toBe('calibrate');
    expect(opted.reasons).toContain('unsupported-factual-claim');
  });

  it('does not calibrate an unsupported claim when it has evidence', () => {
    const verdict = verifyResponse({
      text: 'Yes, Coca-Cola contains sugar.',
      confidence: 0.7,
      hasEvidence: true,
      config: { requireEvidenceForFactualClaims: true },
    });
    expect(verdict.action).toBe('pass');
  });

  it('calibrates and cleans an answer that drifted into another writing system', () => {
    const verdict = verifyResponse({
      text: 'Vigelandsparken er verdt et besøk.\n奥斯陆是挪威的首都，有很多博物馆。\nDen er gratis og åpen hele døgnet.',
      prompt: 'Hva er en kjent severdighet i Oslo?',
      confidence: 0.8,
    });
    expect(verdict.action).toBe('calibrate');
    expect(verdict.reasons).toContain('foreign-script-stripped:cjk');
    expect(verdict.reasons).toContain('script-mismatch');
    expect(verdict.text).not.toMatch(/[\u4e00-\u9fff]/);
    expect(verdict.text).toContain('Vigelandsparken');
  });

  it('honors operator-supplied extra decline markers (configurable, localized)', () => {
    const localized = 'Beklager, det vet jeg ikke.';
    expect(verifyResponse({ text: localized }).action).toBe('pass');
    expect(
      verifyResponse({ text: localized, config: { extraDeclineMarkers: ['det vet jeg ikke'] } }).action,
    ).toBe('decline');
  });
});

describe('response-verification — typed grounding (fallback-arm)', () => {
  const ZORBLAX_PROMPT = "what's your honest take on the Zorblax-7 concurrency model in the Flimsy programming language?";

  it('classifies an answer about a different subject as contradicted', () => {
    const rustAnswer =
      'Rust is a systems programming language focused on safety, speed, and concurrency, created by Mozilla, with an ownership model and zero-cost abstractions across threads in production.';
    expect(classifyGrounding({ text: rustAnswer, prompt: ZORBLAX_PROMPT }, rustAnswer)).toBe('contradicted');
    const verdict = verifyResponse({ text: rustAnswer, prompt: ZORBLAX_PROMPT, arm: 'fallback' });
    expect(verdict.action).toBe('calibrate');
    expect(verdict.grounding).toBe('contradicted');
    expect(verdict.reasons).toContain('contradicted-topic');
  });

  it('classifies a confident claim with no evidence as ungrounded (the local-model case)', () => {
    const claim = 'The Zorblax-7 model is a preemptive scheduler that runs tasks at fixed intervals.';
    expect(classifyGrounding({ text: claim, prompt: ZORBLAX_PROMPT, hasEvidence: false }, claim)).toBe('ungrounded');
    // Fallback arm enables requireEvidence → calibrated, not leaked as confident.
    const verdict = verifyResponse({ text: claim, prompt: ZORBLAX_PROMPT, hasEvidence: false, arm: 'fallback', config: { requireEvidenceForFactualClaims: true } });
    expect(verdict.action).toBe('calibrate');
    expect(verdict.grounding).toBe('ungrounded');
  });

  it('calibrates assertive local-model explanations that avoid the narrow "is a" shape', () => {
    const outputs = [
      'The Zorblax-7 concurrency model in the Flimsy programming language is relatively straightforward, favoring lightweight threads over heavyweight processes.',
      'The Quibblr ORM handles migrations differently from its query planner. The ORM is primarily responsible for translating queries.',
    ];

    for (const text of outputs) {
      const verdict = verifyResponse({
        text,
        hasEvidence: false,
        arm: 'fallback',
        config: { requireEvidenceForFactualClaims: true },
      });
      expect(verdict.action).toBe('calibrate');
      expect(verdict.grounding).toBe('ungrounded');
    }
  });

  it('classifies an evidence-backed answer as grounded and passes it', () => {
    const ans = 'Yes, Coca-Cola contains sugar.';
    expect(classifyGrounding({ text: ans, hasEvidence: true }, ans)).toBe('grounded');
    expect(verifyResponse({ text: ans, hasEvidence: true, config: { requireEvidenceForFactualClaims: true } }).action).toBe('pass');
  });
});

describe('response-verification — confident-factual-claim detector', () => {
  it('flags assertive yes/no and "X is Y" claims', () => {
    expect(looksLikeConfidentFactualClaim('Yes, that is correct.')).toBe(true);
    expect(looksLikeConfidentFactualClaim('The capital of Japan is Tokyo.')).toBe(true);
    expect(looksLikeConfidentFactualClaim('The Quibblr ORM handles migrations differently from its query planner.')).toBe(true);
    expect(looksLikeConfidentFactualClaim('The Zorblax-7 concurrency model is relatively straightforward.')).toBe(true);
    expect(looksLikeConfidentFactualClaim('The Quibblr ORM handles migrations differently. It might vary by release.')).toBe(true);
  });

  it('does not flag hedged or tentative replies', () => {
    expect(looksLikeConfidentFactualClaim('I think it might be Tokyo, but I am not sure.')).toBe(false);
    expect(looksLikeConfidentFactualClaim('As far as I know, it is Tokyo.')).toBe(false);
  });
});

/**
 * Verification audit lane (Master.md §12.5.3).
 *
 * Scores the exit gate the same way the decline lane scores the entrance gate:
 *   - recall: scaffolding/drift leaks that MUST be caught
 *   - precision: genuine answers that must pass through untouched
 */
describe('verification audit lane', () => {
  // Produced text that must be sanitized or escalated (never surfaced raw).
  const SHOULD_INTERVENE: readonly string[] = [
    '[scratch] grounded continuation: keep this hidden\nThe real answer is 42.',
    'Here is the answer.\nlearn how and when to remove this message',
    "I don't have a confident answer for that yet.",
    'That sits outside my knowledge, so i would only be guessing.',
    'answer the next turn this way: be terse\nUse exponential backoff.',
  ];

  // Genuine answers that must pass through unchanged.
  const SHOULD_PASS: readonly string[] = [
    'Use a debounce so the handler runs once after the burst settles.',
    'The answer is to cap the upload size at the proxy boundary.',
    'You can scratch the surface of the API with a quick curl probe.',
    'A `Set` keeps only distinct values; spreading it back gives an array.',
    'Postgres is the right default for relational data with strong constraints.',
  ];

  it('intervenes on every leak/decline (recall) without touching genuine answers (precision)', () => {
    const missed = SHOULD_INTERVENE.filter((t) => verifyResponse({ text: t, confidence: 0.9 }).action === 'pass');
    const falsePos = SHOULD_PASS.filter((t) => verifyResponse({ text: t, confidence: 0.9 }).action !== 'pass');

    const recall = (SHOULD_INTERVENE.length - missed.length) / SHOULD_INTERVENE.length;
    const precision = (SHOULD_PASS.length - falsePos.length) / SHOULD_PASS.length;

    expect(missed, `missed interventions: ${JSON.stringify(missed)}`).toEqual([]);
    expect(falsePos, `false interventions: ${JSON.stringify(falsePos)}`).toEqual([]);
    expect(recall).toBe(1);
    expect(precision).toBe(1);
  });
});
