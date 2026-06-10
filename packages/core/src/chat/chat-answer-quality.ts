import type { ConversationGrounding } from './conversation-grounding.js';

export type ChatAnswerQualityVerdict = 'pass' | 'warn' | 'fail';

export interface ChatAnswerQualityInput {
  readonly prompt: string;
  readonly response: string;
  readonly grounding?: ConversationGrounding | null;
  readonly strategy?: string;
  /**
   * Operator/eval-supplied off-topic markers (augments {@link DEFAULT_DRIFT_MARKERS}).
   * Configurable so observed retrieval-leak smells become *data*, not frozen code.
   */
  readonly driftMarkers?: readonly RegExp[];
}

export interface ChatAnswerQualityRequirement {
  readonly kind: 'topic' | 'instruction' | 'actionability' | 'guidance' | 'honesty' | 'tone' | 'constraint' | 'scope' | 'drift';
  readonly label: string;
  readonly expected: string;
  readonly matched: boolean;
}

export interface ChatAnswerQualityReport {
  readonly verdict: ChatAnswerQualityVerdict;
  readonly score: number;
  readonly matched: readonly ChatAnswerQualityRequirement[];
  readonly missing: readonly ChatAnswerQualityRequirement[];
  readonly requirements: readonly ChatAnswerQualityRequirement[];
}

/**
 * Structural off-topic-retrieval scaffolding smells (shared shape with
 * `response-verification.ts`). These are *content-leak* idioms, not domain
 * tokens — so this is not a frozen Template-Matcher of past failures (§8). The
 * primary drift signal is structural grounding-anchor coverage (below);
 * `driftMarkers` is operator-extendable so observed leaks become data.
 */
export const DEFAULT_DRIFT_MARKERS: readonly RegExp[] = [
  /\b(?:femslash|slash fiction|learn how and when to remove this message)\b/i,
  /\b(?:lorem ipsum|placeholder text)\b/i,
];

