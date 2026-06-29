/**
 * answer-rubric - Vai's evidence-bound EXCELLENCE engine for council text answers.
 *
 * The text/council lane already grades whether Vai READ a prompt correctly
 * (brain.gradeInterpretation -> binary pass/fail). That tells the loop "did it
 * miss", but gives it no GRADIENT to climb: a barely-acceptable answer and an
 * excellent one both score "pass". This module is the text-side twin of
 * visual-rubric.mjs: it turns observable, MEASURED surface features of the answer
 * into a multi-dimension excellence score so the perpetual loop can measure how
 * excellent the council's produced result is, and improve on that over time.
 *
 * Like the visual rubric, every score is bound to a measured signal. It does NOT
 * judge truth (that is the evidence-binding lane's job) — it judges the craft of
 * the reply: grounding, directness, structure, calibration, specificity. Missing
 * signals score conservatively and say so; we never invent a compliment.
 *
 * Pure + side-effect free -> unit-testable without a runtime. The loop feeds it the
 * council answer; db persists the verdict; the operator surfaces the compact form.
 */
import { detectAnswerSignals } from './vague-answer.mjs';
import { groundingAnchors } from './grounding-gate.mjs';

const clamp = (n, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, n));
const round1 = (n) => Math.round(n * 10) / 10;
const SEV = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Empty-preamble throat-clearing that delays the actual answer ("Great question! ..."). */
const PREAMBLE = /^(great|good|excellent|interesting)\s+question|^(sure|certainly|of course|absolutely)[,!.]|^i'?d be happy to|^let'?s (?:dive|explore|take a look)/i;
/** A direct opener: gets to the substance instead of restating the prompt. */
const RESTATES_PROMPT = /^(you (?:are|'re) asking|to answer your question|in response to your question|the question of)/i;
/** Structure cues that make a non-trivial answer scannable. */
const HAS_LIST = /(^|\n)\s*(?:[-*]|\d+[.)])\s+/;
const HAS_PARAGRAPHS = /\n\s*\n/;

/**
 * Judge the excellence of a council text answer from measured surface signals.
 * @returns {{
 *   overall: number, scores: object, flaws: object[], flawCounts: object,
 *   lesson: string, headline: string
 * }}
 */
export function judgeAnswerExcellence(answer, opts = {}) {
  const sig = detectAnswerSignals(answer);
  const { text, words, confident, hedged, grounded, filler } = sig;
  const flaws = [];
  const add = (severity, symptom, evidence, fixDirection) =>
    flaws.push({ severity, symptom, evidence, fixDirection });

  if (text.length === 0) {
    return {
      overall: 0,
      scores: { grounding: 0, directness: 0, structure: 5, calibration: 5, specificity: 0 },
      flaws: [{ severity: 'P0', symptom: 'empty answer', evidence: 'no text produced', fixDirection: 'the turn must always produce a primary answer' }],
      flawCounts: { P0: 1, P1: 0, P2: 0, P3: 0 },
      lesson: 'An empty answer is the worst outcome — always produce a primary response.',
      headline: 'answer excellence 0/10 · empty answer',
    };
  }

  // GROUNDING — by anchor DEPTH, not the boolean `grounded` flag. One stray anchor in a long answer
  // used to score grounding=8 and dodge the "no concrete grounding" flaw (CodeRabbit #25). Score by
  // how many DISTINCT concrete anchors the answer carries: ≥2 is genuinely grounded, 1 is thin, 0 is
  // ungrounded prose. Short answers aren't penalised for thinness.
  const anchorDepth = groundingAnchors(text).anchors;
  let grounding = anchorDepth >= 2 ? 8 : anchorDepth === 1 ? 5 : 4;
  if (anchorDepth < 2 && words > 25) {
    grounding = anchorDepth === 1 ? 4 : 2;
    add('P1', 'no concrete grounding', `${words} words, ${anchorDepth} concrete anchor(s)`, 'cite a number, name, file ref, or worked example');
  }
  if (confident && anchorDepth < 2) { grounding = clamp(grounding - 1); }

  // DIRECTNESS - answers the question, no throat-clearing preamble / prompt-restating.
  let directness = 8;
  if (PREAMBLE.test(text)) { directness -= 3; add('P2', 'empty preamble before the answer', `opens with throat-clearing: "${text.slice(0, 40)}…"`, 'lead with the answer, drop the warm-up'); }
  if (RESTATES_PROMPT.test(text)) { directness -= 2; add('P3', 'restates the prompt before answering', `opens by restating: "${text.slice(0, 40)}…"`, 'skip restating; answer directly'); }
  directness = clamp(directness);

  // STRUCTURE - long answers should be scannable; short ones are fine as-is.
  let structure = 7;
  if (words > 120 && !HAS_LIST.test(text) && !HAS_PARAGRAPHS.test(text)) {
    structure = 3; add('P2', 'wall of text', `${words} words in one block, no list/paragraph breaks`, 'break into short paragraphs or a list');
  } else if (words > 60 && (HAS_LIST.test(text) || HAS_PARAGRAPHS.test(text))) {
    structure = 9;
  }

  // CALIBRATION - confidence matched to grounding; overconfident+ungrounded is "AI slop".
  let calibration = 7;
  if (confident && !hedged && !grounded) { calibration = 3; add('P1', 'overconfident and ungrounded', 'confident framing with no hedging and nothing concrete behind it', 'hedge where uncertain, or ground the claim'); }
  else if (confident && !hedged) { calibration = 5; }
  else if (hedged && grounded) { calibration = 9; }
  calibration = clamp(calibration);

  // SPECIFICITY - filler/empty-calorie phrasing drags it down.
  let specificity = grounded ? 8 : 5;
  if (filler >= 1) { specificity = clamp(specificity - filler * 2); add(filler >= 2 ? 'P2' : 'P3', `${filler} empty-filler phrase(s)`, 'generic padding that adds no information', 'cut filler; replace with a concrete detail'); }

  const scores = {
    grounding: round1(grounding),
    directness: round1(directness),
    structure: round1(structure),
    calibration: round1(calibration),
    specificity: round1(specificity),
  };
  // Weighted: grounding + calibration matter most (anti-slop is the owner's bar).
  let overall = round1(
    grounding * 0.3 + calibration * 0.25 + specificity * 0.2 + directness * 0.15 + structure * 0.1,
  );
  // Any P0/P1 flaw caps the ceiling — a real defect can't read as "excellent".
  if (flaws.some((f) => f.severity === 'P0')) overall = Math.min(overall, 3);
  else if (flaws.some((f) => f.severity === 'P1')) overall = Math.min(overall, 6);

  const flawCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of flaws) flawCounts[f.severity] += 1;
  const top = [...flaws].sort((a, b) => SEV[a.severity] - SEV[b.severity])[0] ?? null;

  return {
    overall,
    scores,
    flaws: flaws.sort((a, b) => SEV[a.severity] - SEV[b.severity]),
    flawCounts,
    lesson: deriveLesson(top, scores),
    headline:
      `answer excellence ${overall}/10 · ground ${scores.grounding} direct ${scores.directness} struct ${scores.structure} calib ${scores.calibration} spec ${scores.specificity}`
      + (top ? ` · top: [${top.severity}] ${top.symptom}` : ' · no flaws'),
  };
}

/** One reusable, deterministic lesson from the dominant flaw (how Vai builds answer taste). */
function deriveLesson(top, scores) {
  if (!top) return 'Grounded, calibrated, direct answer — keep this craft as the floor.';
  return `${top.symptom}: ${top.fixDirection}.`;
}
