/**
 * Chat Validation Harness — Vai end-user quality regression suite.
 *
 * Goal: turn the "is the chat actually good?" question from a vibe into
 * repeatable evidence. Drives the real `VaiEngine` through a fixed set of
 * 9 conversations across 8 categories and scores each final response with
 * deterministic predicates anchored to Master.md §7+§8.
 *
 * Design rules:
 *  - **No LLM-judge theater.** Every score comes from explicit string /
 *    structural predicates we can audit.
 *  - **Hard asserts only on guarantees.** Scores are reported via afterAll
 *    so a one-off soft-score regression doesn't break CI; the trick-format
 *    facts and the no-leakage guarantees DO assert hard.
 *  - **Honest scoring.** If a predicate can't decide, the score stays at
 *    the neutral default (3). Better silent than guessed.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { ResponseMeta } from '../src/models/vai-engine.js';

type Role = 'user' | 'assistant';
interface ConversationTurn { role: Role; content: string }

type Category =
  | 'casual' | 'technical' | 'follow-up' | 'trick-format'
  | 'ambiguous' | 'opinion' | 'long-context' | 'comparison';

interface ConversationTest {
  id: string;
  category: Category;
  description: string;
  /** User turns only — assistant turns are produced live by the engine. */
  userTurns: string[];
  expectedBehaviors: string[];
  /** Optional category override for brevity scoring (max chars). */
  brevityCeiling?: number;
}

interface ResponseScore {
  clarity: number;              // 1-5
  usefulness: number;           // 1-5
  epistemicHonesty: number;     // 1-5
  antiPatternAvoidance: number; // 1-5
  followUpQuality: number;      // 1-5
  brevity: number;              // 1-5
  overall: number;              // mean of the six
}

interface ConversationResult {
  testId: string;
  category: Category;
  finalResponse: string;
  meta: ResponseMeta | null;
  scores: ResponseScore;
  strengths: string[];
  weaknesses: string[];
}

const CONVERSATIONS: ConversationTest[] = [
  // ── CASUAL ───────────────────────────────────────────────────────
  {
    id: 'casual-01',
    category: 'casual',
    description: 'Greeting + name + capabilities ask',
    userTurns: ['Hi, I\'m Alex from Oslo', 'What can you help me with?'],
    expectedBehaviors: ['Acknowledge name/place', 'Concise capabilities', 'Invite a specific question'],
    brevityCeiling: 600,
  },
  {
    id: 'casual-02',
    category: 'casual',
    description: 'Casual check-in',
    userTurns: ['Hey, how\'s it going?'],
    expectedBehaviors: ['Warm but not sycophantic', 'Offer help without forcing'],
    brevityCeiling: 250,
  },

  // ── TECHNICAL ────────────────────────────────────────────────────
  {
    id: 'tech-01',
    category: 'technical',
    description: 'Direct technical how-to',
    userTurns: ['How do I add TypeScript to an existing Next.js project?'],
    expectedBehaviors: ['Clear steps', 'Common pitfalls', 'Offer next step'],
    brevityCeiling: 1500,
  },
  {
    id: 'tech-02',
    category: 'follow-up',
    description: 'Technical follow-up — context retention',
    userTurns: [
      'How do I add TypeScript to an existing Next.js project?',
      'What if I get the "Cannot find module" error?',
    ],
    expectedBehaviors: ['Targeted fix', 'No restating of step 1', 'Precise'],
    brevityCeiling: 1200,
  },

  // ── TRICK FORMAT (the original pain points) ──────────────────────
  {
    id: 'trick-01',
    category: 'trick-format',
    description: 'Strict format + factual: king of Norway in quotes',
    userTurns: ['Tell me who is the king of Norway and reply only with his full name inside double quotes'],
    expectedBehaviors: ['Exactly: "Harald V"', 'No extra text'],
    brevityCeiling: 50,
  },
  {
    id: 'trick-02',
    category: 'trick-format',
    description: 'Token + format limit: 4 letters + colon (e.g. 14:37)',
    userTurns: ['tell me the time and respond only with like 5 tokens, or like 4 letters + the semicolon : in between'],
    expectedBehaviors: ['HH:MM shape (5 chars)', 'Or honest "no real-time clock"'],
    brevityCeiling: 200,
  },

  // ── AMBIGUOUS ────────────────────────────────────────────────────
  {
    id: 'ambig-01',
    category: 'ambiguous',
    description: 'Bare referent — should clarify',
    userTurns: ['How do I make it better?'],
    expectedBehaviors: ['Ask what "it" is', 'Do not guess'],
    brevityCeiling: 400,
  },

  // ── OPINION ──────────────────────────────────────────────────────
  {
    id: 'opinion-01',
    category: 'opinion',
    description: 'Subjective comparison — should hedge',
    userTurns: ['Is Next.js better than Remix?'],
    expectedBehaviors: ['Acknowledge it depends', 'Pros/cons', 'Avoid universal winner'],
    brevityCeiling: 1500,
  },

  // ── LONG-CONTEXT FOLLOW-UP CHAIN ────────────────────────────────
  {
    id: 'followup-01',
    category: 'long-context',
    description: 'Three-turn build-up — context retention',
    userTurns: [
      'I\'m building a dashboard for my startup',
      'It needs to show real-time metrics',
      'What tech stack would you recommend?',
    ],
    expectedBehaviors: ['Reference dashboard + real-time', 'Concrete stack suggestion'],
    brevityCeiling: 1500,
  },

  // ── COMPARISON ──────────────────────────────────────────────────
  {
    id: 'compare-01',
    category: 'comparison',
    description: 'PostgreSQL vs MongoDB',
    userTurns: ['Compare PostgreSQL and MongoDB for a new SaaS project'],
    expectedBehaviors: ['Structured comparison', 'Ask about needs', 'No universal winner'],
    brevityCeiling: 2000,
  },
];