const GENERIC_CAPABILITY_FALLBACK_PATTERN = /\bi\s+don['’]?t\s+have\s+a\s+confident\s+answer\s+for\s+that\s+yet\b|\bwhat\s+i\s+can\s+do\s*:/i;

/** Substantive grounded answers must engage at least this many distinct grounding anchors. */
const MIN_GROUNDING_ANCHORS = 2;
/** Below this word count an answer is too short to be judged for anchor coverage. */
const DRIFT_MIN_WORDS = 12;
const MAX_UNREQUESTED_ANSWER_WORDS = 650;

const PROMPT_FOCUS_STOP_WORDS = new Set([
  'about', 'actually', 'all', 'also', 'and', 'any', 'are', 'best', 'can', 'called', 'check',
  'could', 'current', 'does', 'feel', 'figure', 'first', 'for', 'from', 'good', 'got', 'handle',
  'give', 'have', 'help', 'honest', 'honestly', 'hours', 'how', 'into', 'just', 'keep',
  'like', 'make', 'making', 'modern', 'more', 'most', 'much', 'need', 'now',
  'inspect', 'list', 'name', 'one', 'out', 'play', 'please', 'quick', 'question', 'really', 'right', 'sanity',
  'should', 'something', 'start', 'stuck', 'such', 'talking', 'than', 'that',
  'tell', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'think', 'this',
  'through', 'understand', 'understood', 'until', 'want', 'way', 'were', 'what',
  'unsure', 'when', 'where', 'which', 'while', 'who', 'why', 'will', 'wish', 'with',
  'would', 'write', 'your',
]);

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function normalizeFocusToken(token: string): string {
  if (token.length > 6 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 7 && token.endsWith('ing')) {
    const base = token.slice(0, -3);
    return /(.)\1$/.test(base) ? base.slice(0, -1) : base;
  }
  if (token.length > 6 && token.endsWith('ed')) {
    const base = token.slice(0, -2);
    return /(.)\1$/.test(base) ? base.slice(0, -1) : base;
  }
  if (token.length > 5 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function focusTokens(value: string): string[] {
  return [...new Set(
    value
      .toLowerCase()
      .replace(/[â€™']/g, '')
      .replace(/-/g, ' ')
      .split(/[^a-z0-9+#.-]+/i)
      .map((token) => token.replace(/^[.+-]+|[.+-]+$/g, ''))
      .map(normalizeFocusToken)
      .filter((token) =>
        token.length >= 3
        && !PROMPT_FOCUS_STOP_WORDS.has(token)
        && !/^\d{4}$/.test(token)),
  )];
}

function stripEchoedPromptLead(prompt: string, response: string, promptTokens: readonly string[]): string {
  const [lead, ...rest] = response.split(/(?<=[.!?])\s+/);
  if (!lead || rest.length === 0 || promptTokens.length < 3) return response;
  if (/\b(?:can(?:not|'t)|unable to|do not|don't)\b[\s\S]{0,80}\b(?:verify|confirm|guarantee|provide)\b/i.test(lead)) {
    return response;
  }
  const leadTokens = new Set(focusTokens(lead));
  const overlap = promptTokens.filter((token) => leadTokens.has(token)).length;
  return overlap >= Math.max(3, Math.ceil(promptTokens.length * 0.7))
    ? rest.join(' ')
    : response;
}

function hasStandaloneTopicRetention(prompt: string, response: string): boolean | null {
  const promptTokens = focusTokens(prompt);
  if (promptTokens.length < 2) return null;

  const evaluatedResponse = stripEchoedPromptLead(prompt, response, promptTokens);
  const responseTokens = new Set(focusTokens(evaluatedResponse));
  const openingTokens = new Set(focusTokens(evaluatedResponse.split(/\s+/).slice(0, 80).join(' ')));
  const totalHits = promptTokens.filter((token) => responseTokens.has(token)).length;
  const openingHits = promptTokens.filter((token) => openingTokens.has(token)).length;
  const minimumHits = requiresActionableAnswer(prompt) || needsGuidance(prompt)
    ? 1
    : Math.min(2, promptTokens.length);
  return openingHits >= 1 && totalHits >= minimumHits;
}

function hasCoreRequestFocus(prompt: string, response: string): boolean | null {
  if (wordCount(response) <= 3) return null;
  const targets = focusTokens(prompt).slice(0, 2);
  if (targets.length < 2) return null;
  const responseTokens = new Set(focusTokens(response));
  return targets.some((token) => responseTokens.has(token));
}

function requestsComparison(prompt: string): boolean {
  return /\b(?:compare|comparison|versus|vs\.?|difference between|trade-?offs?)\b/i.test(prompt);
}

function hasComparisonShape(response: string): boolean {
  return /\b(?:whereas|while|however|but|unlike|trade-?off|compared with|compared to|on the other hand|pick|choose|better for|smaller|larger|faster|slower|bundles|ships with|uses)\b/i.test(response);
}

function requestsDetailedAnswer(prompt: string): boolean {
  return /\b(?:deep|detailed|thorough|comprehensive|long[-\s]?form|in depth|step by step)\b/i.test(prompt);
}

function needsProblemDiagnosis(prompt: string): boolean {
  return /\bwhy\s+(?:is|are|does|do)\b[\s\S]{0,120}\b(?:pain|problem|issue|broken|failing|dependency|dependencies)\b/i.test(prompt);
}

function hasProblemDiagnosis(response: string): boolean {
  return /\b(?:because|usually|likely|common cause|check|inspect|conflict|mismatch|peer dependenc|lockfile|hoist|resolution|link|version skew)\b/i.test(response);
}

function requestsAuditScalingAdvice(prompt: string): boolean {
  return /\b(?:audit|evaluation|benchmark|test system)\b/i.test(prompt)
    && /\b(?:ideas?|scale|scalable|scaling|improve|strategy)\b/i.test(prompt);
}

function staysFocusedOnAuditAdvice(response: string): boolean {
  return !/\b(?:the stack choice is the first real decision|before i scaffold|build me a react|frontend:\s*react|full-stack:\s*next\.?js)\b/i.test(response);
}

function requestsPromptHumanizer(prompt: string): boolean {
  return /\bhumaniz(?:e|er|ing)\b/i.test(prompt) && /\b(?:test|prompt)\b/i.test(prompt);
}

function hasHumanizerFidelity(response: string): boolean {
  const signals = [
    /\b(?:typo|misspelling)\b/i,
    /\babbreviat/i,
    /\bparaphras/i,
    /\b(?:protect|preserve|placeholder|token)\b/i,
    /\b(?:meaning|semantic|intent)\b/i,
    /\b(?:seed|deterministic|reproduc)\b/i,
    /\b(?:mutation|transform)\b/i,
    /\bregister\b/i,
  ];
  return signals.filter((pattern) => pattern.test(response)).length >= 2;
}

function requestsSmartFriendConversation(prompt: string): boolean {
  return /\bsmart friend\b/i.test(prompt)
    || (
      /\b(?:conversation|chat|talking)\b/i.test(prompt)
      && /\b(?:natural|personal|human|friend)\b/i.test(prompt)
    );
}

function requestsExhaustiveCoverage(prompt: string): boolean {
  return /\b(?:all|every|complete|full|exhaustive)\b/i.test(prompt)
    && /\b(?:list|items?|options?|champions?|roles?|entries|examples?)\b/i.test(prompt);
}

function claimsOnlyPartialCoverage(response: string): boolean {
  return /\b(?:some|a few|common|selected|selection of|examples? include|not exhaustive|partial list|among others)\b/i.test(response);
}

function honestlyDeclinesUnverifiedExhaustiveCoverage(response: string): boolean {
  return /\b(?:can(?:not|'t)|unable to|do not|don't)\b[\s\S]{0,100}\b(?:verify|confirm|guarantee|provide)\b[\s\S]{0,80}\b(?:complete|exhaustive|all|full)\b/i.test(response)
    && /\b(?:current|authoritative|official|source|dataset|roster|patch|version|evidence)\b/i.test(response);
}

function hasSmartFriendQualities(response: string): boolean {
  const signals = [
    /\btone\b/i,
    /\bnatural/i,
    /\bconcise/i,
    /\bcontext\b/i,
    /\bmemor(?:y|ies|ize)\b/i,
    /\bpersonal/i,
    /\bregister\b/i,
    /\bpreference/i,
    /\bchallenge\b/i,
  ];
  return signals.filter((pattern) => pattern.test(response)).length >= 2;
}

function topicTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/i)
    .filter((token) => token.length >= 3);
}

function includesLoose(haystack: string, needle: string): boolean {
  return haystack.includes(needle.toLowerCase());
}

function hasTopicRetention(response: string, grounding: ConversationGrounding): boolean {
  const normalizedResponse = normalize(response);
  const directKeywords = [grounding.topic, ...grounding.keywords]
    .map((value) => value.trim())
    .filter((value) => value.length >= 3);
  if (directKeywords.some((keyword) => includesLoose(normalizedResponse, keyword))) {
    return true;
  }

  const matches = topicTokens(grounding.topic)
    .filter((token) => normalizedResponse.includes(token))
    .length;
  return matches >= 2;
}

function requiresActionableAnswer(prompt: string): boolean {
  return /\b(?:what should (?:i|we|you) (?:do|try|change|fix|build|implement|check|run)|what would (?:you|vai) (?:do|change|fix|build|implement|check|run)|(?:best|highest[-\s]?leverage)\s+(?:next\s+)?(?:thing|step|move|task|action)|next\s+(?:thing|step|move|task|action)|first\s+(?:thing|step|move|task|action)|how (?:do|can|should|would) (?:i|we|you) (?:fix|debug|diagnos(?:e|is)|audit|improve|upgrade|harden|implement|build|test|verify|make)|implement|fix|patch|debug|diagnos(?:e|is)|harden|make changes?|take action|action based|engineering task|improve (?:vai|chat|responses?|routing|relevance|accuracy)|upgrade (?:vai|chat|responses?|routing|relevance|accuracy))\b/i.test(prompt);
}

function hasActionableStep(response: string): boolean {
  return /```|\b(?:implement|add|extract|build|use|configure|gate|test|route|classif(?:y|ier)|regression|patch|bind|track|validate|inspect|audit|review|run|check|measure|profile|debug|diagnos(?:e|is)|verify|wire|connect|replace|remove|split|log|instrument|compare|prioriti[sz]e|start|open|change|upgrade|improve|harden|ship|fix)\b/i.test(response);
}

function needsGuidance(prompt: string): boolean {
  return /\b(?:unsure|uncertain|not\s+sure|help\s+(?:me\s+)?(?:figure|decide|debug|fix|understand)|where\s+(?:should\s+)?(?:i|we)\s+(?:start|look|inspect)|what\s+(?:should|would|can)\s+(?:i|we|you)\s+(?:do|try|check|inspect|run)|first\s+(?:three|3|two|2)?\s*(?:checks?|steps?|moves?)|guide\s+me|walk\s+me\s+through)\b/i.test(prompt);
}

function hasGuidingShape(response: string): boolean {
  return /(?:^|\n)\s*(?:\d+\.|[-*])\s+/m.test(response)
    || /\b(?:start\s+with|first,?|first\s+(?:step|check|move)|next,?|next\s+(?:step|check|move)|check|inspect|verify|run|if\s+.+\bthen\b|because|the\s+reason)\b/i.test(response);
}

const DIAGNOSTIC_GUIDANCE_PATTERN =
  /\b(?:debug(?:ging)?|diagnos(?:e|is)|troubleshoot|blank\s+(?:page|screen)|crash(?:ing)?|fails?|failing|broken|error|stack trace|logs?)\b/i;

const EXPLICIT_IMPLEMENTATION_REQUEST_PATTERN =
  /\b(?:implement|apply|edit|rewrite|replace|patch|fix\s+(?:this|the|my)|write|show|provide|give|generate)\b.{0,60}\b(?:code|patch|diff|files?|component|config|implementation)\b|\b(?:build|create|scaffold|generate)\b.{0,60}\b(?:app|site|website|page|component|project|starter)\b|```/i;

function requestsDiagnosisBeforeImplementation(prompt: string): boolean {
  return DIAGNOSTIC_GUIDANCE_PATTERN.test(prompt)
    && needsGuidance(prompt)
    && !EXPLICIT_IMPLEMENTATION_REQUEST_PATTERN.test(prompt);
}

function preservesDiagnosticScope(prompt: string, response: string): boolean {
  const titledFileBlocks = (response.match(/```[a-z0-9+#-]*\s+title=["'][^"']+["']/gi) ?? []).length;
  const fencedBlocks = (response.match(/```/g) ?? []).length / 2;
  const replacementProjectShape =
    /\bpackage\.json\b/i.test(response)
    && /\b(?:webpack\.config|vite\.config|next\.config|src\/index|index\.html)\b/i.test(response);
  const promptNamesToolchain =
    /\b(?:npm|yarn|pnpm|bun|vite|webpack|create-react-app|cra|next(?:\.js)?)\b/i.test(prompt);
  const assumesUnprovidedToolchain =
    !promptNamesToolchain
    && /\b(?:npm|npx|yarn|pnpm|bun)\s+\S+/i.test(response);
  return titledFileBlocks === 0
    && fencedBlocks === 0
    && !replacementProjectShape
    && !assumesUnprovidedToolchain;
}

function needsHonestySignal(prompt: string): boolean {
  return /\b(?:honest|real|accurate|accuracy|mostly\s+accurate|unsure|uncertain|not\s+sure|uncapable|incapable|can't|cannot|unable|verify|evidence|current|fresh|latest|live|audit|debug)\b/i.test(prompt);
}

function hasHonestySignal(response: string): boolean {
  return /\b(?:i\s+(?:don['’]?t|do\s+not|can['’]?t|cannot)|not\s+sure|uncertain|likely|probably|based\s+on|from\s+what|evidence|verified|verify|test|check|confidence|if\s+.+\bthen\b|the\s+tradeoff|unknown|missing|cannot\s+confirm|do\s+not\s+have)\b/i.test(response)
    || hasActionableStep(response);
}

function hasNonHostileTone(response: string): boolean {
  return !/\b(?:stupid|idiot|dumb|moron|pathetic|worthless|obviously\s+you|how\s+could\s+you\s+not)\b/i.test(response);
}

function hasRequestedOutcomeCoverage(response: string, requestedOutcome: string, grounding: ConversationGrounding | null): boolean {
  const normalizedResponse = normalize(response);
  const tokens = topicTokens(requestedOutcome);
  if (tokens.length === 0) return true;
  const matchedTokens = tokens.filter((token) => normalizedResponse.includes(token)).length;
  if (matchedTokens >= Math.min(2, tokens.length)) return true;
  if (grounding === null) return false;
  return matchedTokens >= 1 && hasTopicRetention(response, grounding) && hasActionableStep(response);
}

function matchesConstraint(response: string, constraint: string): boolean {
  switch (constraint) {
    case 'Vai remains the primary answerer':
      return /\bVai\b/i.test(response) && /\b(?:primary|main)\b/i.test(response) && /\b(?:critic|verification|external LLM)\b/i.test(response);
    case 'local-first':
      return /\blocal-first\b|\boffline\b/i.test(response);
    case 'preserve current user context':
      return /\b(?:current user context|recent chat state|active topic|context brief|conversation)\b/i.test(response);
    default:
      return false;
  }
}

function buildRequirements(input: ChatAnswerQualityInput): ChatAnswerQualityRequirement[] {
  const requirements: ChatAnswerQualityRequirement[] = [];
  const prompt = normalize(input.prompt);
  const response = input.response;
  const grounding = input.grounding ?? null;

  let hasExplicitTopicRequirement = false;
  if (grounding) {
    hasExplicitTopicRequirement = true;
    requirements.push({
      kind: 'topic',
      label: 'topic retention',
      expected: grounding.topic,
      matched: hasTopicRetention(response, grounding),
    });
  } else if (/\b(?:vai|chat)\b/.test(prompt) && /\b(?:relevance|accurate|accuracy|responsive|context|responses?)\b/.test(prompt)) {
    hasExplicitTopicRequirement = true;
    requirements.push({
      kind: 'topic',
      label: 'topic retention',
      expected: 'Vai chat response quality',
      matched: /\b(?:Vai|chat|context|relevance|accurate|responsive)\b/i.test(response),
    });
  }

  if (!hasExplicitTopicRequirement) {
    const standaloneRetention = hasStandaloneTopicRetention(input.prompt, response);
    if (standaloneRetention !== null) {
      requirements.push({
        kind: 'topic',
        label: 'standalone topic retention',
        expected: 'engage multiple distinctive terms from the current question near the start of the answer',
        matched: standaloneRetention,
      });
    }

    const coreRequestFocus = requiresActionableAnswer(prompt) || needsGuidance(prompt)
      ? null
      : hasCoreRequestFocus(input.prompt, response);
    if (coreRequestFocus !== null) {
      requirements.push({
        kind: 'topic',
        label: 'core request focus',
        expected: 'answer the main subject being requested, not merely a neighboring brand or domain',
        matched: coreRequestFocus,
      });
    }
  }

  if (grounding?.requestedOutcome) {
    requirements.push({
      kind: 'instruction',
      label: 'requested outcome',
      expected: grounding.requestedOutcome,
      matched: hasRequestedOutcomeCoverage(response, grounding.requestedOutcome, grounding),
    });
  }

  if (requiresActionableAnswer(prompt)) {
    requirements.push({
      kind: 'actionability',
      label: 'actionable next move',
      expected: 'a concrete action, check, or implementation step',
      matched: hasActionableStep(response),
    });
  }

  if (needsGuidance(prompt)) {
    requirements.push({
      kind: 'guidance',
      label: 'guiding shape',
      expected: 'clear checks, steps, or a reasoned next move when the user is unsure',
      matched: hasGuidingShape(response),
    });
  }

  if (needsProblemDiagnosis(input.prompt)) {
    requirements.push({
      kind: 'guidance',
      label: 'problem diagnosis',
      expected: 'name likely causes and a concrete check instead of defining the surrounding technology',
      matched: hasProblemDiagnosis(response),
    });
  }

  if (requestsComparison(input.prompt)) {
    requirements.push({
      kind: 'drift',
      label: 'real comparison',
      expected: 'state at least one meaningful difference or tradeoff between the compared options',
      matched: hasComparisonShape(response),
    });
  }

  if (requestsAuditScalingAdvice(input.prompt)) {
    requirements.push({
      kind: 'scope',
      label: 'audit advice scope',
      expected: 'recommend audit scaling mechanisms instead of redirecting into a generic app scaffold',
      matched: staysFocusedOnAuditAdvice(response),
    });
  }

  if (requestsPromptHumanizer(input.prompt)) {
    requirements.push({
      kind: 'topic',
      label: 'humanizer fidelity',
      expected: 'preserve meaning or protected tokens while applying controlled, reproducible language mutations',
      matched: hasHumanizerFidelity(response),
    });
  }

  if (requestsSmartFriendConversation(input.prompt)) {
    requirements.push({
      kind: 'topic',
      label: 'smart-friend qualities',
      expected: 'name at least two of tone, concise delivery, context, memory, personal preferences, register, or constructive challenge',
      matched: hasSmartFriendQualities(response),
    });
  }

  if (requestsExhaustiveCoverage(input.prompt)) {
    requirements.push({
      kind: 'scope',
      label: 'exhaustive coverage',
      expected: 'provide the requested complete set, or clearly explain why a verified complete set is unavailable',
      matched: !claimsOnlyPartialCoverage(response) || honestlyDeclinesUnverifiedExhaustiveCoverage(response),
    });
  }

  if (requestsDiagnosisBeforeImplementation(input.prompt)) {
    requirements.push({
      kind: 'scope',
      label: 'diagnose before replacement',
      expected: 'inspect the existing app and gather evidence before assuming its package manager, commands, files, or replacement scaffold',
      matched: preservesDiagnosticScope(input.prompt, response),
    });
  }

  if (needsHonestySignal(prompt)) {
    requirements.push({
      kind: 'honesty',
      label: 'honest calibration',
      expected: 'uncertainty, evidence, verification, or concrete check instead of unsupported confidence',
      matched: hasHonestySignal(response),
    });
  }

  if (/\b(?:more simply|simpler|plain english|eli5|explain that)\b/.test(prompt)) {
    requirements.push({
      kind: 'instruction',
      label: 'simplification',
      expected: 'a simpler restatement',
      matched: /\b(?:simpler|plain version|plain english|hooks are how|the important context is)\b/i.test(response),
    });
  }

  for (const constraint of grounding?.constraints ?? []) {
    requirements.push({
      kind: 'constraint',
      label: 'constraint preserved',
      expected: constraint,
      matched: matchesConstraint(response, constraint),
    });
  }

  const driftMarkers = [...DEFAULT_DRIFT_MARKERS, ...(input.driftMarkers ?? [])];
  const hasLeakMarker = driftMarkers.some((re) => re.test(response));
  const genericFallback = GENERIC_CAPABILITY_FALLBACK_PATTERN.test(response);
  const excessiveUnrequestedLength =
    wordCount(response) > MAX_UNREQUESTED_ANSWER_WORDS
    && !requestsDetailedAnswer(input.prompt);
  // Structural drift: a substantive *grounded* answer that engages too few of
  // the conversation's grounding anchors is drifting off-task — even if it
  // happens to mention the topic word once. Generalizes beyond any token list.
  const anchorStarved =
    grounding !== null &&
    wordCount(response) >= DRIFT_MIN_WORDS &&
    countGroundingAnchorsHit(response, grounding) < MIN_GROUNDING_ANCHORS;
  requirements.push({
    kind: 'drift',
    label: 'on-topic grounding coverage',
    expected: `engages ≥${MIN_GROUNDING_ANCHORS} grounding anchors; no unrelated snippet leakage`,
    matched: !hasLeakMarker && !anchorStarved && !genericFallback && !excessiveUnrequestedLength,
  });
  requirements.push({
    kind: 'tone',
    label: 'non-hostile tone',
    expected: 'friendly enough for collaboration; no insults or contempt',
    matched: hasNonHostileTone(response),
  });

  return requirements;
}

/** Count distinct grounding anchors (topic tokens, keywords, constraints, requested outcome) the response engages. */
function countGroundingAnchorsHit(response: string, grounding: ConversationGrounding): number {
  const normalizedResponse = normalize(response);
  const anchors = new Set<string>();
  for (const phrase of [grounding.topic, grounding.requestedOutcome ?? '', ...grounding.keywords, ...(grounding.constraints ?? [])]) {
    for (const token of topicTokens(phrase)) {
      if (!TOPIC_NOISE.has(token)) anchors.add(token);
    }
  }
  let hits = 0;
  for (const anchor of anchors) {
    if (normalizedResponse.includes(anchor)) hits += 1;
  }
  return hits;
}

/** Generic glue tokens that should not count as distinctive grounding anchors. */
const TOPIC_NOISE = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'next', 'task', 'best', 'choose', 'thing', 'should', 'about', 'into', 'from', 'your',
]);

export function evaluateChatAnswerQuality(input: ChatAnswerQualityInput): ChatAnswerQualityReport {
  const requirements = buildRequirements(input);
  const matched = requirements.filter((requirement) => requirement.matched);
  const missing = requirements.filter((requirement) => !requirement.matched);
  const score = requirements.length === 0 ? 1 : matched.length / requirements.length;
  const criticalFailure = missing.some((requirement) =>
    requirement.kind === 'topic'
    || requirement.kind === 'drift'
    || requirement.kind === 'actionability'
    || requirement.kind === 'guidance'
    || requirement.kind === 'scope'
    || requirement.kind === 'tone'
  );
  const verdict: ChatAnswerQualityVerdict = criticalFailure
    ? 'fail'
    : missing.length <= 1
      ? 'pass'
      : score >= 0.66
        ? 'warn'
        : 'fail';

  return {
    verdict,
    score,
    matched,
    missing,
    requirements,
  };
}
