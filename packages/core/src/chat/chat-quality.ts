import type { ConversationMode } from './modes.js';
import type { Message } from '../models/adapter.js';

/**
 * Extra system guidance when the user message likely needs a structured, scannable answer.
 * Improves multi-question, comparison, and long-context chat without affecting every turn.
 */
export const CHAT_STRUCTURE_SYSTEM_HINT = [
  'Response format hint: the user message likely benefits from a scannable answer (multiple questions, comparison, or long prompt).',
  'Put the direct takeaway in the first 1–2 sentences, then use short headings or numbered bullets.',
  'Avoid one wall of prose; keep each bullet one idea.',
].join(' ');

const TEMPORARY_PLAN_MODE_PATTERN =
  /\b(walk me through|step(?:\s|-)?by(?:\s|-)?step|help me debug|how do i debug|how should i debug|debug|diagnos(?:e|is)|troubleshoot|root cause|what should i check|what should i change first|migration plan|rollout plan|incident response|how do i fix|how should i fix)\b/i;

const RECOMMENDATION_PATTERN =
  /\b(which should i use|what should i use|what should i choose|what do you recommend|which option|best option|which should i change first|what should i change first|what would you change first|what would you pick|should i use|fix first|change first)\b/i;

const CURRENTNESS_PATTERN =
  /\b(current|latest|today|right now|as of|recent|newest|up-to-date|stable version)\b/i;