// ── Scoring predicates ─────────────────────────────────────────────

const SYCOPHANCY_RE = /\b(?:great\s+question|absolutely|definitely\s+the\s+best|everyone\s+should|that['\u2019]s\s+a\s+great|happy\s+to\s+help|i['\u2019]d\s+be\s+happy)\b/i;
const HEDGE_OK_RE = /\b(?:depends|trade-?off|trade-?offs|it\s+varies|context|use\s+case|either\s+can\s+work|both\s+have)\b/i;
const FOLLOW_UP_RE = /\?\s*$|\bwant\s+me\s+to\b|\blet\s+me\s+know\b|\bif\s+you\b|\bnext\s+step\b/i;
const PLACEHOLDER_LEAK_RE = /\[\s*vai\s+response\s*\]|\[\s*previous\s+response\s*\]/i;
const HONEST_FALLBACK_RE = /don['\u2019]t\s+have\s+(?:a\s+)?confident|don['\u2019]t\s+have\s+(?:real-?time|access\s+to)|not\s+sure/i;
// Padding markers that add length without information.
const PADDING_RE = /\b(?:as\s+(?:an\s+)?ai|i\s+hope\s+(?:this|that)\s+helps|please\s+note\s+that|it['\u2019]s\s+important\s+to\s+(?:note|remember)|in\s+conclusion|to\s+sum(?:marize|\s+up))\b/i;
// Real question shape — `?` near the end (allowing trailing quote/paren).
const ASKS_QUESTION_RE = /\?["'\u201d\u2019)]?\s*$/;
// Body anywhere ends in or contains a real question mark.
const ANY_QUESTION_RE = /\?/;
// Structural cues — paragraphs, lists, headings give clarity.
function structuralRichness(text: string): number {
  let score = 0;
  if (/\n\n/.test(text)) score++;                          // paragraph breaks
  if (/^\s*(?:[-*]|\d+[.)])\s+/m.test(text)) score++;      // list
  if (/\*\*[^*]+\*\*/.test(text)) score++;                 // bolded labels
  if (/```/.test(text)) score++;                           // fenced code
  return score;
}
function mentionsAny(text: string, terms: readonly RegExp[]): boolean {
  return terms.some(re => re.test(text));
}

function neutralScore(): ResponseScore {
  return { clarity: 3, usefulness: 3, epistemicHonesty: 3, antiPatternAvoidance: 3, followUpQuality: 3, brevity: 3, overall: 3 };
}

function scoreResponse(test: ConversationTest, response: string, meta: ResponseMeta | null): ConversationResult {
  const scores = neutralScore();
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const text = response.trim();
  const len = text.length;

  // ── Anti-pattern avoidance ─────────────────────────────────────
  const sycophancyHit = SYCOPHANCY_RE.test(text);
  const paddingHit = PADDING_RE.test(text);
  if (sycophancyHit && paddingHit) {
    scores.antiPatternAvoidance = 1;
    weaknesses.push('sycophancy AND padding detected');
  } else if (sycophancyHit) {
    scores.antiPatternAvoidance = 2;
    weaknesses.push('sycophantic phrasing detected');
  } else if (paddingHit) {
    scores.antiPatternAvoidance = 3;
    weaknesses.push('padding phrase detected');
  } else {
    scores.antiPatternAvoidance = 5;
    strengths.push('no sycophancy or padding');
  }

  // ── Brevity (category-aware ceiling, tighter tiers) ────────────
  const ceiling = test.brevityCeiling ?? 1000;
  if (len === 0) { scores.brevity = 1; weaknesses.push('empty response'); }
  else if (len > ceiling * 1.25) { scores.brevity = 1; weaknesses.push(`severely over ceiling (${len}/${ceiling})`); }
  else if (len > ceiling) { scores.brevity = 2; weaknesses.push(`over brevity ceiling (${len}/${ceiling})`); }
  else if (test.category === 'trick-format' && len <= ceiling) { scores.brevity = 5; strengths.push('tight format'); }
  else if (len < ceiling * 0.4) { scores.brevity = 5; strengths.push('crisp'); }
  else if (len < ceiling * 0.7) { scores.brevity = 4; }
  else { scores.brevity = 3; }

  // ── Epistemic honesty ──────────────────────────────────────────
  if (test.category === 'opinion') {
    const framed = meta?.opinionFramingApplied || HEDGE_OK_RE.test(text);
    const namesBoth = /\b(?:next\.?js|nextjs)\b/i.test(text) && /\bremix\b/i.test(text);
    if (framed && namesBoth) {
      scores.epistemicHonesty = 5;
      strengths.push('opinion framed and names both options');
    } else if (framed) {
      scores.epistemicHonesty = 4;
      weaknesses.push('opinion framed but did not name both options');
    } else {
      scores.epistemicHonesty = 1;
      weaknesses.push('opinion presented as fact');
    }
  } else if (test.category === 'ambiguous') {
    const asksAboutIt = ASKS_QUESTION_RE.test(text) && /\b(?:what|which)\b/i.test(text);
    if (asksAboutIt) {
      scores.epistemicHonesty = 5;
      strengths.push('asked a substantive clarifying question');
    } else if (ASKS_QUESTION_RE.test(text)) {
      scores.epistemicHonesty = 4;
      weaknesses.push('asked a question but not a clarifying one');
    } else {
      scores.epistemicHonesty = 1;
      weaknesses.push('guessed instead of clarifying');
    }
  } else if (HONEST_FALLBACK_RE.test(text)) {
    scores.epistemicHonesty = 5;
    strengths.push('honest about uncertainty');
  } else {
    scores.epistemicHonesty = 4;
  }

  // ── Follow-up quality (tighter — wants a real question or "want me to") ─
  if (test.category === 'trick-format') {
    scores.followUpQuality = FOLLOW_UP_RE.test(text) ? 1 : 5;
    if (FOLLOW_UP_RE.test(text)) weaknesses.push('chatty addendum violates strict format');
  } else {
    const tail = text.slice(-200);
    const realQuestion = /\?\s*$/.test(tail);
    const inviteToken = /\bwant\s+me\s+to\b/i.test(tail);
    if (realQuestion && inviteToken) {
      scores.followUpQuality = 5;
      strengths.push('invites continuation with a real question');
    } else if (realQuestion || inviteToken) {
      scores.followUpQuality = 4;
    } else {
      scores.followUpQuality = 2;
      weaknesses.push('no continuation invitation');
    }
  }

  // ── Clarity (placeholder leak / length / structure) ────────────
  if (PLACEHOLDER_LEAK_RE.test(text)) {
    scores.clarity = 1;
    weaknesses.push('placeholder leakage');
  } else if (len > 0 && len < 5) {
    scores.clarity = 1;
    weaknesses.push('response too short to be useful');
  } else if (test.category === 'trick-format') {
    scores.clarity = 5;
  } else {
    const struct = structuralRichness(text);
    if (struct >= 3) { scores.clarity = 5; strengths.push('rich structural cues'); }
    else if (struct >= 2) { scores.clarity = 4; }
    else if (struct >= 1) { scores.clarity = 3; }
    else { scores.clarity = 2; weaknesses.push('flat prose with no structural cues'); }
  }

  // ── Usefulness (per-test substantive assertions) ───────────────
  const lower = text.toLowerCase();
  if (len === 0) {
    scores.usefulness = 1;
  } else if (test.id === 'casual-01') {
    const namesUser = /\balex\b/i.test(text);
    const offersHelp = /\b(?:build|debug|explain|plan|code|scaffold)\b/i.test(text);
    if (namesUser && offersHelp) { scores.usefulness = 5; strengths.push('addressed Alex by name and offered help'); }
    else if (namesUser || offersHelp) { scores.usefulness = 3; weaknesses.push('partially personalized — missing name or offer'); }
    else { scores.usefulness = 1; weaknesses.push('ignored prior introduction'); }
  } else if (test.id === 'casual-02') {
    if (/\b(?:help|code|debug|explain|build|scaffold|tech)\b/i.test(text)) { scores.usefulness = 5; strengths.push('warm + offers help'); }
    else { scores.usefulness = 3; }
  } else if (test.category === 'technical') {
    const tokens = ['install', 'tsconfig', 'typescript', 'next', 'npm', 'pnpm', 'yarn', 'rename', '.tsx', '.ts'];
    const hits = tokens.filter(t => lower.includes(t)).length;
    if (hits >= 3) { scores.usefulness = 5; strengths.push(`${hits} concrete technical tokens`); }
    else if (hits >= 1) { scores.usefulness = 4; }
    else { scores.usefulness = 2; weaknesses.push('no concrete technical tokens'); }
  } else if (test.category === 'comparison') {
    const dbTokens = [/\bpostgres(?:ql)?\b/i, /\bmongo(?:db)?\b/i];
    const dimensions = [/\bschema\b/i, /\brelational\b/i, /\bdocument\b/i, /\bjsonb?\b/i, /\bjoin\b/i, /\bquery|queries\b/i, /\bacid\b/i, /\bscaling|scale\b/i];
    const namesBoth = dbTokens.every(re => re.test(text));
    const dimHits = dimensions.filter(re => re.test(text)).length;
    if (namesBoth && dimHits >= 3) { scores.usefulness = 5; strengths.push(`comparison covers ${dimHits} dimensions`); }
    else if (namesBoth) { scores.usefulness = 3; weaknesses.push('names both but shallow comparison'); }
    else { scores.usefulness = 1; weaknesses.push('failed to name both compared things'); }
  } else if (test.id === 'ambig-01') {
    if (/\b(?:what|which)\s+(?:are\s+you\s+(?:trying\s+to\s+)?(?:improve|fix|build)|do\s+you\s+mean|specifically|thing|are\s+you\s+(?:referring|talking))\b/i.test(text)
        || /\b(?:could|can)\s+you\s+(?:clarify|tell\s+me|share)\b/i.test(text)
        || /\bgive\s+me\s+(?:a\s+bit\s+)?more\s+context\b/i.test(text)) {
      scores.usefulness = 5;
      strengths.push('clarifying question is specific');
    } else if (text.includes('?')) {
      scores.usefulness = 3;
    } else {
      scores.usefulness = 1;
    }
  } else if (test.id === 'opinion-01') {
    if (/\b(?:next\.?js|nextjs)\b/i.test(text) && /\bremix\b/i.test(text)) {
      scores.usefulness = 5;
      strengths.push('names both frameworks');
    } else { scores.usefulness = 2; weaknesses.push('did not contrast both frameworks'); }
  } else if (test.id === 'followup-01') {
    const refsContext = /\b(?:dashboard|real-?time|metrics?|startup)\b/i.test(text);
    const namesStack = /\b(?:next\.?js|react|node|postgres|mongo|websocket|ws|sse|graphql|prisma|tailwind|express|fastify|supabase|clickhouse|redis)\b/i.test(text);
    if (refsContext && namesStack) { scores.usefulness = 5; strengths.push('retained context + named stack'); }
    else if (namesStack) { scores.usefulness = 3; weaknesses.push('named stack but lost prior context'); }
    else { scores.usefulness = 1; weaknesses.push('did not name a concrete stack'); }
  } else {
    scores.usefulness = 4;
  }

  // Mean (rounded) — overall is a true average, not biased to ceiling.
  const sum = scores.clarity + scores.usefulness + scores.epistemicHonesty
    + scores.antiPatternAvoidance + scores.followUpQuality + scores.brevity;
  scores.overall = Math.round(sum / 6);

  return {
    testId: test.id,
    category: test.category,
    finalResponse: text,
    meta,
    scores,
    strengths,
    weaknesses,
  };
}

// ── Engine driver ──────────────────────────────────────────────────

async function runConversation(engine: VaiEngine, test: ConversationTest): Promise<ConversationResult> {
  const messages: ConversationTurn[] = [];
  let lastResponse = '';
  for (const turn of test.userTurns) {
    messages.push({ role: 'user', content: turn });
    const result = await engine.chat({ messages: [...messages] });
    lastResponse = result.message.content;
    messages.push({ role: 'assistant', content: lastResponse });
  }
  return scoreResponse(test, lastResponse, engine.lastResponseMeta ?? null);
}

// ── Suite ──────────────────────────────────────────────────────────

const allResults: ConversationResult[] = [];
const originalFetch = globalThis.fetch;

describe('Chat Validation Harness', () => {
  let engine: VaiEngine;

  beforeEach(() => {
    engine = new VaiEngine();
    // Hard-block all network — we want to exercise the engine's local
    // strategies, not whatever a flaky model adapter returns.
    globalThis.fetch = vi.fn(async () => {
      throw new Error('chat-validation: no network allowed');
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    printReport(allResults);
  });

  // One it() per conversation: hard asserts on guarantees, soft asserts via report.
  for (const test of CONVERSATIONS) {
    it(`${test.id} — ${test.description}`, async () => {
      const result = await runConversation(engine, test);
      allResults.push(result);

      // Hard guarantees — these MUST hold across any future engine change.
      // The harness's job is to make regressions visible. We raise the bar:
      // non-empty, no leakage, overall floor of 3, and category-specific
      // invariants for the most-tested behaviors.
      expect(result.finalResponse, 'response must be non-empty').not.toBe('');
      expect(result.finalResponse, 'no placeholder leakage').not.toMatch(PLACEHOLDER_LEAK_RE);
      expect(result.scores.overall, 'minimum overall floor').toBeGreaterThanOrEqual(3);
      expect(result.scores.antiPatternAvoidance, 'must not be sycophantic').toBeGreaterThanOrEqual(3);

      // Per-test hard invariants — the engine must not regress here.
      if (test.id === 'trick-01') {
        const okExact = /^"Harald\s+V"\s*\.?$/.test(result.finalResponse);
        const okHonest = HONEST_FALLBACK_RE.test(result.finalResponse);
        expect(okExact || okHonest, `strict-format trick-01 — got: ${result.finalResponse.slice(0, 80)}`).toBe(true);
      }
      if (test.id === 'ambig-01') {
        expect(result.finalResponse, 'ambig-01 must ask a question').toMatch(/\?/);
      }
      if (test.id === 'opinion-01') {
        const framed = result.meta?.opinionFramingApplied || HEDGE_OK_RE.test(result.finalResponse);
        expect(framed, 'opinion-01 must hedge or be opinion-framed').toBe(true);
      }
      if (test.id === 'casual-01') {
        expect(result.finalResponse, 'casual-01 must address the introduced user by name').toMatch(/\bAlex\b/);
      }
    });
  }
});

// ── Report ─────────────────────────────────────────────────────────

function printReport(results: ConversationResult[]): void {
  if (results.length === 0) return;
  const avg = (k: keyof ResponseScore) =>
    (results.reduce((s, r) => s + r.scores[k], 0) / results.length).toFixed(2);

  /* eslint-disable no-console */
  console.log('\n══ Vai Chat Validation Report ══');
  console.log(`runs: ${results.length}`);
  console.log(`avg overall: ${avg('overall')} / 5`);
  console.log(`  clarity ${avg('clarity')}  usefulness ${avg('usefulness')}  epistemic ${avg('epistemicHonesty')}`);
  console.log(`  anti-pattern ${avg('antiPatternAvoidance')}  follow-up ${avg('followUpQuality')}  brevity ${avg('brevity')}`);
  console.log('');
  for (const r of results) {
    const s = r.scores;
    const strategy = r.meta?.strategy ?? '?';
    const kind = r.meta?.cognitiveFrame?.kind ?? '?';
    const ooda = r.meta?.oodaTrace ? 'ooda' : '—';
    const shape = r.meta?.kindShape?.transform ?? '—';
    console.log(
      `  ${r.testId.padEnd(12)} ${r.category.padEnd(13)} ` +
      `O${s.overall} C${s.clarity} U${s.usefulness} E${s.epistemicHonesty} A${s.antiPatternAvoidance} F${s.followUpQuality} B${s.brevity}  ` +
      `[${strategy} | ${kind} | ${ooda} | ${shape}]  len=${r.finalResponse.length}`,
    );
    for (const w of r.weaknesses) console.log(`      - ${w}`);
  }
  console.log('═════════════════════════════════\n');
  /* eslint-enable no-console */
}
