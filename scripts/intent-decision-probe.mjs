#!/usr/bin/env node
/**
 * intent-decision-probe — trace the DECISION LAYER for a battery of hard prompts,
 * in-process (no live server). For each prompt it prints every classifier verdict
 * plus the mode directive that would be injected, so we can SEE the pattern of how
 * intent is understood vs. how the turn would be acted on — the "understanding →
 * action" audit V3gga asked for before we fix more.
 *
 * It deliberately covers the hard classes:
 *   - single clear intent (control)
 *   - build vs. answer ambiguity (the todo-app hijack class)
 *   - MULTI-INTENT in one sentence ("explain X and build me Y")
 *   - MULTI-STEP / reasoning ("compare A and B then recommend one")
 *   - compound questions ("what is X and what is Y")
 *
 * Run: node scripts/intent-decision-probe.mjs
 * Reads pure classifiers from @vai/core src (via tsx). No DB, no model, no network.
 */
import { classifyQuestionIntent, classifyQuestionIntentSmart, splitCompoundQuestion } from '../packages/core/src/chat/question-intent.ts';
import { classifyAgentBuildIntent } from '../packages/core/src/chat/build-execution-intent.ts';
import { classifyTurn } from '../packages/core/src/chat/turn-classifier.ts';
import { scoreQuestionIntent, debugScoreQuestionIntent } from '../packages/core/src/chat/intent-scorer.ts';
import { agentIntentLeadDirective } from '../packages/core/src/chat/modes.ts';
import { detectMultiIntent } from '../packages/core/src/chat/multi-intent.ts';

const PROMPTS = [
  // ── single clear intent (controls) ──
  { class: 'control-fact', q: 'What is the capital of Norway?' },
  { class: 'control-build', q: 'Build me a Next.js todo app with Tailwind.' },
  // ── the reported hijack class ──
  { class: 'hijack-answer', q: 'What are great tools for computer intelligence to use?' },
  { class: 'hijack-answer', q: 'What should I use to build a REST API?' },
  { class: 'hijack-answer', q: 'How do people usually structure a monorepo?' },
  // ── MULTI-INTENT in one sentence (answer + build) ──
  { class: 'multi-intent', q: 'Explain how JWT auth works and then build me a login page that uses it.' },
  { class: 'multi-intent', q: 'What is Zustand and can you scaffold a store for a cart?' },
  // ── MULTI-STEP reasoning (compare then recommend) ──
  { class: 'multi-step', q: 'Compare Postgres and SQLite for a small app and recommend one.' },
  { class: 'multi-step', q: 'Walk me through the tradeoffs of SSR vs CSR then tell me which to pick for a blog.' },
  // ── compound questions (two facts) ──
  { class: 'compound', q: 'What is the capital of Japan and what is the currency of Brazil?' },
  { class: 'compound', q: 'Who wrote Hamlet and when was it written?' },
  // ── ambiguous build-ish ──
  { class: 'ambiguous', q: 'Can you make this more useful?' },
  { class: 'ambiguous', q: 'improve the timeline ui' },
];

function pad(s, n) { return String(s).padEnd(n); }

function traceOne({ class: cls, q }) {
  const regex = classifyQuestionIntent(q);
  const smart = classifyQuestionIntentSmart(q);
  const agentBuild = classifyAgentBuildIntent(q);
  const turn = classifyTurn(q, []);
  const scored = debugScoreQuestionIntent(q);
  const split = splitCompoundQuestion(q);
  const agentLead = agentIntentLeadDirective(agentBuild);

  // The "action" the agent path would take: build-lead vs answer-lead vs neither.
  const agentAction = agentBuild === 'build'
    ? 'BUILD (full build prompt)'
    : agentBuild === 'answer'
      ? 'ANSWER (no-scaffold lead injected)'
      : 'AMBIGUOUS (desktop confirm banner)';

  // The tell for a MISMATCH we should worry about: multiple intents but the agent
  // path collapses to a single build/answer decision, or a compound question that
  // splits but the intent is treated as one.
  const multi = detectMultiIntent(q);
  const flags = [];
  if (split && split.length > 1) flags.push(`compound×${split.length}`);
  if (multi.isMultiIntent) {
    flags.push(`MULTI-INTENT[${multi.parts.map((p) => p.action).join('+')}]`);
  } else if (/\band\b|\bthen\b/i.test(q) && agentBuild !== 'ambiguous') {
    flags.push('and/then-but-single');
  }
  if (regex === 'other' && smart.source === 'scorer') flags.push(`recovered→${smart.intent}`);
  if (regex === 'other' && smart.intent === 'other') flags.push('UNCLASSIFIED');

  return { cls, q, regex, smart: `${smart.intent}/${smart.source}`, agentBuild, turn: turn.kind, scoredTop: `${scored.top.intent}@${scored.margin.toFixed(2)}`, split: split ? split.length : 0, agentAction, hasLead: agentLead.length > 0, flags };
}

console.log('\n=== INTENT DECISION PROBE ===\n');
console.log('Legend: regex=fast classifier · smart=with scorer fallback · agentBuild=build/answer/ambiguous · turn=shape · action=what agent mode would DO\n');

let prevClass = '';
for (const p of PROMPTS) {
  const r = traceOne(p);
  if (r.cls !== prevClass) { console.log(`\n── ${r.cls} ──`); prevClass = r.cls; }
  console.log(`  Q: ${r.q}`);
  console.log(`     regex=${pad(r.regex, 15)} smart=${pad(r.smart, 22)} agentBuild=${pad(r.agentBuild, 10)} turn=${pad(r.turn, 30)}`);
  console.log(`     scorer=${pad(r.scoredTop, 24)} compoundParts=${r.split}  action=${r.agentAction}`);
  if (r.flags.length) console.log(`     ⚑ ${r.flags.join(' · ')}`);
}
console.log('\n=== END ===\n');