const CORRECTIVE_TURN_PATTERN =
  /^(?:no\b|no,|not exactly|that(?:'s| is) not|i mean|more specifically|to be clear|instead\b|rather\b|let me rephrase|what i meant|closer to)\b/i;

const DEBUG_PATTERN =
  /\b(debug|diagnos(?:e|is)|troubleshoot|root cause|crash(?:ing)?|fails?|failing|broken|error|stack trace|logs?)\b/i;

/** Short factual question — expects a direct, concise answer (1–3 sentences max). */
const SHORT_FACTUAL_PATTERN =
  /^(?:what(?:'s| is| are| was| were)|who(?:'s| is| are| was)|where(?:'s| is| are)|when(?:'s| is| was| did)|how (?:many|much|old|long|far|often|big)|is (?:there|it|this)|does |do |did |can |could |will |would |should |has |have )\b.{0,120}\?\s*$/i;

/** Practical how-to question — expects actionable steps or a working recipe. */
const HOW_TO_PATTERN =
  /^(?:how (?:do|can|should|would) (?:i|you|we)|how to |what(?:'s| is) the (?:best|right|correct|proper|fastest|easiest) way to|show me how)\b/i;

/** Code-specific question — expects an example or snippet up front. */
const CODE_QUESTION_PATTERN =
  /\b(code|snippet|example|function|implement|syntax|write|sample|usage|pattern|import|module|package|library|api|method|class)\b.{0,60}\?/i;

/** Explanation / conceptual question — expects a layered, progressively deeper answer. */
const EXPLAIN_PATTERN =
  /^(?:explain|describe|what does .+ (?:mean|do)|how does .+ work|why (?:does|is|do|are|did|was)|can you explain|what happens when|break down|walk through|what(?:'s| is) the (?:difference|distinction) between)\b/i;

/** Vague or ultra-broad prompt — needs narrowing with a concrete default before answering. */
const VAGUE_BROAD_PATTERN =
  /^(?:tell me about|talk about|anything about|thoughts on|what about|info on|general|overview of|everything about)\b.{0,60}$/i;

/** Follow-up that references prior context ("it", "that", "this", "the thing", "above"). */
const CONTEXTUAL_FOLLOWUP_PATTERN =
  /^(?:and |also |but |what about |how about |can (?:you|it) also|now |ok |okay |so |then |what if )\b|\b(?:the (?:one|thing|part|issue|error|code) (?:you|above|before|earlier|we)|you (?:just |mentioned|said|showed))\b/i;

/**
 * Instruction constraint — the user is explicitly asking for a minimal,
 * literal answer shape ("only reply with the name", "one-word answer",
 * "no preamble", "just say X", "in one sentence").
 *
 * Hitting any of these means we need to strip the usual rambling and
 * respond with only what was asked for.
 */
const INSTRUCTION_CONSTRAINT_PATTERN = new RegExp(
  [
    // "reply with only ...", "answer with only ...", "respond with only ..."
    "\\b(?:please\\s+)?(?:only\\s+)?(?:reply|respond|answer|say|write|output|return|give\\s+me)\\s+(?:me\\s+)?(?:with\\s+|using\\s+|in\\s+)?only\\b",
    // "just reply with ...", "just say ...", "just give ..."
    "\\bjust\\s+(?:reply|respond|answer|say|write|give|tell\\s+me|output)\\b",
    // "only reply with the name / number / year"
    "\\bonly\\s+(?:reply|respond|answer|say|write|give|output|provide|tell\\s+me)\\b",
    // "one-word answer", "single word", "one word answer"
    "\\b(?:one[-\\s]?word|single\\s+word|single\\s+sentence|one\\s+sentence|one[-\\s]?line)\\s+(?:answer|reply|response)\\b",
    // "in one sentence", "in one word", "in one line"
    "\\bin\\s+(?:one|a\\s+single)\\s+(?:word|sentence|line)\\b",
    // "no more", "nothing else", "nothing more", "no preamble", "no explanation"
    "\\b(?:no\\s+(?:more|preamble|explanation|filler|fluff|intro|introduction|context|details?|commentary)|nothing\\s+(?:else|more|extra))\\b",
    // "reply with the name/number/year/date of X"
    "\\breply\\s+with\\s+(?:the|a|an)\\s+(?:name|number|year|date|value|answer|word|letter|digit)\\b",
    // "what's the name", "just the name", "only the name"
    "\\b(?:just|only)\\s+(?:the|a|an)\\s+(?:name|number|year|date|answer|word|value|letter|digit)\\b",
  ].join('|'),
  'i',
);

export function detectInstructionConstraint(userContent: string): boolean {
  const trimmed = userContent.trim();
  if (trimmed.length === 0) return false;
  return INSTRUCTION_CONSTRAINT_PATTERN.test(trimmed);
}

const MULTI_QUESTION_PATTERN = /\?[\s\S]{0,800}\?/;

const STRUCTURE_KEYWORDS_PATTERN =
  /\b(compare|versus|vs\.|\bvs\b|trade-?offs?|pros and cons|advantages and disadvantages|walk me through|step[s-]by|bullet points|checklist|enumerate|list out|break down)\b/i;

/**
 * Retrieval threshold for knowledge injection.
 * At 0.04 almost any document passes, injecting noise for generation tasks.
 * 0.18 means the snippet must share ~18% of query words with the chunk text
 * before it is injected — low enough to help recall questions, high enough
 * to not pollute "build me a website" prompts with random captured pages.
 */
export const KNOWLEDGE_RETRIEVAL_SCORE_MIN = 0.18;

/**
 * Regex that matches generation / build intents.
 * When the user message clearly wants code output, skip RAG injection
 * entirely — retrieved web captures won't help and will add noise.
 */
const GENERATION_INTENT_PATTERN =
  /\b(build|create|make|scaffold|generate|spin up|bootstrap|start|init|write me|code me|give me the code|ship|launch|deploy)\b.{0,80}(app|site|website|page|landing|portfolio|dashboard|component|api|server|backend|frontend|project|template|starter|shop|store)\b/i;

export function isGenerationIntent(userContent: string): boolean {
  return GENERATION_INTENT_PATTERN.test(userContent.trim());
}

export function shouldInjectChatStructureHint(mode: ConversationMode, userContent: string): boolean {
  if (mode !== 'chat') return false;
  const trimmed = userContent.trim();
  if (trimmed.length < 24) return false;

  const questionMarks = (trimmed.match(/\?/g) ?? []).length;
  if (questionMarks >= 2 || MULTI_QUESTION_PATTERN.test(trimmed)) return true;

  if (STRUCTURE_KEYWORDS_PATTERN.test(trimmed)) return true;

  if (trimmed.length >= 280) return true;

  return false;
}

export function resolveTemporaryTurnMode(mode: ConversationMode, userContent: string): 'plan' | null {
  if (mode !== 'chat') return null;

  const trimmed = userContent.trim();
  if (trimmed.length < 18) return null;

  return TEMPORARY_PLAN_MODE_PATTERN.test(trimmed) ? 'plan' : null;
}

export function buildTemporaryModeOverrideSystemHint(mode: 'plan'): string {
  if (mode === 'plan') {
    return [
      'Temporary mode override for this answer: Plan mode.',
      'The conversation itself remains in Chat mode.',
      'Respond with a concrete ordered plan or diagnosis.',
      'Lead with the first action or conclusion, then 3-7 clear steps.',
      'When debugging, prioritize likely cause, first checks, how to confirm, and the next action.',
    ].join(' ');
  }

  return 'Temporary mode override for this answer: Plan mode.';
}

export function buildChatTurnQualitySystemHint(
  mode: ConversationMode,
  userContent: string,
  history: readonly Pick<Message, 'role' | 'content'>[],
): string | null {
  if (mode !== 'chat') return null;

  const trimmed = userContent.trim();
  const isInstructionConstrainedEarly = detectInstructionConstraint(trimmed);
  // Instruction-constrained turns always get the contract even when short.
  if (trimmed.length < 18 && !isInstructionConstrainedEarly) return null;

  const hasPriorAssistantTurn = history.some((message) => message.role === 'assistant');
  const isCorrectiveTurn = hasPriorAssistantTurn && CORRECTIVE_TURN_PATTERN.test(trimmed);
  const needsRecommendation = RECOMMENDATION_PATTERN.test(trimmed);
  const freshnessSensitive = CURRENTNESS_PATTERN.test(trimmed);
  const debugLike = DEBUG_PATTERN.test(trimmed);
  const temporaryMode = resolveTemporaryTurnMode(mode, trimmed);
  const needsStructure = shouldInjectChatStructureHint(mode, trimmed);
  const isShortFactual = SHORT_FACTUAL_PATTERN.test(trimmed);
  const isHowTo = HOW_TO_PATTERN.test(trimmed);
  const isCodeQuestion = CODE_QUESTION_PATTERN.test(trimmed);
  const isExplanation = EXPLAIN_PATTERN.test(trimmed);
  const isVagueBroad = VAGUE_BROAD_PATTERN.test(trimmed);
  const isContextualFollowup = hasPriorAssistantTurn && CONTEXTUAL_FOLLOWUP_PATTERN.test(trimmed);
  const isInstructionConstrained = isInstructionConstrainedEarly;

  const lines = [
    'Turn quality contract for this answer:',
    '- Lead with the direct answer in the first sentence.',
    '- Never pad with filler phrases like "Great question!", "Sure!", "Absolutely!", "That\'s a great point." — just answer.',
    '- Match response length to question complexity: simple question = short answer; complex question = structured answer.',
  ];

  if (isInstructionConstrained) {
    lines.push(
      '- STRICT CONSTRAINT: the user demanded a minimal literal answer (e.g. "only reply with the name", "one-word answer", "no preamble").',
    );
    lines.push(
      '- Output ONLY the requested value — no greeting, no restatement of the question, no source trail, no follow-up questions. If you do not know the precise value, say exactly: "I do not know." Nothing else.',
    );
  }

  if (isCorrectiveTurn) {
    lines.push('- The user is correcting or refining the previous answer. Absorb the new constraint immediately and do not repeat the old overview.');
  }

  if (isContextualFollowup) {
    lines.push('- This is a follow-up referencing prior context. Stay coherent with what was discussed — do not restart from scratch or re-explain what was already covered.');
  }

  if (isShortFactual && !debugLike && !isHowTo) {
    lines.push('- This is a short factual question. Answer in 1–3 sentences. Do not over-explain or add unsolicited context. If the answer is one word or number, give that first.');
  }

  if (isHowTo) {
    lines.push('- This is a practical how-to question. Give a concrete, actionable answer: working code, exact commands, or numbered steps the user can follow right now. Skip theory unless it directly affects the steps.');
  }

  if (isCodeQuestion && !isHowTo) {
    lines.push('- This involves code. Lead with a working example or snippet, then explain briefly. Do not describe code in prose when you can show it. Keep the example minimal and runnable.');
  }

  if (isExplanation && !isShortFactual) {
    lines.push('- This is a conceptual/explanation question. Start with a one-sentence summary, then go deeper. Use concrete examples or analogies — not abstract descriptions. Layer the explanation: essential point first, nuance second, edge cases only if relevant.');
  }

  if (isVagueBroad) {
    lines.push('- This is a broad/vague prompt. Pick the most useful interpretation and answer concretely. State your interpretation in one phrase ("Assuming you mean X..."), then give a focused answer. Do not dump everything you know about the topic.');
  }

  if (needsRecommendation) {
    lines.push('- State the recommendation in the first sentence, then give the tradeoffs and the assumption that matters most.');
  }

  if (freshnessSensitive) {
    lines.push('- Freshness matters. If you are not grounded in current evidence, say that briefly and point to the latest official source to verify.');
  }

  if (debugLike || temporaryMode === 'plan') {
    lines.push('- Prefer a concrete ordered diagnosis or checklist: likely cause, first checks, how to confirm, then next action.');
  }

  if (needsStructure) {
    lines.push('- Keep it scannable with short headings or short bullets instead of one wall of prose.');
  }

  // Precision reminder for all quality-hinted turns
  lines.push('- Every sentence must earn its place. Cut anything the user did not ask for and would not miss.');

  return lines.length > 4 ? lines.join('\n') : null;
}
