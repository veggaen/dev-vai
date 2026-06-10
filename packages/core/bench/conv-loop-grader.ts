/**
 * Conversational turn grader — tags real failure modes + relevance to the
 * last user message. Used by conv-loop.mts and conv-loop-grade.mts.
 */

export type ConvTurnRecord = {
  bench: string;
  convId: string;
  turnIdx: number;
  roundIdx: number;
  category: string;
  style: string;
  ms: number;
  prompt: string;
  response: string;
  history: Array<{ role: string; content: string }>;
  sources: number;
  strategy: string | null;
  error: string | null;
};

const SCRATCH_TOKENS = [
  'Grounded continuation',
  'Next layer',
  'Practical move',
  'Building on what we just covered',
  'thinking out loud',
  '[scratch]',
  '<scratch>',
  'RELATED:',
];

const FALLBACK_MARKERS = [
  /don'?t have a confident answer/i,
  /isn'?t in my knowledge yet/i,
  /stay on \*\*/i,
  /pivot fully/i,
  /don'?t yet hold/i,
  /help you discover it another way/i,
  /one anchor/i,
];

const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'is', 'it', 'and', 'or', 'but', 'for', 'with', 'on', 'at', 'by', 'from', 'as',
  'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'they', 'we',
  'my', 'your', 'his', 'her', 'their', 'our', 'me', 'him', 'them', 'us', 'if', 'can', 'could', 'would', 'should', 'will',
  'what', 'when', 'where', 'why', 'how', 'who', 'which', 'please', 'tell', 'give', 'show', 'okay', 'ok', 'yes', 'no',
  'also', 'just', 'only', 'about', 'some', 'any', 'all', 'one', 'two', 'like', 'really', 'actually', 'maybe',
]);

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOP.has(t) && t.length > 2);
}

function wordCount(s: string): number {
  return (s.trim().match(/\S+/g) ?? []).length;
}

function sourcedAnswerQualityTags(response: string): string[] {
  const tags: string[] = [];
  const promotionalSignals = [
    /\bstart for free\b/i,
    /\bget started\b/i,
    /\bfastest path\b/i,
    /\bself-serve\b/i,
    /\blaunch and manage\b/i,
    /\bwithout the complexity\b/i,
    /\bcontact sales\b/i,
    /\bbook a demo\b/i,
  ];
  if (promotionalSignals.filter((pattern) => pattern.test(response)).length >= 2) {
    tags.push('sourced_promotional');
  }
  if (/^(?:however|but|and|so|also|instead|meanwhile|therefore|thus|first of all|in turn|of)\b[\s,:-]*/i.test(response.trim())) {
    tags.push('sourced_weak_lead');
  }
  if (/\b(?:sources did not contain a direct, useful answer|not going to present it as a conclusion|didn't find anything that actually matches)\b/i.test(response)) {
    tags.push('sourced_insufficient_answer');
  }
  return tags;
}

function overlapRatio(a: string, b: string): number {
  const aT = new Set(tokens(a));
  const bT = tokens(b);
  if (aT.size === 0 || bT.length === 0) return 0;
  let hit = 0;
  for (const t of bT) if (aT.has(t)) hit++;
  return hit / bT.length;
}

function priorUserTopic(history: Array<{ role: string; content: string }>): string {
  const users = history.filter((m) => m.role === 'user').map((m) => m.content);
  if (users.length < 2) return users[0] ?? '';
  return users.slice(0, -1).join(' ');
}

export function relevanceScore(prompt: string, response: string, history: Array<{ role: string; content: string }>): number {
  const p = prompt.trim();
  const r = response.trim();
  if (!p || !r) return 0;

  let score = overlapRatio(r, p);

  const isFollowUp = /\b(?:what about|and |also |lol|hmm|ok but|nah|no i meant|tell me more|go on|continue|that one|the other)\b/i.test(p);
  if (isFollowUp) {
    const prior = priorUserTopic(history);
    const priorOverlap = overlapRatio(r, prior);
    score = Math.max(score, priorOverlap * 0.85);
  }

  const proper = [...p.matchAll(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)?\b/g)].map((m) => m[0]);
  for (const name of proper.slice(0, 3)) {
    if (r.toLowerCase().includes(name.toLowerCase())) score = Math.min(1, score + 0.25);
  }

  if (/\b(?:yes|no)\b/i.test(p) && wordCount(p) <= 6 && wordCount(r) <= 40) {
    score = Math.max(score, 0.55);
  }

  return Math.min(1, score);
}

