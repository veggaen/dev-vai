/**
 * Dynamic multi-turn conversation generator for conv-loop bench.
 * Topics are combinatorial (domain × subject × angle), not fixed Q&A scripts.
 */

export type SpeechStyle =
  | 'plain'
  | 'polite'
  | 'terse'
  | 'slang'
  | 'caps'
  | 'typo'
  | 'norsk'
  | 'rant'
  | 'emoji'
  | 'chaotic'
  | 'formal';

export type ConvSeed = {
  id: string;
  category: string;
  style: SpeechStyle;
  topic: string;
  keywords: string[];
  opener: string;
  followUpPlan: string[];
};

export type TopicEntry = {
  topic: string;
  keywords: string[];
  category: string;
};

export const STYLES: SpeechStyle[] = [
  'plain', 'polite', 'terse', 'slang', 'caps', 'typo', 'norsk', 'rant', 'emoji', 'chaotic', 'formal',
];

/** Combinatorial parts — generates thousands of unique prompts without hard-coded full answers. */
const DOMAINS: Record<string, { subjects: string[]; angles: string[] }> = {
  gaming: {
    subjects: [
      'ranked matchmaking', 'boss fight mechanics', 'crafting economy', 'patch balance',
      'starter build guides', 'co-op etiquette', 'speedrun routing', 'microtransactions',
    ],
    angles: ['for beginners', 'in 2026', 'after a long break', 'on a budget PC', 'without grinding'],
  },
  science: {
    subjects: [
      'photosynthesis', 'plate tectonics', 'vaccine immunity', 'black holes',
      'CRISPR basics', 'climate feedback loops', 'periodic table trends', 'sound waves',
    ],
    angles: ['explained simply', 'with real-world examples', 'for a curious adult', 'step by step'],
  },
  life: {
    subjects: [
      'remote work burnout', 'learning an instrument as an adult', 'adopting a rescue pet',
      'moving to a new city', 'sleep on night shifts', 'rainy weekend plans', 'home coffee brewing',
    ],
    angles: ['honestly', 'without toxic positivity', 'on a tight schedule', 'with minimal budget'],
  },
  tech: {
    subjects: [
      'Docker vs Podman', 'Redis vs Postgres roles', 'TypeScript strict mode',
      'CI/CD for solo devs', 'Tailwind vs CSS modules', 'API rate limiting', 'local LLM tooling',
    ],
    angles: ['for a side project', 'in production', 'when migrating legacy code'],
  },
  world: {
    subjects: [
      'capital cities in Europe', 'who invented Bitcoin', '2008 financial crisis causes',
      'EV battery range facts', 'tallest mountains', 'speed of light', 'population of major cities',
    ],
    angles: ['fact check', 'with sources', 'for a quiz', 'in plain language'],
  },
  opinion: {
    subjects: [
      'college degrees in 2026', 'electric vs hybrid commute cars', 'daily news consumption',
      'open-plan offices', 'meal prep vs delivery', 'buying vs renting housing',
    ],
    angles: ['pros and cons', 'what would you recommend', 'is it still worth it'],
  },
};

const OPENER_BY_CATEGORY: Record<string, string[]> = {
  gaming: [
    'yo whats the deal with {topic}',
    'explain {topic} like im new',
    '{topic} — worth caring about?',
    'is {topic} actually fun or overrated',
  ],
  science: [
    'quick: {topic}?',
    'can u tell me bout {topic}',
    'I need a straight answer on {topic}',
    'break down {topic} for me',
  ],
  life: [
    'random but {topic} — thoughts?',
    'been thinking about {topic}',
    'any advice on {topic}',
  ],
  tech: [
    'help me choose: {topic}',
    'practical take on {topic}',
    'what should I know about {topic}',
  ],
  world: [
    'quick: {topic}?',
    'I need a straight answer on {topic}',
    'verify: {topic}',
  ],
  opinion: [
    '{topic} — what do you think',
    'trying to decide: {topic}',
  ],
  research: [
    'do research on {topic}',
    'look it up: {topic}',
    'check sources for {topic}',
    'search the web for {topic}',
  ],
};

const FOLLOW_UP_TEMPLATES: Array<{
  id: string;
  when?: (topic: TopicEntry, lastResponse: string, turnIdx: number) => boolean;
  build: (topic: TopicEntry, lastResponse: string, turnIdx: number) => string;
}> = [
  { id: 'deeper-keyword', build: (t) => `ok but go deeper on ${t.keywords[0] ?? 'that'}` },
  {
    id: 'format-only',
    when: (_t, r) => hasSingleGroundedNumber(r),
    build: () => 'what was the number again? only the number',
  },
  { id: 'recency', build: () => 'lol anyway is that still accurate in 2026?' },
  { id: 'recommend', build: (t) => `and what would you recommend for ${t.keywords[0] ?? 'that'}` },
  { id: 'research-repeat', build: (t) => `do research — ${t.topic}` },
  { id: 'shorter', build: (_t, r) => (r.length > 350 ? 'shorter pls' : 'explain more simply') },
  { id: 'stay-topic', build: (t) => `yes — stay on ${t.topic}` },
  { id: 'clarify', build: (t) => `no i meant ${t.keywords[0] ?? 'that'} not general stuff` },
  { id: 'why', build: () => 'why though?' },
  { id: 'how-so', build: () => 'how so?' },
  { id: 'what-about', build: (t) => `what about ${t.topic} specifically tho` },
  { id: 'compare', build: (t) => `ok but ${t.keywords[1] ?? t.keywords[0]} vs alternatives?` },
];

