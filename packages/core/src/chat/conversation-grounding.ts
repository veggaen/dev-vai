import type { Message } from '../models/adapter.js';

export type ContextGroundedFollowUpIntent =
  | 'best-next'
  | 'quality-hardening'
  | 'simple-explain'
  | 'continue';

export interface ConversationGroundingDependencies {
  readonly inferRecentFollowUpTopic: (history: readonly Message[]) => string | null;
  readonly isStableFollowUpTopic: (topic: string) => boolean;
  readonly condenseStableFollowUpTopic: (text: string) => string;
  readonly detectTopic: (text: string) => string;
  readonly topicStopWords: ReadonlySet<string>;
}

export interface ConversationGrounding {
  readonly topic: string;
  readonly previousUser: string;
  readonly previousAssistant: string;
  readonly contextText: string;
  readonly keywords: readonly string[];
  readonly requestedOutcome: string | null;
  readonly constraints: readonly string[];
}

function topicTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/i)
    .filter((token) => token.length > 0);
}

function extractGroundedConversationTopic(
  contextText: string,
  previousUser: string,
  previousAssistant: string,
  input: string,
  deps: ConversationGroundingDependencies,
): string {
  const combined = `${previousUser}\n${previousAssistant}\n${contextText}\n${input}`;

  if (/\b(?:vai|veggaai)\b/i.test(combined) && /\b(?:chat|responses?|context|relevance|accurate|responsive)\b/i.test(combined)) {
    return 'Vai chat context relevance';
  }
  if (/\bchat\s+(?:app|product|service|window|surface)\b/i.test(combined) && /\b(?:context|responses?|messages?|relevance|accuracy)\b/i.test(combined)) {
    return 'chat app response relevance';
  }
  if (/\bnext\.?js\b/i.test(combined) && /\bprisma\b/i.test(combined) && /\btodo\b/i.test(combined)) {
    return 'Next.js Prisma todo app';
  }
  if (/\breact\b/i.test(combined) && /\bhooks?\b/i.test(combined)) {
    return 'React hooks';
  }
  if (/\bnext\.?js\b/i.test(combined) && /\bapp router\b/i.test(combined)) {
    return 'Next.js App Router';
  }
  if (/\breact\b/i.test(combined) && /\btypescript\b/i.test(combined)) {
    return 'React TypeScript app';
  }
  if (/\bexpress\b/i.test(combined) && /\bapi\b/i.test(combined)) {
    return 'Express API';
  }

  const recentTopic = deps.inferRecentFollowUpTopic([
    { role: 'assistant', content: previousAssistant },
    { role: 'user', content: previousUser },
    { role: 'user', content: input },
  ]);
  if (recentTopic && deps.isStableFollowUpTopic(recentTopic)) return recentTopic;

  const previousNormalized = deps.condenseStableFollowUpTopic(previousUser);
  if (deps.isStableFollowUpTopic(previousNormalized)) return previousNormalized;

  const detected = deps.detectTopic(previousUser || contextText);
  if (deps.isStableFollowUpTopic(detected)) return detected;

  return '';
}

function extractGroundingKeywords(
  text: string,
  topic: string,
  topicStopWords: ReadonlySet<string>,
): readonly string[] {
  const keywordPatterns: Array<[string, RegExp]> = [
    ['Vai', /\b(?:vai|veggaai)\b/i],
    ['chat app', /\bchat\s+(?:app|product|service|window|surface)\b/i],
    ['user context', /\b(?:user\s+context|selected\s+files?|last\s+\d+\s+messages?|conversation\s+history|context\s+bundle)\b/i],
    ['response relevance', /\b(?:relevance|relevant|accuracy|accurate|responsive|off-topic|weird|grounded)\b/i],
    ['teacher loop', /\bteacher\s+loop|quality\s+gate|validator/i],
    ['Next.js', /\bnext\.?js\b/i],
    ['Prisma', /\bprisma\b/i],
    ['SQLite', /\bsqlite\b/i],
    ['todo app', /\btodo\s+app\b|\btodos?\b/i],
    ['React hooks', /\breact\b[\s\S]{0,80}\bhooks?\b|\bhooks?\b[\s\S]{0,80}\breact\b/i],
    ['tests', /\b(?:tests?|testable|vitest|unit\s+test|integration\s+test)\b/i],
  ];

  const keywords: string[] = [];
  for (const [label, pattern] of keywordPatterns) {
    if (pattern.test(text) && !keywords.includes(label)) keywords.push(label);
  }

  const tokenCandidates = topicTokens(topic)
    .filter((token) => token.length >= 3)
    .filter((token) => !topicStopWords.has(token))
    .slice(0, 6);
  for (const token of tokenCandidates) {
    const label = token.length <= 3 ? token.toUpperCase() : token.replace(/^\w/, (char) => char.toUpperCase());
    if (!keywords.some((existing) => existing.toLowerCase() === label.toLowerCase())) keywords.push(label);
  }

  return keywords.slice(0, 8);
}