export function gradeConvTurn(L: ConvTurnRecord): { tags: string[]; pass: boolean; relevance: number } {
  const tags: string[] = [];
  const p = String(L.prompt || '');
  const r = String(L.response || '').trim();

  if (L.error) {
    return { tags: ['engine_error'], pass: false, relevance: 0 };
  }
  if (!r) {
    return { tags: ['empty_response'], pass: false, relevance: 0 };
  }

  const rel = relevanceScore(p, r, L.history);
  const promptWords = wordCount(p);
  const hasQ = /[?]|\b(who|what|when|where|why|how|tell me|give me|list|name|explain)\b/i.test(p);
  const benchOffline = process.env.CONV_LOOP_OFFLINE === '1';

  if (SCRATCH_TOKENS.some((t) => r.includes(t))) tags.push('template_leak');
  if (FALLBACK_MARKERS.some((re) => re.test(r))) tags.push('fallback_refusal');

  const startsGreet = /^(hi|hello|hey|greetings|welcome)\b[\s,!.]/i.test(r);
  if (startsGreet && promptWords >= 8 && hasQ && wordCount(r) <= 14) {
    tags.push('greeting_eats_prompt');
  }

  if (
    L.strategy === 'format-only-followup'
    && /\b(?:only|just)\s+the\s+(?:name|number|word|answer)\b/i.test(p)
    && wordCount(r) <= 20
  ) {
    return { tags: ['ok'], pass: true, relevance: Math.max(rel, 0.5) };
  }

  if (promptWords >= 5 && hasQ && rel < 0.12 && !FALLBACK_MARKERS.some((re) => re.test(r))) {
    tags.push('irrelevant_to_prompt');
  }

  if (/\b(?:what about|and what about|lol)\b/i.test(p) && rel < 0.08 && wordCount(r) > 80) {
    tags.push('context_drop');
  }

  if (
    !benchOffline
    && hasQ
    && promptWords >= 4
    && !/\b(?:build|scaffold|create|implement|refactor|deploy)\b/i.test(p)
    && L.sources === 0
    && L.strategy
    && !/^(?:web-search|research-cited|canonical-fact|direct-match|arithmetic|algorithm|code-gen|gaming-casual|general-knowledge|format-only-followup|recency-followup)/.test(L.strategy)
    && FALLBACK_MARKERS.some((re) => re.test(r))
  ) {
    tags.push('should_have_searched');
  }

  if (/\b(?:only the|just the)\s+(?:name|number|word)\b/i.test(p) && wordCount(r) > 14) {
    tags.push('format_only_violated');
  }

  if ((L.sources ?? 0) > 0) {
    tags.push(...sourcedAnswerQualityTags(r));
  }

  const slowMs = benchOffline ? 2000 : 15_000;
  if (L.ms > slowMs) tags.push('slow_response');

  if (
    !benchOffline
    && (L.sources ?? 0) > 0
    && /^(?:web-search|research-cited)/.test(L.strategy ?? '')
    && !SCRATCH_TOKENS.some((t) => r.includes(t))
    && !FALLBACK_MARKERS.some((re) => re.test(r))
    && !tags.some((tag) => tag.startsWith('sourced_'))
    && rel >= 0.06
  ) {
    return { tags: ['ok', 'web_grounded'], pass: true, relevance: rel };
  }

  if (tags.length === 0) tags.push('ok');

  const hardFail = tags.some((t) =>
    t !== 'ok' && t !== 'slow_response' && t !== 'web_grounded',
  );

  return {
    tags,
    pass: !hardFail && rel >= 0.08,
    relevance: rel,
  };
}