const UNGROUNDED_RESPONSE =
  /\b(?:i do not know|i don't know|could not find|couldn't find|do not have|don't have|unable to verify|cannot confirm|can't confirm|no solid results?)\b/i;

export function hasSingleGroundedNumber(response: string): boolean {
  if (!response.trim() || UNGROUNDED_RESPONSE.test(response)) return false;
  const numbers = response.match(/\b\d[\d,]*(?:\.\d+)?\b/g) ?? [];
  return new Set(numbers.map((n) => n.replace(/,/g, ''))).size === 1;
}

export function createRng(seed: number, salt = 0): () => number {
  let s = (seed + salt * 7919) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

export function applyStyle(text: string, style: SpeechStyle): string {
  switch (style) {
    case 'polite':
      return `Could you please help me understand: ${text}`;
    case 'terse':
      return text.split(/\s+/).slice(0, 9).join(' ');
    case 'slang':
      return text.replace(/\byou\b/gi, 'u').replace(/\babout\b/gi, 'bout').replace(/\bwhat is\b/gi, 'whats');
    case 'caps':
      return text.toUpperCase();
    case 'typo':
      return text.replace(/\bthe\b/gi, 'teh').replace(/\bwith\b/gi, 'w/').replace(/\breally\b/gi, 'rly');
    case 'norsk':
      return `${text} (svar gjerne på norsk hvis det passer)`;
    case 'rant':
      return `${text} — seriously nobody explains this clearly online lol`;
    case 'emoji':
      return `🤔 ${text} 👀`;
    case 'chaotic':
      return `ok wait ${text} 😅 idk if that makes sense`;
    case 'formal':
      return `Please provide a concise explanation: ${text}`;
    default:
      return text;
  }
}

export function generateTopic(rand: () => number): TopicEntry {
  const domainKeys = Object.keys(DOMAINS);
  const domainKey = pick(rand, domainKeys);
  const domain = DOMAINS[domainKey]!;
  const subject = pick(rand, domain.subjects);
  const angle = pick(rand, domain.angles);
  const topic = `${subject} ${angle}`.replace(/\s+/g, ' ').trim();
  const keywords = (topic.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(0, 5);
  const category =
    domainKey === 'world' ? 'facts'
      : domainKey === 'life' ? 'casual'
        : domainKey;
  return { topic, keywords, category };
}

function openerCategory(base: TopicEntry, rand: () => number): string {
  if (rand() < 0.35) return 'research';
  return base.category;
}

export function buildConversationSeeds(n: number, seed: number): ConvSeed[] {
  const rand = createRng(seed);
  const out: ConvSeed[] = [];

  for (let i = 0; i < n; i++) {
    const convRand = createRng(seed, i + 1);
    const base = generateTopic(rand);
    const cat = openerCategory(base, convRand);
    const openerList = OPENER_BY_CATEGORY[cat] ?? OPENER_BY_CATEGORY.world!;
    const style = pick(convRand, STYLES);
    const tpl = pick(convRand, openerList);
    const opener = applyStyle(tpl.replace('{topic}', base.topic), style);

    const planIds = FOLLOW_UP_TEMPLATES.map((t) => t.id);
    for (let j = planIds.length - 1; j > 0; j--) {
      const k = Math.floor(convRand() * (j + 1));
      [planIds[j], planIds[k]] = [planIds[k]!, planIds[j]!];
    }

    out.push({
      id: `loop-${String(i + 1).padStart(4, '0')}`,
      category: cat === 'research' ? 'research' : base.category,
      style,
      topic: base.topic,
      keywords: base.keywords,
      opener,
      followUpPlan: planIds,
    });
  }
  return out;
}

export function buildFollowUpMessage(
  spec: ConvSeed,
  turnIdx: number,
  lastResponse: string,
): string {
  const topicEntry: TopicEntry = {
    topic: spec.topic,
    keywords: spec.keywords,
    category: spec.category,
  };
  const startIdx = (turnIdx - 1) % spec.followUpPlan.length;
  let template = FOLLOW_UP_TEMPLATES[0]!;
  for (let offset = 0; offset < spec.followUpPlan.length; offset++) {
    const planId = spec.followUpPlan[(startIdx + offset) % spec.followUpPlan.length]!;
    const candidate = FOLLOW_UP_TEMPLATES.find((t) => t.id === planId);
    if (candidate && (!candidate.when || candidate.when(topicEntry, lastResponse, turnIdx))) {
      template = candidate;
      break;
    }
  }
  const raw = template.build(topicEntry, lastResponse, turnIdx);
  return applyStyle(raw, spec.style);
}

export function variationStats(seeds: ConvSeed[]): Record<string, number | string> {
  return {
    conversations: seeds.length,
    uniqueTopics: new Set(seeds.map((s) => s.topic)).size,
    uniqueOpeners: new Set(seeds.map((s) => s.opener)).size,
    uniqueStyles: new Set(seeds.map((s) => s.style)).size,
    followUpTemplates: FOLLOW_UP_TEMPLATES.length,
    domainBuckets: Object.keys(DOMAINS).length,
    generation: 'combinatorial (domain × subject × angle)',
  };
}