function extractConversationConstraints(text: string): readonly string[] {
  const constraints: string[] = [];

  if (
    /\b(?:not|without|do\s+not|should\s+not|don't)\b[\s\S]{0,80}\b(?:external\s+(?:llms?|ais?)|other\s+(?:llms?|ais?)|llm\s+calls?)\b/i.test(text)
    || /\bexternal\s+(?:llms?|ais?)\b[\s\S]{0,120}\b(?:optional\s+critics?|not\s+(?:the\s+)?main|not\s+mainly|verification\s+tool)\b/i.test(text)
  ) {
    constraints.push('Vai remains the primary answerer');
  }
  if (/\blocal-first\b|\boffline\b/i.test(text)) {
    constraints.push('local-first');
  }
  if (/\b(?:selected\s+files?|conversation\s+history|last\s+\d+\s+messages?|current\s+user\s+context|context\s+bundle)\b/i.test(text)) {
    constraints.push('preserve current user context');
  }

  return constraints.slice(0, 5);
}

function extractRequestedOutcome(input: string, contextText: string, topic: string): string | null {
  const combined = `${topic}\n${contextText}\n${input}`.toLowerCase();

  if (/\b(?:vai|chat)\b/.test(combined) && /\b(?:response|responses|reply|relevance|accuracy|responsive)\b/.test(combined)) {
    if (/\b(?:best|next|highest[-\s]?leverage|optimal)\b/.test(combined)) {
      return 'choose the highest-leverage next engineering task for Vai chat relevance';
    }
    if (/\b(?:make|improve|better|stronger|harden|robust|testable|relevant|accurate|responsive)\b/.test(combined)) {
      return 'improve Vai chat relevance against the current conversation';
    }
  }

  if (/\bnext\.?js\b/.test(combined) && /\bprisma\b/.test(combined) && /\btodo\b/.test(combined)) {
    return 'make the Next.js Prisma todo app more robust and testable';
  }
  if (/\b(?:explain|simpler|plain english|eli5)\b/.test(input.toLowerCase())) {
    return 'simplify the previous explanation';
  }
  if (/\b(?:continue|go\s+deeper|deeper|expand|more\s+detail|take\s+it\s+further)\b/.test(input.toLowerCase())) {
    return 'expand the previous recommendation';
  }

  return null;
}

export function shouldDeferContextGroundedFollowUp(input: string, history: readonly Message[]): boolean {
  const lower = input.toLowerCase().replace(/[.!?]+$/g, '').trim();

  if (/\b(?:my|the)\s+(?:real|actual)\s+question\b|\banswer\s+the\s+(?:first|second|third|last)\s+(?:part|question)\b/i.test(lower)) {
    return true;
  }
  if (/\b(?:trade-?offs?|pros?\s+and\s+cons?|biggest\s+upside|biggest\s+limit|best\s+fit|headings?\s*:)\b/i.test(lower)) {
    return true;
  }
  if (/\b(?:deploy|deployment|hosting|host\s+it|vercel|netlify|serverless)\b/i.test(lower)) {
    return true;
  }
  if (/\b(?:build|make|create)\s+(?:it|this|that|the\s+first\s+version)(?:\s+for\s+me)?\s+now\b/i.test(lower)
    || /\bcan\s+you\s+make\s+it\s+(?:for\s+me\s+)?now\b/i.test(lower)) {
    return true;
  }

  // Iter-28: defer when the input looks like a canonical knowledge question
  // ("what does X do", "what is X", "explain X", "how do i X") — those should
  // route to curated fact/snippet strategies, not generic grounded continuation
  // scaffolding. Without this, follow-up turns leak meta-text like
  // "**Grounded continuation**\nContinuing from..." instead of an actual answer.
  if (/^(?:so\s+|and\s+|but\s+|then\s+)?(?:what(?:'s|\s+is|\s+are|\s+does|\s+do)|how\s+(?:do\s+i|to|does)|why\s+(?:does|is|do|are)|when\s+(?:does|do)|explain|review\s+this)\b/i.test(lower)) {
    return true;
  }
  if (/^(?:explain|what does this|what's this|whats this)\b/i.test(lower)) {
    return true;
  }

  const recentAssistant = [...history].reverse().find((message) => message.role === 'assistant' && message.content.trim().length > 0);
  const priorHasCode = Boolean(recentAssistant && /```[\s\S]+```/.test(recentAssistant.content));
  if (
    priorHasCode
    && (/\bsame\s+(?:design|layout|style|look|ui|thing|app|project|page|site)?\s*but\b/i.test(lower)
      || /\b(?:different|new|another)\s+(?:theme|color.?scheme|palette|subject|topic|style|look|vibe)\b/i.test(lower))
  ) {
    return true;
  }

  return false;
}

export function buildConversationGrounding(
  input: string,
  history: readonly Message[],
  deps: ConversationGroundingDependencies,
): ConversationGrounding | null {
  const userMessages = history
    .filter((message) => message.role === 'user' && message.content.trim().length > 0)
    .map((message) => message.content.trim());
  const priorUsers = userMessages.slice(0, -1).filter((content) => content.length > 8);
  const previousUser = priorUsers.length > 0 ? priorUsers[priorUsers.length - 1] : '';

  const assistantMessages = history
    .filter((message) => message.role === 'assistant' && message.content.trim().length > 0)
    .map((message) => message.content.trim());
  const previousAssistant = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1] : '';

  const contextText = [
    ...priorUsers.slice(-3),
    ...assistantMessages.slice(-2),
  ].join('\n').trim();

  if (contextText.length < 25) return null;

  const topic = extractGroundedConversationTopic(contextText, previousUser, previousAssistant, input, deps);
  if (!topic || topic === 'general') return null;

  return {
    topic,
    previousUser,
    previousAssistant,
    contextText,
    keywords: extractGroundingKeywords(`${contextText}\n${input}`, topic, deps.topicStopWords),
    requestedOutcome: extractRequestedOutcome(input, contextText, topic),
    constraints: extractConversationConstraints(`${previousUser}\n${previousAssistant}\n${contextText}\n${input}`),
  };
}

export function classifyContextGroundedFollowUpIntent(
  input: string,
  contextText: string,
): ContextGroundedFollowUpIntent | null {
  const lower = input.toLowerCase().replace(/[.!?]+$/g, '').trim();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  const hasRecentContext = contextText.trim().length > 0;
  if (!hasRecentContext) return null;

  const refersBack = /\b(?:it|this|that|these|those|them|there|above|earlier|previous|same|your\s+(?:answer|response)|the\s+(?:answer|response|context|approach|app|code|thing))\b/i.test(lower);
  const asksSimpleExplain = /\b(?:explain|break\s+(?:it|this|that)\s+down|plain\s+english|eli5|like\s+i'?m\s+(?:new|five|5|a\s+beginner)|more\s+simply|simpler)\b/i.test(lower)
    && (refersBack || wordCount <= 10);
  if (asksSimpleExplain) return 'simple-explain';

  const isChatQualityAsk = /\b(?:vai|chat|response|answer|context|relevance|accuracy|responsive)\b/i.test(lower)
    && /\b(?:best|optimal|next|improve|better|stronger|relevant|accurate|responsive|weird|off)\b/i.test(lower);
  const asksBestNext = /\b(?:best|optimal|highest[-\s]?leverage|right|smartest)\s+(?:next\s+)?(?:thing|step|task|move|slice|fix)\b/i.test(lower)
    || /\bwhat\s+(?:would\s+be\s+)?(?:the\s+)?(?:best|next)\s+(?:thing|step|task|move)\b/i.test(lower)
    || /\bwhere\s+should\s+(?:i|we)\s+(?:start|focus)\b/i.test(lower);
  if (isChatQualityAsk || asksBestNext) return 'best-next';

  const asksHardening = /\b(?:robust|reliable|production[-\s]?ready|testable|tests?|quality|accurate|relevant|responsive|grounded|automated|over[-\s]?engineer|stronger)\b/i.test(lower)
    && /\b(?:make|improve|strengthen|harden|verify|test|add|more|better|fix)\b/i.test(lower);
  if (asksHardening) return 'quality-hardening';

  const asksContinue = /\b(?:continue|go\s+deeper|deeper|expand|more\s+detail|dig\s+in|build\s+on\s+that|take\s+it\s+further|what\s+else)\b/i.test(lower)
    || (refersBack && wordCount <= 16 && /\b(?:how|what|why|which|can|should|would|more|better)\b/i.test(lower));
  if (asksContinue) return 'continue';

  return null;
}