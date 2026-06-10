/**
 * Perplexity-Style Search Pipeline
 *
 * Full structured search flow:
 *   1. CLARIFY   — normalize query → VaiSearchPlan (intent, entities, constraints)
 *   2. FAN OUT   — parallel sub-queries (3-6 scoped searches)
 *   3. FETCH     — execute searches, collect raw snippets
 *   4. RANK      — score by trust × relevance, deduplicate
 *   5. READ      — extract answerable content from top results
 *   6. CROSS-CHECK — verify claims appear in multiple sources
 *   7. CONCLUDE  — synthesize answer with inline citations
 *
 * Safety is embedded at every step: URL validation before fetch,
 * trust scoring on results, content scanning on text, dedup on snippets.
 */

import type {
  VaiSearchPlan,
  SearchConstraints,
  SearchSnippet,
  SearchResponse,
  AuditEntry,
  SearchPipelineConfig,
  OnSearchLearn,
} from './types.js';
import { DEFAULT_SEARCH_CONFIG } from './types.js';
import { validateSearchUrl, scoreDomain, scanContentSafety, contentFingerprint } from './safety.js';
import { safeFetch } from '../network/safe-fetch.js';
import { classifySyncState, ThorsenAdaptiveController } from '../thorsen/types.js';
import { normalizeInputForUnderstanding } from '../input-normalization.js';
import {
  isFreshLocalBusinessContactRequest,
  isFreshLocalRecommendationRequest,
} from '../models/web-conclude-policy.js';

// ── Query Normalization (Step 1: CLARIFY) ──

/** Common query intent markers */
const INTENT_PATTERNS: ReadonlyArray<{ pattern: RegExp; intent: string }> = [
  { pattern: /^(what is|what are|what's|define)\b/i, intent: 'definition' },
  { pattern: /^(hva\s+er)\b/i, intent: 'definition' },
  { pattern: /^(how to|how do|how can|how does)\b/i, intent: 'how-to' },
  { pattern: /^(hvordan|korleis)\b/i, intent: 'how-to' },
  { pattern: /^(why|why does|why is|why are|explain|describe)\b/i, intent: 'explanation' },
  { pattern: /^(forklar|beskriv|hvorfor)\b/i, intent: 'explanation' },
  { pattern: /^(?:what\s+(?:caused|led\s+to|triggered|drove)|causes?\s+of|reasons?\s+for)\b/i, intent: 'causal' },
  { pattern: /^(compare|versus|vs\.?|difference between)\b/i, intent: 'comparison' },
  { pattern: /^(best|top|recommend|alternatives)\b/i, intent: 'recommendation' },
  { pattern: /^(when|what year|what date|timeline)\b/i, intent: 'temporal' },
  { pattern: /^(who|who is|who are|who was)\b/i, intent: 'person' },
  { pattern: /^(debug|fix|error|issue|problem|bug)\b/i, intent: 'troubleshoot' },
  { pattern: /\b(current|latest|newest|recent|stable|release|lts|2024|2025)\b/i, intent: 'current' },
];

/** Stop words to strip when extracting entities */
const ENTITY_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'per',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'about', 'and', 'but',
  'or', 'if', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
  'those', 'i', 'me', 'my', 'it', 'its', 'we', 'they', 'search', 'find',
  'look', 'up', 'tell', 'give', 'show', 'get', 'know', 'please', 'explain',
  'describe', 'explained', 'simple', 'words', 'simply', 'include', 'sources',
  'source', 'citation', 'citations', 'references', 'reference', 'cause', 'causes',
  'caused', 'led', 'trigger', 'triggered', 'drove', 'reason', 'reasons',
  'hva', 'hvordan', 'hvorfor', 'forklar', 'beskriv', 'kan', 'du', 'meg',
  'om', 'er', 'og', 'på', 'i', 'til', 'med', 'for', 'en', 'et', 'det', 'den',
]);

const FOLLOW_UP_NOISE_TOKENS = new Set([
  'simple', 'simply', 'word', 'words', 'include', 'source', 'sources',
  'citation', 'citations', 'reference', 'references', 'official', 'doc', 'docs',
  'documentation', 'page', 'pages', 'article', 'articles', 'guide', 'guides',
  'explained', 'explain', 'describe', 'overview', 'overviews',
  'forklar', 'beskriv', 'kort', 'enkelt', 'enkle',
]);

function hasComparisonMarkers(query: string): boolean {
  return /\b(?:vs\.?|versus|over|instead of|compared? to|difference between)\b/i.test(query);
}

function dedupeTopicTokens(tokens: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const token of tokens) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(token);
  }

  return deduped;
}

function stripTopicNoiseTerms(value: string): string {
  const tokens = value
    .split(/\s+/)
    .map(sanitizeEntityToken)
    .filter(Boolean);
  if (tokens.length === 0) return '';

  const filtered = dedupeTopicTokens(tokens.filter((token) => !FOLLOW_UP_NOISE_TOKENS.has(token.toLowerCase())));
  if (filtered.length > 0) return filtered.join(' ').trim();
  return dedupeTopicTokens(tokens).join(' ').trim();
}

function cleanQuerySubject(subject: string): string {
  return stripTopicNoiseTerms(sanitizeTopicPhrase(subject
    .replace(/^[\s"'`([{]+|[\s"'`\])}.?!,:;]+$/g, '')
    .replace(/\b(?:and\s+why|and\s+how)\b.*$/i, '')
    .replace(/\b(?:in\s+simple\s+words?|simply|for\s+beginners|med\s+enkle\s+ord|kort\s+fortalt)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()));
}

function sanitizeEntityToken(token: string): string {
  return token
    .replace(/^[\s"'`([{<]+/g, '')
    .replace(/[\s"'`\])}>!?,:;]+$/g, '')
    .replace(/^\.+|\.+$/g, '')
    .trim();
}

function sanitizeTopicPhrase(value: string): string {
  return value
    .split(/\s+/)
    .map(sanitizeEntityToken)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCommonTypos(query: string): string {
  return normalizeInputForUnderstanding(query);
}

function normalizeSearchQuery(query: string): string {
  const trimmed = normalizeCommonTypos(query.trim())
    .replace(/^(?:please\s+)?provide\s+(?:a\s+)?(?:(?:concise|brief|short)\s+)?(?:explanation|answer|summary)\s*:?\s*/i, '')
    .replace(/^verify\s*:\s*/i, '')
    .trim();
  const withoutLead = trimmed
    .replace(/^(?:please\s+)?(?:use|do)\s+web\s+search(?:\s+(?:and|to))?\s+(?:(?:study|research|investigate|explore|look\s+into)\s+)?/i, '')
    .replace(/^(?:please\s+)?(?:study|research|investigate|explore|look\s+into)\s+/i, '')
    .replace(/^(?:please\s+)?(?:search(?:\s+the\s+web)?(?:\s+for)?|look\s+up|find|tell\s+me|give\s+me|show\s+me)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const withoutTrailingInstructions = withoutLead
    .replace(/,?\s*include\s+(?:the\s+)?official\b.*$/i, '')
    .replace(/,?\s*include\s+sources?\b.*$/i, '')
    .replace(/,?\s*with\s+sources?\b.*$/i, '')
    .replace(/,?\s*and\s+at\s+least\s+one\s+supporting\s+source\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const withoutBuildTail = withoutTrailingInstructions
    .replace(/,?\s*(?:then|and\s+then)\s+(?:build|create|make|prototype|scaffold|turn)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\b(?:current|latest|stable|version|release|lts)\b/i.test(withoutBuildTail)) {
    const focusedClause = withoutBuildTail
      .split(/,\s*(?=what\b|why\b|how\b|when\b)/i)[0]
      ?.trim();
    if (focusedClause && focusedClause.length > 0) {
      return focusedClause;
    }
  }

  return withoutBuildTail || trimmed;
}

function extractPrimarySubject(query: string, entities: readonly string[]): string {
  const stripped = query
    .replace(/^(?:what\s+(?:is|are|was|were|caused|led\s+to|triggered|drove)|what's|what\s+do\s+you\s+know(?:\s+(?:about|of|on|regarding))?|do\s+you\s+know(?:\s+(?:about|of|on|regarding))?|have\s+you\s+heard\s+(?:of|about)|causes?\s+(?:of|for)|reasons?\s+(?:of|for)|define|explain|describe|tell\s+me\s+about|who\s+(?:is|are|was|were)|how\s+(?:does|do)|why\s+(?:does|is|are|would|should)|hva\s+er|forklar|beskriv|fortell\s+meg\s+om|hvordan(?:\s+fungerer)?)\s+/i, '')
    .replace(/\s+(?:root\s+)?causes?\s*$/i, '')
    .replace(/\s+reasons?\s*$/i, '')
    .replace(/^(?:of|about|on|regarding)\s+/i, '')
    .trim();

  if (/\b(?:current|latest|stable|version|release|lts)\b/i.test(stripped)) {
    const focusedEntity = entities.find((entity) => {
      const normalized = entity.toLowerCase();
      return entity.length > 1 && !PACKAGE_QUERY_NOISE.has(normalized) && normalized !== 'pypi';
    });
    if (focusedEntity) return cleanQuerySubject(focusedEntity);
  }

  const beforeComparison = stripped.split(/\b(?:over|vs\.?|versus|instead of|compared? to)\b/i)[0] ?? stripped;
  const cleaned = cleanQuerySubject(beforeComparison);
  if (cleaned.length > 0) return cleaned;
  return entities[0] ?? query.trim();
}

function extractComparisonSubject(query: string): string | null {
  const match = query.match(/\b(?:over|vs\.?|versus|instead of|compared? to)\b\s+(.+?)(?:\?|$)/i);
  if (!match) return null;
  const cleaned = cleanQuerySubject(match[1] ?? '');
  return cleaned.length > 0 ? cleaned : null;
}

function shouldBiasPerplexityToProduct(query: string, primarySubject: string): boolean {
  if (!/\bperplexity\b/i.test(primarySubject) && !/\bperplexity\b/i.test(query)) return false;
  if (/\b(?:information\s+theory|probability|distribution|entropy|language\s+model|token\s+prediction|cross-entropy)\b/i.test(query)) {
    return false;
  }
  return true;
}

export function buildSearchPlan(query: string): VaiSearchPlan {
  const trimmed = query.trim();
  const normalizedQuery = normalizeSearchQuery(trimmed);
  const lower = normalizedQuery.toLowerCase();

  // Detect intent
  const matched = INTENT_PATTERNS.find(p => p.pattern.test(lower));
  const intent = hasComparisonMarkers(lower)
    ? 'comparison'
    : isFreshLocalRecommendationRequest(normalizedQuery)
      ? 'recommendation'
      : isFreshLocalBusinessContactRequest(normalizedQuery)
        ? 'current'
      : (matched?.intent ?? 'general');

  // Extract entities (meaningful words)
  const words = normalizedQuery.split(/\s+/);
  const entities = words
    .map(sanitizeEntityToken)
    .filter(w => !ENTITY_STOP_WORDS.has(w.toLowerCase()) && w.length > 1)
    .filter(w => w.length > 1);

  // Build constraints from query signals
  const constraints: SearchConstraints = {};

  // Generate fan-out queries (scoped sub-searches)
  const fanOutQueries = generateFanOutQueries(normalizedQuery, intent, entities);

  return {
    originalQuery: trimmed,
    intent,
    entities,
    constraints,
    fanOutQueries,
  };
}


const FOLLOW_UP_PRESETS: ReadonlyArray<{ pattern: RegExp; items: readonly string[] }> = [
  {
    pattern: /^programming$/i,
    items: [
      'Best programming language for beginners',
      'How to learn programming step by step',
      'Programming vs coding differences',
    ],
  },
  {
    pattern: /^meaning$/i,
    items: [
      'Difference between meaning, definition, and purpose',
      'How meaning changes depending on context',
      'Examples of words with multiple meanings',
    ],
  },
  {
    pattern: /^single$/i,
    items: [
      'What does single mean in music vs everyday language?',
      'How is single used in Norwegian and English?',
      'What are the most common meanings of single?',
    ],
  },
  {
    pattern: /^typescript$/i,
    items: [
      'TypeScript vs JavaScript differences',
      'When to use interfaces vs type aliases',
      'How to enable strict mode in TypeScript',
    ],
  },
  {
    pattern: /^python$/i,
    items: [
      'Python vs JavaScript for beginners',
      'How to set up a Python virtual environment',
      'What should I build first in Python?',
    ],
  },
  {
    pattern: /^docker$/i,
    items: [
      'Docker images vs containers differences',
      'Docker Compose vs Kubernetes trade-offs',
      'How to debug a container that exits immediately',
    ],
  },
  {
    pattern: /^database$/i,
    items: [
      'SQL vs NoSQL differences',
      'How database indexing works',
      'When to normalize vs denormalize data',
    ],
  },
  {
    pattern: /^queue$/i,
    items: [
      'Queue vs stack differences',
      'How queues are used in async systems',
      'What enqueue, dequeue, and peek mean',
    ],
  },
  {
    pattern: /^cache$/i,
    items: [
      'Cache invalidation strategies',
      'Redis vs in-memory cache differences',
      'When caching hurts instead of helps',
    ],
  },
  {
    pattern: /^latency$/i,
    items: [
      'Latency vs throughput differences',
      'How to measure latency in an app',
      'What usually causes high latency',
    ],
  },
  {
    pattern: /^recursion$/i,
    items: [
      'Recursion vs iteration differences',
      'How base cases prevent infinite recursion',
      'When recursion becomes inefficient',
    ],
  },
  {
    pattern: /^websocket$/i,
    items: [
      'WebSocket vs Server-Sent Events differences',
      'How to keep WebSocket connections alive',
      'When to choose WebSocket over HTTP polling',
    ],
  },
  {
    pattern: /\bvinext\b/i,
    items: [
      'Turn this starter into a premium landing page',
      'Add auth and a dashboard shell to this app',
      'When should I pick Vinext over Next.js or plain Vite?',
    ],
  },
  {
    pattern: /\bnext(?:\.?js)?\b/i,
    items: [
      'Add Prisma and Postgres to this app',
      'Add GitHub sign-in next to Google auth',
      'Polish the onboarding and dashboard flow',
    ],
  },
  {
    pattern: /\b(?:notes?\s+dashboard|note-taking|notes?\s+app|note\s+workspace|knowledge\s+capture)\b/i,
    items: [
      'Add search, tags, and filters to this notes dashboard',
      'Persist notes in local storage and restore on reload',
      'Add edit, delete, and pin toggles to each note',
    ],
  },
  {
    pattern: /\b(?:social\s+blog(?:ging)?|social\s+app|blog(?:ging)?\s+app|community\s+(?:feed|app)|creator\s+platform|social\s+hub)\b/i,
    items: [
      'Add comments and likes to the feed',
      'Add author profiles and follow state to Social Hub',
      'Add trending topics and saved drafts to the composer',
    ],
  },
  {
    pattern: /\b(?:twitter|x(?:\.com)?\s+clone|social\s+feed|timeline|for\s+you|who\s+to\s+follow|trending\s+now|orbit\s+social)\b/i,
    items: [
      'Add a composer modal and inline thread replies to this feed',
      'Add profile pages, follow state, and engagement counters',
      'Add trends and who-to-follow rails with mobile navigation',
    ],
  },
  {
    pattern: /\b(?:copy|recreate|replicate|reference|screenshot|inspired)\b.*\b(?:website|landing(?:\s*page)?|homepage|hero|marketing(?:\s+page)?)\b/i,
    items: [
      'Tighten spacing, typography, and visual rhythm to match the reference closer',
      'Add responsive mobile navigation and a tighter tablet layout',
      'Replace placeholder sections with brand-specific copy and imagery slots',
    ],
  },
  {
    pattern: /\b(?:internal\s+(?:ops|tool)|ops\s+(?:dashboard|workspace|tool)|operations\s+(?:dashboard|workspace)|back\s*office|backoffice|admin\s+dashboard|approval\s+queue|ops\s+control\s+center)\b/i,
    items: [
      'Add assignee filters and SLA badges to the approval queue',
      'Turn the quick actions into working approval flows',
      'Add audit history and escalation states to Ops Control Center',
    ],
  },
  {
    pattern: /\b(?:saas|subscription|billing\s+portal|workspace\s+(?:app|shell)|saas\s+control\s+center)\b/i,
    items: [
      'Add plan upgrades and seat management to this SaaS workspace',
      'Add audit log filters and CSV export',
      'Add invite flows and role-based access to the team panel',
    ],
  },
  {
    pattern: /\b(?:sell|shop|store|storefront|catalog|checkout|cart|product(?:s|\s+detail)?|gift\s+set)\b.*\b(?:candles?|massage\s*oil|scent(?:ed|ing)?|aroma|wellness|body\s*oil|ritual)\b|\b(?:candles?|massage\s*oil|scent(?:ed|ing)?|aroma|wellness|body\s*oil|ritual)\b.*\b(?:shop|store|storefront|catalog|checkout|cart|sell|product(?:s|\s+detail)?)\b/i,
    items: [
      'Add a scent quiz and personalized bundle recommendations',
      'Turn the catalog into product detail pages with cart and checkout flow',
      'Add reviews, trust badges, and shipping thresholds to the storefront',
    ],
  },
  {
    pattern: /\b(?:sell|selling|shop|store|storefront|catalog|checkout|cart|products?|ecommerce|commerce|webshop|marketplace)\b.*\b(?:brand|business|firma|anything|goods|items|retail|online\s+store|general\s+store)\b|\b(?:brand|business|firma|anything|goods|items|retail|online\s+store|general\s+store)\b.*\b(?:sell|selling|shop|store|storefront|catalog|checkout|cart|products?|ecommerce|commerce|webshop|marketplace)\b/i,
    items: [
      'Add category navigation, search, and filters to the storefront',
      'Turn product cards into product detail pages with variants and cart flow',
      'Add featured collections, trust signals, and order-summary checkout states',
    ],
  },
  {
    pattern: /\breact\b/i,
    items: [
      'Add routing with React Router',
      'Set up state management with Zustand',
      'Add a REST API backend to this',
    ],
  },
  {
    pattern: /\b(?:pern|mern|express|node|server|api|backend|postgres|prisma)\b/i,
    items: [
      'Add authentication to this API',
      'Set up database migrations',
      'Add input validation with Zod',
    ],
  },
  {
    pattern: /\b(?:tailwind|css|style|design|ui)\b/i,
    items: [
      'Add a dark mode toggle with Tailwind CSS',
      'Make this responsive for mobile',
      'Add animations with Framer Motion',
    ],
  },
];

function finalizeFollowUps(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized = items
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item.length > 0)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return normalized.slice(0, 3);
}

function deriveFollowUpSubject(topic: string): string {
  const subject = stripTopicNoiseTerms(sanitizeTopicPhrase(topic
    .replace(/^(?:difference\s+between|compare)\s+/i, '')
    .replace(/\bvs\.?\b/gi, ' and ')
    .replace(/^(?:set\s*up|setup|build|create|make|start|generate|install|launch|spin\s*up|scaffold|deploy|debug|fix|troubleshoot)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()));

  return subject.length > 0 ? subject : topic;
}

export function normalizeFollowUpTopic(raw: string): string {
  return stripTopicNoiseTerms(sanitizeTopicPhrase(normalizeCommonTypos(raw)
    // Strip leading conversational glue from follow-up prompts. Without this,
    // "and how does that compare to fine tuning?" survives as the topic and
    // the related-question templates emit ungrammatical garbage like
    // "Which trade-offs matter most between and how does that compare to fine tuning?".
    .replace(/^(?:and|but|so|ok(?:ay)?|well|hmm+|yeah|ja|men|og)\s+/i, '')
    // "how does that compare to/with X" → "X". MUST run before the generic
    // "how does" stripper below, otherwise that one eats "how does" first
    // and leaves "that compare to X".
    .replace(/^(?:how\s+does\s+(?:that|it|this)\s+compare\s+(?:to|with|against)\s+)/i, '')
    .replace(/^(?:how\s+does\s+(?:that|it|this)\s+(?:differ|stack\s+up)\s+(?:from|against|to|with)\s+)/i, '')
    // Re-strip any question-opener that followed the glue word.
    .replace(/^(?:please\s+)?(?:(?:what\s+(?:is|are)|how\s+(?:do|does|to)|why\s+(?:is|are|does)|can\s+you\s+explain|explain|describe|tell\s+me\s+about|show\s+me|give\s+me|search\s+(?:for)?|find|look\s+up|hva\s+er|forklar|beskriv|fortell\s+meg\s+om|hvordan(?:\s+fungerer)?)\s+)?/i, '')
    .replace(/^(?:can|could|would)\s+you\s+/i, '')
    .replace(/^(?:set\s*up|setup|build|create|make|start|generate|install|launch|spin\s*up|scaffold)\s+/i, '')
    .replace(/\b(?:in\s+simple\s+words?|simply|for\s+beginners?|med\s+enkle\s+ord|kort\s+fortalt|kort\s+forklart)\b/gi, ' ')
    // Strip terse-output adverbs that the user adds for brevity. Without
    // this, "explain typescript briefly" normalises to "typescript briefly"
    // and never hits the curated primer (`typescript`) or the exact-entry
    // patterns (`what is typescript`, `explain typescript`). This caused
    // chat-mode "explain X <adverb>" prompts to fall through to retrieval
    // and emit a self-captured opinion-quote about the topic instead of an
    // actual explanation. Adverbs are pure formatting hints — the topic is
    // the noun phrase that remains.
    .replace(/\b(?:briefly|shortly|quickly|in\s+(?:short|brief|a\s+nutshell|one\s+(?:sentence|line)|a\s+sentence|a\s+line|a\s+paragraph|few\s+words?)|tldr|tl;dr|kort)\b/gi, ' ')
    .replace(/\b(?:include|with)\s+(?:sources?|citations?|references?)\b/gi, ' ')
    .replace(/\b(?:for\s+me|please|pls|thanks?|thank\s+you|kan\s+du|kort)\b/gi, ' ')
    .replace(/^a\s+|^an\s+|^the\s+/i, '')
    .replace(/\s+and\s+how\s+.*$/i, '')
    .replace(/\?.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()));
}

function normalizeSourceTitleForFollowUps(value: string): string {
  return stripTopicNoiseTerms(sanitizeTopicPhrase(value
    .replace(/\b(?:what\s+is|how\s+to|guide\s+to|guides\s+to|introduction\s+to|overview\s+of)\b/gi, ' ')
    .replace(/[|:]/g, ' ')
    .replace(/\b(?:docs?|documentation|help\s*center|release\s*notes?|changelog|official|home)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()));
}

function hostnameForBias(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isPerplexityOfficialResult(raw: RawSearchResult): boolean {
  const hostname = hostnameForBias(raw.url);
  return hostname === 'perplexity.ai' || hostname.endsWith('.perplexity.ai');
}

function isPerplexityOfficialDocsResult(raw: RawSearchResult): boolean {
  if (!isPerplexityOfficialResult(raw)) return false;
  const haystack = `${raw.title} ${raw.snippet} ${raw.url}`.toLowerCase();
  return /help[-\s]?center|discover|blog|api|enterprise/.test(haystack);
}

function isPerplexityUnofficialResult(raw: RawSearchResult): boolean {
  if (!isPerplexityOfficialResult(raw)) return false;

  const haystack = `${raw.title} ${raw.snippet} ${raw.url}`.toLowerCase();
  return /\b(?:unofficial|wrapper|clone|open[-\s]?source|community|account generator|reverse engineered)\b/.test(haystack)
    || /\b[a-z0-9._-]+\/[a-z0-9._-]+\b/i.test(raw.title);
}

function isPerplexityCloneOrWrapperResult(raw: RawSearchResult): boolean {
  const hostname = hostnameForBias(raw.url);
  if (hostname === 'github.com') return true;
  if (hostname === 'sourceforge.net') return true;
  if (hostname === 'glarity.app') return true;
  if (hostname === 'toolify.ai') return true;
  if (hostname === 'futurepedia.io') return true;
  if (hostname === 'aitoolnet.com') return true;
  if (hostname === 'theresanaiforthat.com') return true;
  if (hostname === 'topai.tools') return true;

  const haystack = `${raw.title} ${raw.snippet} ${raw.url}`.toLowerCase();
  return /\b(?:clone|wrapper|tool review|alternatives?|open-source search engine|open-source perplexity|directory listing|perplexity[-\s]?inspired|inspired by perplexity|llm answer engine)\b/.test(haystack)
    || (/\b[a-z0-9._-]+\/[a-z0-9._-]+\b/i.test(raw.title) && /\b(?:perplexity|answer engine|search engine)\b/i.test(haystack));
}

function isPerplexityWrapperLikeResult(raw: RawSearchResult): boolean {
  return isPerplexityUnofficialResult(raw) || isPerplexityCloneOrWrapperResult(raw);
}

// "who is the current king of norway" / "president of france" style queries
// look up a person, not a software project. Code-hosting domains never have
// the answer and frequently leak unrelated repos like `flike/kingshard`.
function isHeadOfStateQuery(query: string): boolean {
  return /\b(?:who\s+is\s+(?:the\s+)?(?:current\s+|present\s+|sitting\s+)?(?:king|queen|monarch|emperor|empress|president|prime\s+minister|pm|chancellor|sultan|emir|ruler|head\s+of\s+state|head\s+of\s+government))\b/i.test(query);
}

function isCodeHostingDomain(domain: string): boolean {
  return /(^|\.)(?:github\.com|gitlab\.com|bitbucket\.org|sourceforge\.net|codeberg\.org|gitea\.io)$/i.test(domain);
}

function isPerplexityProductResult(raw: RawSearchResult): boolean {
  const haystack = `${raw.title} ${raw.snippet} ${raw.url}`.toLowerCase();
  return /\bperplexity ai\b|perplexity_ai|perplexity\.ai|\bsonar\b|\bsearch engine\b|\bai company\b|\bllm\b/.test(haystack);
}

function isPerplexityMathResult(raw: RawSearchResult): boolean {
  const haystack = `${raw.title} ${raw.snippet} ${raw.url}`.toLowerCase();
  return /wiki\/perplexity(?:$|[?#])|\binformation theory\b|\bprobability distribution\b|\bcross-entropy\b|\bfair coin toss\b|\bfair die\b/.test(haystack);
}

function isLexicalTopicFollowUpCandidate(topic: string): boolean {
  const words = topic.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  if (!words.every((word) => /^[a-z0-9+#.-]{3,}$/i.test(word))) return false;
  if (/\b(?:app|project|dashboard|site|website|workflow|stack|starter|template|scaffold|deploy|install|setup|debug|fix|api|sdk|cli|server|service|database)\b/i.test(topic)) {
    return false;
  }
  return true;
}

type FactualLookupKind =
  | 'capital'
  | 'population'
  | 'currency'
  | 'language'
  | 'founder'
  | 'founded-when'
  | 'headquarters'
  | 'ceo'
  | 'speed'
  | 'birth'
  | 'death'
  | 'who-is'
  | 'where-is'
  | 'when-was';

export interface FactualLookup {
  kind: FactualLookupKind;
  entity: string;
}

function titleCaseEntity(raw: string): string {
  const cleaned = raw.replace(/[?.!,;:]+$/g, '').trim();
  if (!cleaned) return cleaned;
  if (/^[A-Z0-9]{2,}$/.test(cleaned)) return cleaned;
  return cleaned.split(/\s+/).map((word) => {
    if (/^(?:of|in|on|at|to|the|and|for|by|de|la|le)$/i.test(word)) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

// Reject "entities" that are obviously question-template noise leaking into
// the slot — e.g. when a follow-up prompt like "And the primary language
// spoken there?" gets crossed with a previous-topic stitch and produces
// captures like "the primary language spoken there". Real factual entities
// are short proper nouns ("Norway", "Microsoft", "Einstein"), not phrases
// containing the very topic words the chip is meant to ask about.
const FACTUAL_ENTITY_NOISE = /\b(?:language|languages|currency|currencies|capital|capitals|population|populations|founder|founders|headquarters|ceo|speed|symbol|symbols|code|codes|primary|official|main|spoken|there|here|this|that|those|these|same|above|below|previously|earlier)\b/i;

function isLikelyFactualEntity(entity: string): boolean {
  if (!entity || entity.length < 2) return false;
  if (entity.split(/\s+/).length > 5) return false;
  if (FACTUAL_ENTITY_NOISE.test(entity)) return false;
  return true;
}

export function detectFactualLookup(rawTopic: string): FactualLookup | null {
  const t = rawTopic.trim().replace(/[?.!]+$/g, '');
  if (!t) return null;

  let m = /\bcapital\s+(?:city\s+)?of\s+(.+)$/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'capital', entity: e }; }
  m = /\bpopulation\s+of\s+(.+)$/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'population', entity: e }; }
  m = /\bcurrency\s+(?:of|in)\s+(.+)$/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'currency', entity: e }; }
  m = /\b(?:official\s+)?language(?:s)?\s+(?:of|spoken\s+in)\s+(.+)$/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'language', entity: e }; }

  m = /\b(?:who\s+)?(?:founded|created|started)\s+(.+)$/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'founder', entity: e }; }
  m = /\bfounder(?:s)?\s+of\s+(.+)$/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'founder', entity: e }; }
  m = /\bwhen\s+was\s+(.+?)\s+(?:founded|created|started|established)\b/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'founded-when', entity: e }; }
  m = /\b(?:headquarters|hq)\s+of\s+(.+)$/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'headquarters', entity: e }; }
  m = /\b(?:ceo|chief\s+executive)\s+of\s+(.+)$/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'ceo', entity: e }; }

  m = /\bspeed\s+of\s+(.+)$/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'speed', entity: e }; }

  m = /\bwhen\s+was\s+(.+?)\s+born\b/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'birth', entity: e }; }
  m = /\bwhen\s+(?:did|was)\s+(.+?)\s+die\b/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'death', entity: e }; }
  m = /\bwho\s+(?:is|was)\s+(.+)$/i.exec(t);
  if (m) {
    const entity = titleCaseEntity(m[1].replace(/^the\s+/i, ''));
    if (entity.length >= 2 && isLikelyFactualEntity(entity)) return { kind: 'who-is', entity };
  }
  m = /\bwhere\s+is\s+(.+)$/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'where-is', entity: e }; }
  m = /\bwhen\s+was\s+(.+)$/i.exec(t);
  if (m) { const e = titleCaseEntity(m[1]); if (isLikelyFactualEntity(e)) return { kind: 'when-was', entity: e }; }

  return null;
}

export function factualLookupFollowUps({ kind, entity }: FactualLookup): string[] {
  switch (kind) {
    case 'capital':
      return [
        `What is the population of ${entity}?`,
        `What language is spoken in ${entity}?`,
        `What currency does ${entity} use?`,
      ];
    case 'population':
      return [
        `What is the capital of ${entity}?`,
        `What is the largest city in ${entity}?`,
        `What language is spoken in ${entity}?`,
      ];
    case 'currency':
      return [
        `What is the capital of ${entity}?`,
        `What is the population of ${entity}?`,
        `What language is spoken in ${entity}?`,
      ];
    case 'language':
      return [
        `What is the capital of ${entity}?`,
        `What currency does ${entity} use?`,
        `Where is ${entity} located?`,
      ];
    case 'founder':
      return [
        `When was ${entity} founded?`,
        `Where is ${entity} headquartered?`,
        `Who runs ${entity} today?`,
      ];
    case 'founded-when':
      return [
        `Who founded ${entity}?`,
        `Where is ${entity} headquartered?`,
        `What does ${entity} do today?`,
      ];
    case 'headquarters':
      return [
        `Who founded ${entity}?`,
        `When was ${entity} founded?`,
        `Who is the CEO of ${entity}?`,
      ];
    case 'ceo':
      return [
        `When was ${entity} founded?`,
        `Where is ${entity} headquartered?`,
        `Who founded ${entity}?`,
      ];
    case 'speed':
      return [
        `What is the speed of ${entity} in km/s?`,
        `Why is the speed of ${entity} a constant?`,
        `How was the speed of ${entity} first measured?`,
      ];
    case 'birth':
      return [
        `What is ${entity} best known for?`,
        `When did ${entity} die?`,
        `Where was ${entity} born?`,
      ];
    case 'death':
      return [
        `What is ${entity} best known for?`,
        `When was ${entity} born?`,
        `What did ${entity} create?`,
      ];
    case 'who-is':
      return [
        `What is ${entity} best known for?`,
        `When was ${entity} born?`,
        `Where is ${entity} from?`,
      ];
    case 'where-is':
      return [
        `What is ${entity} known for?`,
        `When was ${entity} founded?`,
        `Who lives in ${entity}?`,
      ];
    case 'when-was':
      return [
        `What is ${entity} known for?`,
        `Where is ${entity}?`,
        `Why does ${entity} matter?`,
      ];
    default:
      return [];
  }
}

export function generateTopicFollowUps(rawTopic: string, intent = 'general'): string[] {
  const topic = normalizeFollowUpTopic(rawTopic);
  if (topic.length < 2) return [];

  // Suppress follow-ups when the cleaned topic is still conversational filler
  // ("that", "it", "this", "you"...) or starts with a sentence-fragment opener.
  // Producing "Which trade-offs matter most between that?" is worse than nothing.
  if (/^(?:that|it|this|those|these|you|me|us|them|something|anything|everything|stuff|things?)$/i.test(topic)) return [];
  if (/^(?:write|show|give|tell|teach|help|make|give\s+me|how\s+can|how\s+do)\b/i.test(topic)) return [];

  const subject = deriveFollowUpSubject(topic);
  if (subject.length < 2 || /^(?:that|it|this)$/i.test(subject)) return [];

  // Factual-lookup follow-ups: "capital of X", "population of X", "founder of X",
  // "speed of light", "who founded X", "when was X born". The previous template
  // path emitted nonsense like "How is the capital of Norway used in a real
  // project?" because subject was the lookup phrase, not the entity.
  const factual = detectFactualLookup(rawTopic);
  if (factual) {
    const items = factualLookupFollowUps(factual);
    if (items.length > 0) return finalizeFollowUps(items);
  }

  if (intent === 'comparison') {
    return finalizeFollowUps([
      `Which trade-offs matter most between ${subject}?`,
      `What does the performance picture look like for ${subject}?`,
      `What breaks during a migration between ${subject}?`,
    ]);
  }

  for (const preset of FOLLOW_UP_PRESETS) {
    if (preset.pattern.test(topic)) {
      return finalizeFollowUps(preset.items);
    }
  }

  if (intent === 'general' && isLexicalTopicFollowUpCandidate(topic)) {
    return finalizeFollowUps([
      `How is ${subject} used in practice?`,
      `What are the core ideas behind ${subject}?`,
      `What should I learn next after ${subject}?`,
    ]);
  }

  if (/\bgithub\b/i.test(topic) && /\b(?:top|most|rank(?:ed|ing)?|followers?|stars?|maintainers?|developers?|devs?)\b/i.test(topic)) {
    return finalizeFollowUps([
      'Rank this by GitHub followers',
      'Rank this by project stars instead',
      'Give me 3 high-signal names to inspect',
    ]);
  }

  switch (intent) {
    case 'definition':
      return finalizeFollowUps([
        `How is ${subject} used in a real project?`,
        `What problem does ${subject} solve best?`,
        `What should I learn right after ${subject}?`,
      ]);
    case 'explanation':
      return finalizeFollowUps([
        `What does ${subject} look like in a real workflow?`,
        `When should I reach for ${subject} instead of another tool?`,
        `Which part of ${subject} should I understand next?`,
      ]);
    case 'how-to':
      return finalizeFollowUps([
        `What usually breaks when setting up ${subject}?`,
        `How should I structure ${subject} in a real project?`,
        `What is the fastest production-ready path for ${subject}?`,
      ]);
    case 'troubleshoot':
      return finalizeFollowUps([
        `What is the fastest way to isolate ${subject} failures?`,
        `Which logs or metrics matter most for ${subject}?`,
        `What usually causes ${subject} to regress again?`,
      ]);
    case 'current':
      return finalizeFollowUps([
        `What changed recently in ${subject}?`,
        `Which release notes matter most for ${subject}?`,
        `What should I validate before upgrading ${subject}?`,
      ]);
    case 'recommendation':
      return finalizeFollowUps([
        `Which use case is ${subject} best for?`,
        `What are the strongest alternatives to ${subject}?`,
        `What trade-offs would rule out ${subject}?`,
      ]);
    default:
      // Subject-anchored, not subject-less boilerplate. The old default emitted
      // "Narrow this to the strongest recommendation" / "Show the key trade-offs"
      // — generic noise the user rightly read as irrelevant because it named
      // nothing. These name the actual subject, so they stay on-topic and the
      // client relevance filter keeps them only when they overlap the answer.
      return finalizeFollowUps([
        `What's the most important thing to know about ${subject}?`,
        `Can you give a concrete example of ${subject}?`,
        `What do people most often get wrong about ${subject}?`,
      ]);
  }
}
function generateFanOutQueries(query: string, intent: string, entities: readonly string[]): string[] {
  const queries: string[] = [query]; // always include original

  const entityStr = entities.slice(0, 4).join(' ');
  const primarySubject = extractPrimarySubject(query, entities);
  const comparisonSubject = extractComparisonSubject(query);
  const biasPerplexityToProduct = shouldBiasPerplexityToProduct(query, primarySubject);

  switch (intent) {
    case 'definition':
      queries.push(`${primarySubject} explained simply`);
      queries.push(biasPerplexityToProduct ? 'what is Perplexity AI' : `${primarySubject} official docs`);
      if (biasPerplexityToProduct) queries.push('Perplexity AI search engine');
      queries.push(`${primarySubject} wikipedia`);
      break;
    case 'how-to':
      queries.push(`${entityStr} tutorial step by step`);
      queries.push(`${entityStr} example code`);
      break;
    case 'explanation':
      queries.push(`${primarySubject} explained simply`);
      queries.push(biasPerplexityToProduct ? 'what is Perplexity AI' : `what is ${primarySubject}`);
      queries.push(biasPerplexityToProduct ? 'Perplexity AI search engine' : `${primarySubject} official site`);
      break;
    case 'causal':
      queries.push(`${primarySubject} causes explained`);
      queries.push(`${primarySubject} root causes analysis`);
      queries.push(`${primarySubject} causes wikipedia`);
      break;
    case 'comparison':
      if (comparisonSubject) {
        queries.push(`${primarySubject} vs ${comparisonSubject}`);
        queries.push(`${primarySubject} compared to ${comparisonSubject}`);
      }
      queries.push(`${primarySubject} official docs`);
      queries.push(`${primarySubject} pros cons comparison`);
      break;
    case 'recommendation':
      if (isFreshLocalRecommendationRequest(query)) {
        queries.push(`${query} reviews menu`);
        queries.push(`${query} official opening hours`);
        queries.push(`${query} local guide`);
      } else {
        queries.push(`best ${entityStr} 2026`);
        queries.push(`${entityStr} alternatives comparison`);
      }
      break;
    case 'troubleshoot':
      queries.push(`${entityStr} solution fix`);
      queries.push(`${entityStr} stackoverflow`);
      break;
    case 'current':
      queries.push(`${entityStr} latest 2025`);
      queries.push(`${entityStr} release notes changelog`);
      break;
    default:
      queries.push(`${primarySubject || entityStr} overview`);
      break;
  }

  // Cap at configured max
  return queries.slice(0, 6);
}

// ── Search Providers (Step 3: FETCH) ──

interface RawSearchResult {
  title: string;
  snippet: string;
  url: string;
}

const PACKAGE_QUERY_NOISE = new Set([
  'current', 'stable', 'version', 'pypi', 'latest', 'release', 'lts', 'official',
  'page', 'source', 'sources', 'supporting', 'tool', 'should', 'use', 'when', 'what',
  'does', 'from', 'the',
]);

const REGISTRY_METADATA_HOSTS = new Set(['pypi.org', 'registry.npmjs.org', 'crates.io']);
const STRUCTURED_METADATA_HOSTS = new Set(['openstreetmap.org']);

interface LocalVenueCategory {
  readonly label: string;
  readonly filters: readonly {
    readonly key: string;
    readonly pattern: string;
  }[];
}

const LOCAL_VENUE_CATEGORIES: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly category: LocalVenueCategory;
}> = [
  {
    pattern: /\b(?:restaurants?|resturants?|restuarants?|places?\s+to\s+eat|eater(?:y|ies)|caf(?:e|é)s?|coffee\s+shops?|bars?|pubs?)\b/iu,
    category: {
      label: 'dining',
      filters: [{ key: 'amenity', pattern: '^(restaurant|cafe|fast_food|bar|pub)$' }],
    },
  },
  {
    pattern: /\b(?:hotels?|hostels?)\b/iu,
    category: {
      label: 'accommodation',
      filters: [{ key: 'tourism', pattern: '^(hotel|guest_house|hostel|motel)$' }],
    },
  },
  {
    pattern: /\b(?:gyms?|fitness\s+cent(?:er|re)s?)\b/iu,
    category: {
      label: 'fitness',
      filters: [{ key: 'leisure', pattern: '^fitness_centre$' }],
    },
  },
  {
    pattern: /\b(?:dentists?|doctors?|clinics?|pharmacies?|hospitals?)\b/iu,
    category: {
      label: 'healthcare',
      filters: [{ key: 'amenity', pattern: '^(dentist|doctors|clinic|pharmacy|hospital)$' }],
    },
  },
  {
    pattern: /\b(?:shops?|stores?|grocer(?:y|ies)|supermarkets?)\b/iu,
    category: {
      label: 'shopping',
      filters: [{ key: 'shop', pattern: '^(supermarket|convenience|department_store|general)$' }],
    },
  },
  {
    pattern: /\b(?:hairdressers?|barbers?|salons?)\b/iu,
    category: {
      label: 'hair and beauty',
      filters: [{ key: 'shop', pattern: '^(hairdresser|beauty)$' }],
    },
  },
  {
    pattern: /\b(?:mechanics?|car\s+repair)\b/iu,
    category: {
      label: 'car repair',
      filters: [{ key: 'shop', pattern: '^car_repair$' }],
    },
  },
  {
    pattern: /\b(?:cinemas?|movie\s+theaters?|attractions?|things?\s+to\s+do)\b/iu,
    category: {
      label: 'attractions',
      filters: [
        { key: 'amenity', pattern: '^cinema$' },
        { key: 'tourism', pattern: '^(attraction|museum|gallery|theme_park|viewpoint)$' },
      ],
    },
  },
];

const localVenueRequestCache = new Map<string, Promise<RawSearchResult[]>>();
const localBusinessContactCache = new Map<string, Promise<RawSearchResult[]>>();

function extractLocalRecommendationLocation(query: string): string | null {
  const normalized = normalizeCommonTypos(query)
    .replace(/\b(?:reviews?|menus?|official|opening\s+hours?|local\s+guide|current|latest|nearby)\b.*$/iu, '')
    .replace(/[?.!,;:]+$/g, '')
    .trim();
  const match = normalized.match(/\b(?:in|near|around|close\s+to|i|nær|rundt)\s+([\p{L}\d][\p{L}\d .,'’\-]{1,80})$/iu);
  if (!match?.[1]) return null;
  return match[1].trim().replace(/\s+/g, ' ');
}

function classifyLocalVenueCategory(query: string): LocalVenueCategory | null {
  return LOCAL_VENUE_CATEGORIES.find(({ pattern }) => pattern.test(query))?.category ?? null;
}

function escapeOverpassString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function humanizeOsmValue(value: string): string {
  return value.replace(/_/g, ' ').replace(/;/g, ', ');
}

function firstHttpUrl(tags: Record<string, string>): string | null {
  for (const key of ['website', 'contact:website']) {
    const value = tags[key]?.trim();
    if (value && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

function buildLocalVenueSnippet(
  name: string,
  category: LocalVenueCategory,
  requestedLocation: string,
  resolvedLocation: string,
  tags: Record<string, string>,
): string {
  const details: string[] = [
    `${name} is listed as a ${humanizeOsmValue(tags.amenity ?? tags.tourism ?? tags.shop ?? category.label)} near ${requestedLocation}`,
  ];
  if (resolvedLocation.toLowerCase() !== requestedLocation.toLowerCase()) {
    details[0] += ` (${resolvedLocation})`;
  }
  details[0] += '.';

  if (tags.cuisine) details.push(`Cuisine: ${humanizeOsmValue(tags.cuisine)}.`);
  if (tags.opening_hours) details.push(`Opening hours: ${tags.opening_hours}.`);
  if (tags.delivery) details.push(`Delivery: ${humanizeOsmValue(tags.delivery)}.`);
  if (tags.outdoor_seating) details.push(`Outdoor seating: ${humanizeOsmValue(tags.outdoor_seating)}.`);
  if (tags.phone) details.push(`Phone: ${tags.phone}.`);
  const website = firstHttpUrl(tags);
  if (website) details.push(`Website: ${website}.`);
  details.push('OpenStreetMap confirms the listing details but does not provide a quality rating.');
  return details.join(' ');
}

async function fetchOpenStreetMapLocalRecommendation(
  query: string,
  timeoutMs: number,
): Promise<RawSearchResult[]> {
  if (!isFreshLocalRecommendationRequest(query)) return [];
  const requestedLocation = extractLocalRecommendationLocation(query);
  const category = classifyLocalVenueCategory(query);
  if (!requestedLocation || !category) return [];

  const cacheKey = `${category.label}:${requestedLocation.toLowerCase()}`;
  const cached = localVenueRequestCache.get(cacheKey);
  if (cached) return cached;

  const request = (async (): Promise<RawSearchResult[]> => {
    const headers = {
      'User-Agent': 'VeggaAI/1.0 (local recommendation research)',
      'Accept-Language': 'en,no;q=0.9',
    };
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(requestedLocation)}`;
    const geocodeResponse = await fetch(geocodeUrl, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!geocodeResponse.ok) return [];

    const geocoded = await geocodeResponse.json() as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
    }>;
    const place = geocoded[0];
    const latitude = Number(place?.lat);
    const longitude = Number(place?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

    const selectors = category.filters
      .map(({ key, pattern }) => `nwr["${escapeOverpassString(key)}"~"${escapeOverpassString(pattern)}"](around:7000,${latitude},${longitude});`)
      .join('');
    const overpassQuery = `[out:json][timeout:18];(${selectors});out center tags 50;`;
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
    const overpassResponse = await fetch(overpassUrl, {
      headers,
      signal: AbortSignal.timeout(Math.max(timeoutMs, 20_000)),
    });
    if (!overpassResponse.ok) return [];

    const data = await overpassResponse.json() as {
      elements?: Array<{
        type?: 'node' | 'way' | 'relation';
        id?: number;
        tags?: Record<string, string>;
      }>;
    };
    const resolvedLocation = place?.display_name?.split(',').slice(0, 3).join(',').trim() || requestedLocation;
    const results: RawSearchResult[] = [];
    for (const element of data.elements ?? []) {
      const tags = element.tags ?? {};
      const name = tags.name?.trim() || tags.brand?.trim();
      if (!name || !element.type || !element.id) continue;
      results.push({
        title: name,
        snippet: buildLocalVenueSnippet(name, category, requestedLocation, resolvedLocation, tags),
        url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      });
      if (results.length >= 12) break;
    }
    return results;
  })().catch(() => [] as RawSearchResult[]);

  localVenueRequestCache.set(cacheKey, request);
  void request.finally(() => {
    setTimeout(() => localVenueRequestCache.delete(cacheKey), 5 * 60_000).unref?.();
  });
  return request;
}

function extractLocalBusinessSearchSubject(query: string): string | null {
  const normalized = normalizeCommonTypos(query)
    .replace(/^(?:(?:you\s+should|please|can\s+you)\s+)?(?:find|look\s+up|search(?:\s+for)?|check|verify)\s+/i, '')
    .replace(/^(?:it|that|this)\s+(?:online|on\s+the\s+web|the\s+web|google)\s*/i, '')
    .replace(/^(?:the\s+)?(?:phone(?:\s+number)?|telephone(?:\s+number)?|contact(?:\s+details?)?|address|opening\s+hours?|website|email)\s*(?:online\s*)?(?:for|of|to)?\s*/i, '')
    .replace(/[?.!,;:]+$/g, '')
    .trim();
  return normalized.length >= 3 ? normalized : null;
}

function firstContactValue(tags: Record<string, string>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = tags[key]?.trim();
    if (value) return value;
  }
  return null;
}

function buildLocalBusinessContactSnippet(
  name: string,
  displayName: string,
  tags: Record<string, string>,
): string {
  const details = [`${name} is currently listed at ${displayName}.`];
  const phone = firstContactValue(tags, ['phone', 'contact:phone']);
  const website = firstContactValue(tags, ['website', 'contact:website']);
  const email = firstContactValue(tags, ['email', 'contact:email']);
  if (phone) details.push(`Phone: ${phone}.`);
  if (website) details.push(`Website: ${website}.`);
  if (email) details.push(`Email: ${email}.`);
  if (tags.opening_hours) details.push(`Opening hours: ${tags.opening_hours}.`);
  return details.join(' ');
}

async function fetchOpenStreetMapBusinessContact(
  query: string,
  timeoutMs: number,
): Promise<RawSearchResult[]> {
  if (!isFreshLocalBusinessContactRequest(query)) return [];
  const subject = extractLocalBusinessSearchSubject(query);
  if (!subject) return [];

  const cacheKey = subject.toLowerCase();
  const cached = localBusinessContactCache.get(cacheKey);
  if (cached) return cached;

  const request = (async (): Promise<RawSearchResult[]> => {
    const headers = {
      'User-Agent': 'VeggaAI/1.0 (public business contact research)',
      'Accept-Language': 'en,no;q=0.9',
    };
    const searchUrl = [
      'https://nominatim.openstreetmap.org/search?format=jsonv2',
      'limit=5',
      'addressdetails=1',
      'extratags=1',
      'namedetails=1',
      `q=${encodeURIComponent(subject)}`,
    ].join('&');
    const response = await fetch(searchUrl, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return [];

    const results = await response.json() as Array<{
      osm_type?: 'node' | 'way' | 'relation';
      osm_id?: number;
      name?: string;
      display_name?: string;
      extratags?: Record<string, string>;
      namedetails?: Record<string, string>;
    }>;

    const requestedPhone = /\b(?:phone|telephone)\b/i.test(query);
    const requestedWebsite = /\bwebsite\b/i.test(query);
    const requestedEmail = /\bemail\b/i.test(query);
    const requestedHours = /\bopening\s+hours?\b/i.test(query);

    return results.flatMap((result): RawSearchResult[] => {
      if (!result.osm_type || !result.osm_id) return [];
      const tags = result.extratags ?? {};
      const phone = firstContactValue(tags, ['phone', 'contact:phone']);
      const website = firstContactValue(tags, ['website', 'contact:website']);
      const email = firstContactValue(tags, ['email', 'contact:email']);
      if (requestedPhone && !phone) return [];
      if (requestedWebsite && !website) return [];
      if (requestedEmail && !email) return [];
      if (requestedHours && !tags.opening_hours) return [];

      const name = result.name?.trim()
        || result.namedetails?.name?.trim()
        || result.namedetails?.brand?.trim();
      if (!name) return [];
      const displayName = result.display_name?.trim() || subject;
      return [{
        title: name,
        snippet: buildLocalBusinessContactSnippet(name, displayName, tags),
        url: `https://www.openstreetmap.org/${result.osm_type}/${result.osm_id}`,
      }];
    });
  })().catch(() => [] as RawSearchResult[]);

  localBusinessContactCache.set(cacheKey, request);
  void request.finally(() => {
    setTimeout(() => localBusinessContactCache.delete(cacheKey), 5 * 60_000).unref?.();
  });
  return request;
}

function normalizePackageToken(value: string): string {
  return value.replace(/^[^a-z0-9]+|[^a-z0-9._-]+$/gi, '').trim();
}

function extractPyPIPackageName(query: string, packageHints: readonly string[] = []): string | null {
  if (!/\bpypi\b/i.test(query)) return null;

  const versionLookahead = query.match(/\b([a-z0-9][a-z0-9._-]*[a-z0-9])\b(?=\s+version\b)/i)?.[1];
  if (versionLookahead) return normalizePackageToken(versionLookahead).toLowerCase();

  const versionOf = query.match(/\bversion\s+(?:of|for)\s+([a-z0-9][a-z0-9._-]*[a-z0-9])\b/i)?.[1];
  if (versionOf) return normalizePackageToken(versionOf).toLowerCase();

  const hinted = packageHints
    .map(normalizePackageToken)
    .find((token) => token.length > 1 && !PACKAGE_QUERY_NOISE.has(token.toLowerCase()) && /[-_.]/.test(token));
  if (hinted) return hinted.toLowerCase();

  const fallback = query
    .split(/\s+/)
    .map(normalizePackageToken)
    .find((token) => token.length > 1 && !PACKAGE_QUERY_NOISE.has(token.toLowerCase()) && /[-_.]/.test(token));
  return fallback ? fallback.toLowerCase() : null;
}

/** Brave Search API — free tier 2000 req/month, returns real web results */
async function fetchBrave(query: string, apiKey: string, timeoutMs: number): Promise<RawSearchResult[]> {
  const results: RawSearchResult[] = [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8&safesearch=moderate`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return results;
    const data = await res.json() as {
      web?: { results?: Array<{ title?: string; description?: string; url?: string }> };
    };
    for (const r of (data.web?.results ?? []).slice(0, 8)) {
      if (r.url && r.description && r.description.length > 15) {
        results.push({ title: r.title ?? '', snippet: r.description, url: r.url });
      }
    }
  } catch { /* continue */ }
  return results;
}

async function fetchPyPI(packageName: string, timeoutMs: number): Promise<RawSearchResult[]> {
  const results: RawSearchResult[] = [];
  try {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`, {
      headers: { 'User-Agent': 'VeggaAI/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return results;

    const data = await res.json() as {
      info?: {
        version?: string;
        summary?: string;
        home_page?: string | null;
        project_urls?: Record<string, string> | null;
      };
    };

    const version = data.info?.version?.trim();
    const summary = data.info?.summary?.trim() || `${packageName} package on PyPI.`;
    const projectPage = `https://pypi.org/project/${encodeURIComponent(packageName)}/`;

    results.push({
      title: version ? `${packageName} ${version}` : packageName,
      snippet: version
        ? `${packageName} version ${version} is the current release listed on PyPI, the official Python package index. PyPI describes ${packageName} as: ${summary}`
        : `${packageName} is listed on PyPI, the official Python package index. PyPI describes it as: ${summary}`,
      url: projectPage,
    });

    const supportUrls = [
      data.info?.home_page,
      ...Object.values(data.info?.project_urls ?? {}),
    ]
      .filter((value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value))
      .filter((value, index, values) => values.indexOf(value) === index)
      .filter((value) => !/pypi\.org/i.test(value))
      .slice(0, 2);

    for (const supportUrl of supportUrls) {
      results.push({
        title: `${packageName} project link`,
        snippet: summary,
        url: supportUrl,
      });
    }
  } catch { /* continue */ }

  return results;
}

/** SearXNG — self-hosted, unlimited, zero cost when running locally */
async function fetchSearXNG(query: string, baseUrl: string, timeoutMs: number): Promise<RawSearchResult[]> {
  const results: RawSearchResult[] = [];
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VeggaAI/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return results;
    const data = await res.json() as {
      results?: Array<{ title?: string; content?: string; url?: string }>;
    };
    for (const r of (data.results ?? []).slice(0, 8)) {
      if (r.url && r.content && r.content.length > 15) {
        results.push({ title: r.title ?? '', snippet: r.content, url: r.url });
      }
    }
  } catch { /* continue */ }
  return results;
}

// Module-level reddit rate-limit cooldown. When reddit returns 429 we back
// off site-wide for 60s so we stop burning per-request timeout budget.
let redditCooldownUntil = 0;

async function fetchDuckDuckGo(query: string, timeoutMs: number): Promise<RawSearchResult[]> {
  const results: RawSearchResult[] = [];
  const primarySubject = extractPrimarySubject(query, []);
  // Community/consumer/temporal markers — when present, Wikipedia REST tends
  // to return greedy generic articles ("Computer keyboard" for "best mech
  // switch"). We bias toward Wikipedia full-text + Reddit instead.
  const isCommunityQuery = /\b(best|top|popular|recommend(?:ed|ation)?|review|vs\.?|versus|worth|underrated|overrated|good for|alternative|cheap|budget|favourite|favorite|recommend\s+me|which\s+\w+\s+should)\b|\b20\d{2}\b|\bnow\b|\bcurrent(?:ly)?\b|\blatest\b|\btoday\b/i.test(query);

  // 1. DDG Instant Answer API — Wikipedia abstracts, direct answers, related topics
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(ddgUrl, {
      headers: { 'User-Agent': 'VeggaAI/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const data = await res.json() as {
        Abstract?: string; AbstractSource?: string; AbstractURL?: string;
        Answer?: string; AnswerType?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
        Results?: Array<{ Text?: string; FirstURL?: string }>;
        Infobox?: { content?: Array<{ data_type?: string; value?: string; label?: string }> };
      };

      if (data.Abstract && data.Abstract.length > 20) {
        results.push({
          title: data.AbstractSource ?? 'DuckDuckGo',
          snippet: data.Abstract,
          url: data.AbstractURL ?? `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        });
      }
      if (data.Answer && data.Answer.length > 5) {
        results.push({
          title: 'Instant Answer',
          snippet: data.Answer,
          url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        });
      }
      // Direct results (more targeted than RelatedTopics)
      if (data.Results) {
        for (const r of data.Results.slice(0, 3)) {
          if (r.Text && r.Text.length > 10 && r.FirstURL) {
            results.push({ title: '', snippet: r.Text, url: r.FirstURL });
          }
        }
      }
      // Related topics (flatten nested topics)
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, 8)) {
          if (topic.Text && topic.Text.length > 10 && topic.FirstURL) {
            results.push({ title: '', snippet: topic.Text, url: topic.FirstURL });
          }
          // Nested topic groups
          if (topic.Topics) {
            for (const sub of topic.Topics.slice(0, 3)) {
              if (sub.Text && sub.Text.length > 10 && sub.FirstURL) {
                results.push({ title: '', snippet: sub.Text, url: sub.FirstURL });
              }
            }
          }
        }
      }
    }
  } catch { /* continue to fallback */ }

  // 2. Wikipedia REST API — free, reliable, no key needed, high-quality summaries.
  // Skipped for community/consumer/temporal queries where REST returns greedy
  // generic articles (e.g. "Computer keyboard" for "best mech switch 2024").
  if (results.length < 3 && !isCommunityQuery) {
    try {
      const term = primarySubject.split(/\s+/).slice(0, 5).join(' ');
      const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
      const wikiRes = await fetch(wikiUrl, {
        headers: { 'User-Agent': 'VeggaAI/1.0 (local AI learning agent)' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json() as {
          extract?: string; title?: string; content_urls?: { desktop?: { page?: string } };
          description?: string; type?: string;
        };
        if (wikiData.extract && wikiData.extract.length > 50 && wikiData.type !== 'disambiguation') {
          results.push({
            title: wikiData.title ?? term,
            snippet: wikiData.extract.slice(0, 600),
            url: wikiData.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(term)}`,
          });
        }
      }
    } catch { /* no results */ }
  }

  // 2.2 Wikipedia full-text search — covers broad / community / entertainment
  // queries where the REST summary endpoint 404s. Returns matching article
  // titles with snippets so the synthesizer can cross-reference across them.
  // Free, no key, no rate-limit pain for occasional use.
  if (results.length < 3) {
    try {
      const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=6&srprop=snippet&format=json&origin=*`;
      const wsRes = await fetch(wikiSearchUrl, {
        headers: { 'User-Agent': 'VeggaAI/1.0 (local AI learning agent)' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (wsRes.ok) {
        const wsData = await wsRes.json() as {
          query?: { search?: Array<{ title?: string; snippet?: string }> };
        };
        for (const hit of (wsData.query?.search ?? []).slice(0, 6)) {
          if (!hit.title || !hit.snippet) continue;
          const cleanSnippet = hit.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
          if (cleanSnippet.length < 20) continue;
          // For community/consumer queries, skip wiki articles whose title
          // doesn't share at least one significant token with the query
          // (filters greedy generic matches like "Keyboard technology").
          if (isCommunityQuery) {
            const titleTokens = new Set(hit.title.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
            const queryTokens = (query.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
              .filter((t) => !['best', 'good', 'recommend', 'review', 'should', 'which', 'what', 'right', 'better', 'really', 'currently', 'latest', 'today'].includes(t));
            const overlap = queryTokens.some((t) => titleTokens.has(t));
            if (!overlap) continue;
          }
          results.push({
            title: hit.title,
            snippet: cleanSnippet,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/\s+/g, '_'))}`,
          });
        }
      }
    } catch { /* continue */ }
  }

  // 2.3 Reddit JSON search — keyless, surfaces real community discussion that
  // Wikipedia + DDG miss (creators, fandoms, niche communities, current
  // events). Free, no auth, rate-limited but fine for ad-hoc use.
  // ALWAYS runs (not gated): Wikipedia + DDG together easily exceed 4 results
  // for generic queries and starve out high-signal community evidence. We need
  // reddit for opinion / recommendation / niche-entity queries even when wiki
  // returned plenty of (often irrelevant) hits.
  // Run reddit when wiki/DDG returned thin OR when query has community/consumer
  // markers (recommendations, comparisons, current-events). Gating this keeps
  // concurrent fetch counts bounded under rapid back-to-back chat traffic.
  // Skip reddit entirely for ~60s after a 429 — saves budget for other providers.
  if (Date.now() < redditCooldownUntil) {
    // suppressed by cooldown
  } else if (results.length < 4 || isCommunityQuery) {
    try {
      // Strip trailing "reddit" from the query before sending to reddit search
      // — reddit treats it as a topic word and wastes hit slots matching it
      // inside titles. We also tried appending recommendation intent terms
      // here, but reddit's relevance ranker degraded with extra synonyms;
      // the drama filter + anchor re-ranking below proved more effective.
      const _qForReddit = query.replace(/\breddit\b/gi, '').trim();
      const redditUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(_qForReddit)}&limit=8&sort=relevance&t=year`;
      const rRes = await fetch(redditUrl, {
        headers: { 'User-Agent': 'VeggaAI/1.0 (local AI learning agent)' },
        signal: AbortSignal.timeout(Math.min(timeoutMs, 2500)),
      });
      if (rRes.status === 429) {
        redditCooldownUntil = Date.now() + 60_000;
      } else if (rRes.ok) {
        const rData = await rRes.json() as {
          data?: { children?: Array<{ data?: {
            title?: string; selftext?: string; subreddit?: string;
            permalink?: string; score?: number; num_comments?: number;
          } }> };
        };
        // First pass: collect candidates so we can pick the top few to enrich
        // with full post bodies + top comments. Reddit search returns titles
        // and partial selftext only — for a question like "who is X" the title
        // alone rarely names X; the actual answer is inside the post body or
        // the top reply.
        type RedditHit = {
          title: string;
          subreddit: string;
          permalink: string;
          selftext: string;
          score: number;
          numComments: number;
        };
        const hits: RedditHit[] = [];
        for (const child of (rData.data?.children ?? []).slice(0, 8)) {
          const d = child.data;
          if (!d?.title || !d.permalink) continue;
          if ((d.score ?? 0) < 5 && (d.num_comments ?? 0) < 3) continue;
          hits.push({
            title: d.title,
            subreddit: d.subreddit ?? 'reddit',
            permalink: d.permalink,
            selftext: (d.selftext ?? '').replace(/\s+/g, ' ').trim(),
            score: d.score ?? 0,
            numComments: d.num_comments ?? 0,
          });
        }

        // ── Reco-aware filtering + ranking ────────────────────────────────
        // When the query has recommendation markers (best/recommend/review/vs),
        // drop AIO/AITA/relationship/drama threads — they pollute reco results
        // with off-topic high-engagement personal posts that share a noun with
        // the query (e.g. "destroyed my $2,000 gaming setup" on a keyboard ask).
        // Then re-rank by query-anchor overlap in title so the most topically
        // relevant thread becomes the lead candidate.
        const _isRecoLike = /\b(?:best|top|recommend|review|favorite|favourite|worth|underrated|overrated|vs\.?|versus|alternative|cheap|budget|good\s+for|which\s+\w+\s+should)\b/i.test(query);
        if (_isRecoLike && hits.length > 0) {
          const _dramaRe = /\b(?:aio|aita|am\s+i\s+the|wibta|relationship|girlfriend|boyfriend|husband|wife|toddler|baby[-\s]?proof|sister|brother|family|drama|court|sue|cheating|breakup|divorce|destroyed|trauma|venting)\b/i;
          const _qTokens = (query.toLowerCase().match(/[a-z][a-z0-9'\-]{3,}/g) ?? [])
            .filter((t) => !['best','top','what','which','reddit','recommend','review','from','with','this','that','about','should','good','some'].includes(t));
          const _qTokSet = new Set(_qTokens);
          const _ranked = hits
            .filter((h) => !_dramaRe.test(h.title))
            .map((h) => {
              const _tlow = h.title.toLowerCase();
              let _overlap = 0;
              for (const t of _qTokSet) if (_tlow.includes(t)) _overlap++;
              const _engagement = Math.log1p(h.score + h.numComments);
              return { h, _score: _overlap * 5 + _engagement };
            })
            .sort((a, b) => b._score - a._score)
            .map((r) => r.h);
          // If filter wiped everything, fall back to original hits (better
          // something than nothing) but at least re-rank by anchor overlap.
          if (_ranked.length > 0) {
            hits.length = 0;
            hits.push(..._ranked);
          } else {
            const _byOverlap = hits
              .map((h) => {
                const _tlow = h.title.toLowerCase();
                let _overlap = 0;
                for (const t of _qTokSet) if (_tlow.includes(t)) _overlap++;
                return { h, _score: _overlap };
              })
              .sort((a, b) => b._score - a._score)
              .map((r) => r.h);
            hits.length = 0;
            hits.push(..._byOverlap);
          }
        }
        // ──────────────────────────────────────────────────────────────────

        // Enrich top 2 by score+comments with full body + a couple top comments.
        // Hard-capped at 1500ms total so it never blows the chat search budget.
        const enrichTargets = [...hits]
          .sort((a, b) => (b.score + b.numComments) - (a.score + a.numComments))
          .slice(0, 2);
        const enriched = new Map<string, string>();
        const enrichmentWork = Promise.all(enrichTargets.map(async (hit) => {
          try {
            const detailUrl = `https://www.reddit.com${hit.permalink}.json?limit=8&depth=1`;
            const dRes = await fetch(detailUrl, {
              headers: { 'User-Agent': 'VeggaAI/1.0 (local AI learning agent)' },
              signal: AbortSignal.timeout(1500),
            });
            if (!dRes.ok) return;
            // Reddit returns [postListing, commentListing]
            const dData = await dRes.json() as Array<{
              data?: { children?: Array<{ data?: {
                selftext?: string; body?: string; score?: number;
              } }> };
            }>;
            const postSelftext = (dData[0]?.data?.children?.[0]?.data?.selftext ?? '')
              .replace(/\s+/g, ' ')
              .trim();
            const commentChildren = dData[1]?.data?.children ?? [];
            const topComments = commentChildren
              .map((c) => c.data)
              .filter((c): c is { body: string; score: number } =>
                !!c && typeof c.body === 'string' && c.body.trim().length > 0)
              .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
              .slice(0, 3)
              .map((c) => c.body.replace(/\s+/g, ' ').trim());
            const parts: string[] = [];
            const useSelftext = postSelftext.length > hit.selftext.length ? postSelftext : hit.selftext;
            // Cap selftext so "Top reply:" always survives the 600-char snippet slice downstream.
            if (useSelftext) parts.push(useSelftext.slice(0, 220));
            for (const c of topComments) parts.push(`Top reply: ${c.slice(0, 180)}`);
            const combined = parts.join(' · ');
            if (combined.length > 0) enriched.set(hit.permalink, combined.slice(0, 1500));
          } catch { /* per-hit enrichment is best-effort */ }
        }));
        // Hard cap so a slow reddit detail fetch can't blow the chat search budget.
        await Promise.race([
          enrichmentWork,
          new Promise((r) => setTimeout(r, 1800)),
        ]);
        for (const hit of hits) {
          const body = enriched.get(hit.permalink) ?? hit.selftext;
          const snippet = body.length > 30
            ? `[r/${hit.subreddit}] ${body.slice(0, 600)}`
            : `[r/${hit.subreddit}] ${hit.title}`;
          results.push({
            title: hit.title,
            snippet,
            url: `https://www.reddit.com${hit.permalink}`,
          });
        }
      }
    } catch { /* continue */ }
  }

  // R14: Reddit-via-DDG fallback. When the community/reco intent is clear but
  // direct reddit search returned nothing (cooldown, rate-limit, or empty
  // result set), search DDG-lite with `site:reddit.com` appended. This often
  // recovers exactly the threads that would have answered the question and
  // closes the long-standing community-rec score=15 gap.
  if (isCommunityQuery) {
    const hasRedditHit = results.some((r) => /reddit\.com/i.test(r.url));
    if (!hasRedditHit) {
      try {
        const _qNoReddit = query.replace(/\breddit\b/gi, '').trim();
        const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(`${_qNoReddit} site:reddit.com`)}`;
        const res = await fetch(liteUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VeggaAI/1.0)' },
          signal: AbortSignal.timeout(Math.min(timeoutMs, 2500)),
        });
        if (res.ok) {
          const html = await res.text();
          const linkRe = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
          const snippetRe = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
          const links: Array<{ url: string; title: string }> = [];
          const snippets: string[] = [];
          let m: RegExpExecArray | null;
          while ((m = linkRe.exec(html)) !== null && links.length < 6) {
            links.push({ url: m[1], title: m[2].trim() });
          }
          while ((m = snippetRe.exec(html)) !== null && snippets.length < 6) {
            snippets.push(m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
          }
          let added = 0;
          for (let i = 0; i < Math.min(links.length, snippets.length); i++) {
            const url = links[i].url;
            if (!/reddit\.com/i.test(url)) continue;
            if (snippets[i].length < 30) continue;
            const sub = url.match(/reddit\.com\/r\/([A-Za-z0-9_]+)/i)?.[1] ?? 'reddit';
            results.push({
              title: links[i].title,
              snippet: `[r/${sub}] ${snippets[i]}`,
              url,
            });
            added++;
            if (added >= 3) break;
          }
        }
      } catch { /* fallback is best-effort */ }
    }
  }

  // R15: HackerNews via Algolia (keyless, generous rate limit). HN discussions
  // are gold for dev-tool / tech-gear / startup / hardware queries — often
  // more current than wikipedia and complements reddit. Runs whenever the
  // query has community/recommendation shape (where wiki dominance hurts) or
  // when results are thin.
  if ((isCommunityQuery || results.length < 5) && primarySubject.length > 1) {
    try {
      const hnQuery = query.replace(/\b(?:hn|hacker\s*news|reddit)\b/gi, '').trim();
      const hnUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(hnQuery)}&tags=story&hitsPerPage=5`;
      const hnRes = await fetch(hnUrl, {
        headers: { 'User-Agent': 'VeggaAI/1.0' },
        signal: AbortSignal.timeout(Math.min(timeoutMs, 2500)),
      });
      if (hnRes.ok) {
        const hnData = await hnRes.json() as {
          hits?: Array<{
            title?: string;
            url?: string;
            story_text?: string;
            objectID?: string;
            points?: number;
            num_comments?: number;
          }>;
        };
        let added = 0;
        for (const hit of hnData.hits ?? []) {
          if (!hit.title) continue;
          if ((hit.points ?? 0) < 5 && (hit.num_comments ?? 0) < 3) continue;
          const url = hit.url && /^https?:\/\//i.test(hit.url)
            ? hit.url
            : `https://news.ycombinator.com/item?id=${hit.objectID}`;
          const snippet = (hit.story_text && hit.story_text.length > 30)
            ? `[HN · ${hit.points ?? 0}pts/${hit.num_comments ?? 0}c] ${hit.title}: ${hit.story_text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400)}`
            : `[HN · ${hit.points ?? 0}pts/${hit.num_comments ?? 0}c] ${hit.title}`;
          results.push({ title: hit.title, snippet, url });
          added++;
          if (added >= 3) break;
        }
      }
    } catch { /* HN best-effort */ }
  }

  // 2.5 GitHub repository search — good zero-key fallback for developer tools
  if (results.length < 3 && primarySubject.length > 1) {
    try {
      const ghUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(primarySubject)}&per_page=5`;
      const ghRes = await fetch(ghUrl, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'VeggaAI/1.0',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (ghRes.ok) {
        const ghData = await ghRes.json() as {
          items?: Array<{ full_name?: string; description?: string; html_url?: string; homepage?: string | null }>;
        };
        for (const repo of (ghData.items ?? []).slice(0, 3)) {
          if (!repo.html_url || !repo.description || repo.description.length < 10) continue;
          results.push({
            title: repo.full_name ?? primarySubject,
            snippet: repo.description,
            url: repo.homepage && /^https?:\/\//i.test(repo.homepage) ? repo.homepage : repo.html_url,
          });
        }
      }
    } catch { /* continue */ }
  }

  // 3. DDG lite HTML scrape — last resort, more stable than full DDG HTML
  if (results.length < 2) {
    try {
      const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
      const res = await fetch(liteUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VeggaAI/1.0)' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const html = await res.text();
        // DDG lite has a simpler structure: <a class="result-link"> and <td class="result-snippet">
        const linkRe = /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
        const snippetRe = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
        const links: Array<{ url: string; title: string }> = [];
        const snippets: string[] = [];
        let m;
        while ((m = linkRe.exec(html)) !== null && links.length < 6) {
          links.push({ url: m[1], title: m[2].trim() });
        }
        while ((m = snippetRe.exec(html)) !== null && snippets.length < 6) {
          snippets.push(m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
        }
        for (let i = 0; i < Math.min(links.length, snippets.length); i++) {
          if (snippets[i].length > 20) {
            results.push({ title: links[i].title, snippet: snippets[i], url: links[i].url });
          }
        }
      }
    } catch { /* no results */ }
  }

  return results;
}

async function fetchProviderChain(query: string, config: SearchPipelineConfig, packageHints: readonly string[] = []): Promise<RawSearchResult[]> {
  const providers: Array<() => Promise<RawSearchResult[]>> = [];
  const pypiPackage = extractPyPIPackageName(query, packageHints);

  if (isFreshLocalBusinessContactRequest(query)) {
    providers.push(() => fetchOpenStreetMapBusinessContact(query, config.fetchTimeoutMs));
  }

  if (isFreshLocalRecommendationRequest(query)) {
    providers.push(() => fetchOpenStreetMapLocalRecommendation(query, config.fetchTimeoutMs));
  }

  if (pypiPackage) {
    providers.push(() => fetchPyPI(pypiPackage, config.fetchTimeoutMs));
  }

  if (config.searxngUrl) {
    providers.push(() => fetchSearXNG(query, config.searxngUrl as string, config.fetchTimeoutMs));
  }
  if (config.braveApiKey) {
    providers.push(() => fetchBrave(query, config.braveApiKey as string, config.fetchTimeoutMs));
  }
  providers.push(() => fetchDuckDuckGo(query, config.fetchTimeoutMs));

  const merged: RawSearchResult[] = [];
  const seen = new Set<string>();
  const minUsefulResults = Math.max(3, config.resultsPerQuery);

  for (const provider of providers) {
    const batch = await provider().catch(() => [] as RawSearchResult[]);
    for (const result of batch) {
      const dedupeKey = `${result.url}::${result.title}`.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      merged.push(result);
    }
    if (merged.length >= minUsefulResults) break;
  }

  return merged;
}

// ── Ranking (Step 4: RANK) ──

function rankSnippets(
  rawResults: Array<RawSearchResult & { queryIndex: number }>,
  minTrust: number,
  query: string,
): SearchSnippet[] {
  const seen = new Set<string>();
  const scored: Array<SearchSnippet & { familyKey: string | null; wrapperLike: boolean; mathLike: boolean }> = [];
  const primarySubject = extractPrimarySubject(query, []);
  const biasPerplexityProduct = shouldBiasPerplexityToProduct(query, primarySubject);
  const dropCodeHosting = isHeadOfStateQuery(query);
  const hasOfficialPerplexityResult = biasPerplexityProduct
    && rawResults.some((raw) => isPerplexityOfficialResult(raw) && !isPerplexityUnofficialResult(raw));

  // R17: for opinion-shaped queries (best/top/recommend/vs/worth/etc),
  // give forum domains a rank multiplier so wiki doesn't drown them out of
  // top-N. Without this, "best mechanical keyboard switch for typing" returns
  // 6 wiki sources and the Vai-voice forum synth never fires.
  const _isOpinionShape = /\b(?:best|top|recommend|worth|underrated|overrated|favorite|favourite|prefer|hate|love|why\s+do(?:es)?\s+(?:people|users|gamers|players|folks|everyone|anyone)|opinion|sentiment|thoughts?\s+on|vs\.?|versus|alternative|cheap|budget|good\s+for|reddit)\b/i.test(query);
  const _forumHostRe = /(?:^|\.)(reddit\.com|news\.ycombinator\.com|stackoverflow\.com|stackexchange\.com|discourse\.org|forum\.|community\.|lemmy\.|tildes\.net|metafilter\.com)/i;

  for (const raw of rawResults) {
    // URL safety check
    let domain: string;
    try {
      const url = validateSearchUrl(raw.url);
      domain = url.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      continue; // skip unsafe URLs
    }

    // Drop code-hosting results when the query is asking about a real-world
    // person (head of state). Prevents leaks like `flike/kingshard` for
    // "who is the king of norway".
    if (dropCodeHosting && isCodeHostingDomain(domain)) continue;

    // Content safety
    const safety = scanContentSafety(raw.snippet);
    if (!safety.safe) continue;

    // Dedup by content fingerprint
    const fp = contentFingerprint(raw.snippet);
    if (seen.has(fp)) continue;
    seen.add(fp);

    // Trust scoring
    const trust = scoreDomain(domain);
    if (trust.score < minTrust) continue;

    // Relevance boost: earlier queries and earlier results rank higher
    const positionBoost = 1 / (1 + raw.queryIndex * 0.3);
    let rank = trust.score * positionBoost;
    // R17: opinion-query forum boost. Lifts reddit (0.6) above wiki (0.9)
    // for recommendation queries so community sentiment survives ranking.
    if (_isOpinionShape && _forumHostRe.test(domain)) {
      rank *= 1.9;
    }
    const wrapperLike = biasPerplexityProduct && isPerplexityWrapperLikeResult(raw);
    const mathLike = biasPerplexityProduct && isPerplexityMathResult(raw);
    const officialDocsLike = biasPerplexityProduct && !wrapperLike && isPerplexityOfficialDocsResult(raw);
    const officialLike = biasPerplexityProduct && !wrapperLike && isPerplexityOfficialResult(raw);
    const familyKey = officialLike ? 'perplexity:official' : null;

    if (biasPerplexityProduct) {
      if (officialDocsLike) rank *= 3.1;
      else if (officialLike) rank *= 2.45;
      else if (isPerplexityProductResult(raw)) rank *= 1.45;
      if (wrapperLike) rank *= hasOfficialPerplexityResult ? 0.04 : 0.16;
      if (mathLike) rank *= hasOfficialPerplexityResult ? 0.08 : 0.18;
    }

    scored.push({
      text: raw.snippet.slice(0, 500),
      url: raw.url,
      domain,
      title: raw.title,
      favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`,
      trust,
      rank,
      familyKey,
      wrapperLike,
      mathLike,
    });
  }

  // Sort by combined rank descending
  scored.sort((a, b) => b.rank - a.rank);

  if (!biasPerplexityProduct) {
    return scored.map(({ familyKey: _familyKey, wrapperLike: _wrapperLike, mathLike: _mathLike, ...snippet }) => snippet);
  }

  const countedFamilies = new Set<string>();
  let distinctHighSignalCount = 0;
  for (const candidate of scored) {
    if (candidate.wrapperLike || candidate.mathLike) continue;
    const dedupeKey = candidate.familyKey ?? `${candidate.domain}::${candidate.title}`;
    if (countedFamilies.has(dedupeKey)) continue;
    countedFamilies.add(dedupeKey);
    distinctHighSignalCount += 1;
  }

  const filtered: typeof scored = [];
  const seenFamilies = new Set<string>();
  let wrapperAllowance = distinctHighSignalCount >= 2 ? 0 : 1;

  for (const candidate of scored) {
    const dedupeKey = candidate.familyKey;
    if (dedupeKey && seenFamilies.has(dedupeKey)) continue;

    if ((candidate.wrapperLike || candidate.mathLike) && wrapperAllowance <= 0) continue;

    if (dedupeKey) seenFamilies.add(dedupeKey);
    if (candidate.wrapperLike || candidate.mathLike) {
      wrapperAllowance -= 1;
    }

    filtered.push(candidate);
  }

  return filtered.map(({ familyKey: _familyKey, wrapperLike: _wrapperLike, mathLike: _mathLike, ...snippet }) => snippet);
}

// ── Cross-Check (Step 5: verify claims across sources) ──

function crossCheck(snippets: readonly SearchSnippet[]): readonly SearchSnippet[] {
  if (snippets.length <= 1) return snippets;

  // Extract key phrases from each snippet, boost those that appear in multiple sources
  const phraseCount = new Map<string, number>();
  for (const s of snippets) {
    // Extract 3-word phrases
    const words = s.text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const phrases = new Set<string>();
    for (let i = 0; i < words.length - 2; i++) {
      phrases.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
    for (const p of phrases) {
      phraseCount.set(p, (phraseCount.get(p) ?? 0) + 1);
    }
  }

  // Find phrases corroborated by 2+ sources
  const corroborated = new Set<string>();
  for (const [phrase, count] of phraseCount) {
    if (count >= 2) corroborated.add(phrase);
  }

  // Re-rank: boost snippets that contain corroborated phrases
  return snippets.map(s => {
    const words = s.text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    let boost = 0;
    for (let i = 0; i < words.length - 2; i++) {
      if (corroborated.has(`${words[i]} ${words[i + 1]} ${words[i + 2]}`)) boost++;
    }
    const boostFactor = 1 + Math.min(boost, 5) * 0.1;
    return { ...s, rank: s.rank * boostFactor };
  }).sort((a, b) => b.rank - a.rank);
}

// ── Synthesis (Step 6: CONCLUDE) ──

/**
 * Compute confidence score (0-1) based on source count,
 * trust tier distribution, and cross-check survival rate.
 */
function computeConfidence(snippets: readonly SearchSnippet[]): number {
  if (snippets.length === 0) return 0;

  // Factor 1: source count (diminishing returns, caps at ~6 sources)
  const countScore = Math.min(snippets.length / 6, 1);

  // Factor 2: average trust score of sources
  const avgTrust = snippets.reduce((sum, s) => sum + s.trust.score, 0) / snippets.length;

  // Factor 3: presence of high-trust sources (bonus)
  const highTrustCount = snippets.filter(s => s.trust.tier === 'high').length;
  const highBonus = Math.min(highTrustCount / 2, 1) * 0.15;

  // Factor 4: domain diversity (more diverse = more confident)
  const uniqueDomains = new Set(snippets.map(s => s.domain)).size;
  const diversityScore = Math.min(uniqueDomains / 3, 1);

  // Weighted combination
  const raw = (countScore * 0.25) + (avgTrust * 0.35) + (diversityScore * 0.25) + highBonus;
  return Math.min(Math.max(raw, 0), 1);
}

const NOISY_SENTENCE_PATTERN = /\b(?:notifications|fork\b|star\b|copy pip instructions|released:|go to file|open more actions menu|public\s+notifications|reading web response|quick start|inputs:|tools\s+searxng_web_search|mcp protocol|npm install|command\s*:|args\s*:|env\s*:|history\s+\d+\s+commits)\b|[│▼▲]/i;

const COMPARISON_REASON_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  {
    pattern: /\b(?:privacy|privacy-respecting|neither tracked nor profiled|not tracked|not profiled|without tracking)\b/i,
    label: 'privacy without tracking or profiling',
  },
  {
    pattern: /\b(?:metasearch|aggregates? results? from (?:multiple|various)|multiple search (?:services|providers|engines))\b/i,
    label: 'aggregation across multiple search providers',
  },
  {
    pattern: /\b(?:self-host|self host|self-hosted|self hosted|customizable|customisable)\b/i,
    label: 'self-hosting and workflow control',
  },
  {
    pattern: /\b(?:developer|tooling|integration|api|workflow)\b/i,
    label: 'adaptability for developer tooling and custom search workflows',
  },
  {
    pattern: /\b(?:web results|broader results|multiple sources|search services)\b/i,
    label: 'broader web search instead of an instant-answer-only flow',
  },
];

function sanitizeSnippetText(text: string): string {
  return text
    .replace(/&#\d+;?/g, ' ')
    .replace(/&nbsp;|&quot;|&amp;|&lt;|&gt;/g, ' ')
    .replace(/\[\s*edit\s*\]/gi, ' ')
    .replace(/\b\d+\s+[A-Z][a-z]+\s+\[\s*edit\s*\]\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/**
 * Final render-time pass over a sentence destined for the answer body.
 * Strips reddit/forum chrome that survived sanitizeSnippetText so the lead
 * reads as a clean statement rather than "[r/sub] **UPDATE:** I decided…".
 * Applied only at the point of emission — not used for ranking/scoring so
 * the chrome can still influence trust-tier and relevance upstream.
 */
function cleanLeadText(text: string): string {
  let cleaned = text;
  // Strip leading "[r/subreddit] " / "[r/sub] · " forum tags.
  cleaned = cleaned.replace(/^\s*\[r\/[^\]]+\][\s\u00b7·:,-]*/i, '');
  // Strip leading "**UPDATE:**", "EDIT:", "TL;DR:", "Top reply:" announcement labels.
  cleaned = cleaned.replace(/^\s*(?:\*\*)?\s*(?:UPDATE|EDIT|TL;?DR|TLDR|Top reply|Top comment|UPDATED?|FINAL|ANSWER|SOLVED)\s*[:\-]\s*(?:\*\*)?\s*/i, '');
  // Strip a leading bold title-link block like "**Sony WH-1000XM6**" followed by space.
  cleaned = cleaned.replace(/^\s*\*\*[^*]{2,80}\*\*\s+/, '$&').replace(/^\s+/, '');
  // Collapse stray markdown link wrappers around the first phrase so "[**X**](url)" → "**X**".
  cleaned = cleaned.replace(/\[(\*\*[^*]+\*\*)\s*\]\((?:https?:\/\/)?[^)]+\)/g, '$1');
  // Drop trailing " · Top reply: ..." appendage if it's just chat-style follow-on noise.
  cleaned = cleaned.replace(/\s*[·\u00b7]\s*Top\s+reply\s*:\s*.*$/i, '').trim();
  // Collapse double spaces created by stripping.
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  // Repair a common snippet-boundary fragment: a clipped copula before
  // "the ..." should render as a direct statement, not a lowercase clause.
  cleaned = cleaned.replace(/^(?:is|are|was|were)\s+the\s+/i, 'The ');
  cleaned = cleaned.replace(/^([a-z])/, (letter) => letter.toUpperCase());
  return cleaned;
}

function looksLikePromotionalCopy(text: string): boolean {
  const signals = [
    /\bstart for free\b/i,
    /\bget started\b/i,
    /\bfastest path\b/i,
    /\bself-serve\b/i,
    /\blaunch and manage\b/i,
    /\bwithout the complexity\b/i,
    /\bcontact sales\b/i,
    /\bbook a demo\b/i,
  ];
  return signals.filter((pattern) => pattern.test(text)).length >= 2;
}

function looksLikeWeakStandaloneLead(text: string): boolean {
  return /^(?:however|but|and|so|also|instead|meanwhile|therefore|thus|first of all|in turn|of)\b[\s,:-]*/i.test(text.trim())
    || /^(?:it|this|that|they|these|those)\b/i.test(text.trim())
    || looksLikePromotionalCopy(text);
}

function looksLikeNoisyUiSentence(sentence: string): boolean {
  if (NOISY_SENTENCE_PATTERN.test(sentence)) return true;
  if (/^from wikipedia, the free encyclopedia\b/i.test(sentence)) return true;
  if (/^this article is about\b/i.test(sentence)) return true;
  if (/\bfor other uses, see\b/i.test(sentence)) return true;
  if (/\bdisambiguation\b/i.test(sentence) && sentence.length < 220) return true;
  if (/\binterval of 1\s+\d{3}(?:\s+\d{3})+\s+seconds?\b/i.test(sentence)) return true;
  if (looksLikePromotionalCopy(sentence)) return true;
  const compact = sentence.replace(/\s+/g, '');
  const punctuationCount = (compact.match(/[^a-zA-Z0-9]/g) ?? []).length;
  return compact.length > 0 && (punctuationCount / compact.length) > 0.22;
}

/**
 * Detects sentences that are actually infobox / table-of-fields fragments
 * masquerading as prose because the period-splitter let an `Inc.` /
 * `Corp.` boundary fall through and stitched a section header onto the
 * next chunk. Symptoms: high ratio of capitalized title-case words, no
 * main explanatory verb, often opens with a year-paren (`"2026)"`) or a
 * footnotes-ref (`"Footnotes / references"`), or contains canonical
 * infobox field labels (`Subsidiaries`, `Founders`, `Headquarters`,
 * `Key people`, `Area served`, `Number of employees`, `Website`).
 * Iter-14 fix.
 */
function looksLikeInfoboxFragment(sentence: string): boolean {
  // Canonical infobox labels — single-word presence is enough.
  if (/\b(?:Subsidiaries|Founders?|Headquarters|Area served|Number of employees|Trade name|Company type|Key people|Industry|Predecessor|Operating income|Net income|Total assets|Total equity|Stockholders'? equity|Footnotes \/ references|Bret Taylor \( chairman \)|isin|ISIN)\b/.test(sentence)) {
    return true;
  }
  // Opens with a year-close-paren (infobox table fragment leftover).
  if (/^\d{4}\s*\)/.test(sentence.trim())) return true;
  // Opens with `1 ` or `2 ` followed by a capitalized phrase ending with `Inc.`/`Corp.`/`Ltd.`
  // (footnotes-style stub).
  if (/^\d+\s+[A-Z][\w&\s,'-]{3,}\s+(?:Inc|Corp|Ltd|LLC|Co)\.\s*$/.test(sentence.trim())) return true;
  // High title-case ratio with no explanatory verb is an infobox row.
  const words = sentence.split(/\s+/).filter((w) => w.length > 0);
  if (words.length >= 4 && !hasExplanatoryVerb(sentence)) {
    const titleCaseCount = words.filter((w) => /^[A-Z][a-z0-9]+$/.test(w) || /^[A-Z]{2,}$/.test(w)).length;
    if (titleCaseCount / words.length >= 0.55) return true;
  }
  return false;
}

function hasExplanatoryVerb(sentence: string): boolean {
  return /\b(?:is|are|was|were|supports|queries|aggregates?|functions?|removes|stores|gives|uses|works|returns|provides|avoids|focuses)\b/i.test(sentence);
}

/**
 * Common abbreviations whose trailing period must NOT be treated as a
 * sentence boundary. Without this, `"Perplexity AI, Inc. is an AI search
 * engine ..."` gets split into `"Perplexity AI, Inc."` (13 chars,
 * dropped by the ≥40 filter) plus `"is an AI search engine ..."`
 * (subject-less stub). Same for `Alphabet Inc.`, `Microsoft Corp.`,
 * `J.R.R. Tolkien`, `e.g.`, `vs.`, etc. Iter-14 fix for the dormant
 * defect observed in iter-9.
 */
const SENTENCE_SPLIT_NON_TERMINAL_ABBREVIATIONS: readonly string[] = [
  'Inc', 'Corp', 'Co', 'Ltd', 'LLC', 'PLC', 'GmbH', 'S.A',
  'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr',
  'St', 'Mt', 'Ave', 'Blvd', 'Rd',
  'vs', 'etc', 'e.g', 'i.e', 'cf', 'al',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
];

function splitIntoSentences(text: string): string[] {
  // Protect non-terminal abbreviations: replace `Inc.` → `Inc\u0001` so
  // the period doesn't match the splitter, then restore after split.
  const sanitized = sanitizeSnippetText(text);
  let protectedText = sanitized;
  for (const abbr of SENTENCE_SPLIT_NON_TERMINAL_ABBREVIATIONS) {
    // Match the abbreviation followed by `.` and a space + lowercase
    // OR end-of-string. Capital-letter-followed cases (a real new
    // sentence) keep the period as terminal.
    const re = new RegExp(`\\b(${abbr.replace(/\./g, '\\.')})\\.(?=\\s+[a-z]|\\s*$|,|\\s+\\()`, 'g');
    protectedText = protectedText.replace(re, '$1\u0001');
  }
  // Also protect single-letter initials: `J. R. R. Tolkien`, `T. S. Eliot`.
  protectedText = protectedText.replace(/\b([A-Z])\.(?=\s*[A-Z]\.)/g, '$1\u0001');
  protectedText = protectedText.replace(/\b([A-Z])\.(?=\s+[A-Z][a-z])/g, '$1\u0001');

  return protectedText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\u0001/g, '.').trim().replace(/^\d+\s+/, ''))
    .filter((sentence) => sentence.length >= 40 && sentence.length <= 320)
    .filter((sentence) => !looksLikeNoisyUiSentence(sentence))
    .filter((sentence) => !looksLikeInfoboxFragment(sentence));
}

function sentenceScore(sentence: string, query: string, plan: VaiSearchPlan, primarySubject: string, comparisonSubject: string | null): number {
  const lower = sentence.toLowerCase();
  let score = 0;
  const biasPerplexityToProduct = shouldBiasPerplexityToProduct(query, primarySubject);

  if (primarySubject.length > 0 && lower.includes(primarySubject.toLowerCase())) score += 4;
  if (comparisonSubject && lower.includes(comparisonSubject.toLowerCase())) score += 3;
  if (lower.includes(plan.intent)) score += 1;

  for (const entity of plan.entities.slice(0, 6)) {
    if (entity.length > 2 && lower.includes(entity.toLowerCase())) score += 1;
  }

  if (plan.intent === 'comparison') {
    if (/\b(?:privacy|metasearch|aggregate|self-host|results|providers|instant|api)\b/i.test(sentence)) score += 3;
  }

  if (plan.intent === 'definition' && /\b(?:is|are|refers to|describes|explained)\b/i.test(sentence)) score += 2;
  if (biasPerplexityToProduct) {
    if (isPerplexityProductSentence(sentence)) score += 6;
    if (isPerplexityMathSentence(sentence)) score -= 7;
  }
  if (/\b(?:github|pypi|npm|fork|star|released)\b/i.test(sentence)) score -= 3;
  if (sentence.toLowerCase() === query.toLowerCase()) score -= 10;

  return score;
}

function collectCitationMarks(indices: readonly number[]): string {
  const unique = [...new Set(indices.filter((index) => index >= 0))].sort((a, b) => a - b);
  return unique.map((index) => `[${index + 1}]`).join('');
}

/**
 * Cross-source consensus: returns the indices of OTHER sources whose text
 * shares ≥`minShared` distinctive content words with `text`. Used to attach
 * multi-source citations to a synthesized claim — turning "one source said X"
 * into "sources [1][2][3] independently confirm X".
 *
 * `minShared=3` keeps incidental keyword overlaps from spuriously claiming
 * agreement. Stopwords are already excluded by extractContentWords.
 *
 * Also detects contradictions: returns sources where the same key terms
 * appear inside a negation context (not/no/never/without/cannot/avoid).
 */
function findCrossSourceAgreement(
  text: string,
  used: readonly SearchSnippet[],
  excludeIdx: number,
  minShared = 3,
  queryAnchors: ReadonlySet<string> | null = null,
): { confirming: number[]; contradicting: number[] } {
  const tokens = extractContentWords(text);
  if (tokens.size < minShared) return { confirming: [], contradicting: [] };
  // Pick the 3 most distinctive (longest) tokens as the "topic anchors" we
  // require co-occurrence on — prevents short common words from inflating overlap.
  const anchors = [...tokens]
    .filter((w) => w.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);
  if (anchors.length < Math.min(minShared, 2)) return { confirming: [], contradicting: [] };

  // Query-relevance gate: when the caller supplied the query's distinctive
  // tokens, require that AT LEAST ONE anchor also appears in the query. This
  // prevents claiming "agreement" on generic words shared by off-topic
  // snippets (e.g. all sources mention "keyboard" but none answer the
  // "best mechanical switch for typing" question).
  if (queryAnchors && queryAnchors.size > 0) {
    const hasQueryAnchor = anchors.some((a) => queryAnchors.has(a));
    if (!hasQueryAnchor) return { confirming: [], contradicting: [] };
  }

  const confirming: number[] = [];
  const contradicting: number[] = [];
  for (let i = 0; i < used.length; i++) {
    if (i === excludeIdx) continue;
    const otherLower = used[i].text.toLowerCase();
    let shared = 0;
    for (const a of anchors) if (otherLower.includes(a)) shared++;
    if (shared < minShared) continue;
    // Contradiction sniff: if the other source frames the same anchors with
    // explicit negation, count as contradicting rather than confirming.
    const negated = anchors.some((a) => {
      const idx = otherLower.indexOf(a);
      if (idx === -1) return false;
      const window = otherLower.slice(Math.max(0, idx - 40), idx);
      return /\b(?:not|no|never|n['\u2019]t|without|cannot|can't|avoid|isn't|aren't|doesn't|don't|wasn't|weren't)\b/.test(window);
    });
    if (negated) contradicting.push(i);
    else confirming.push(i);
  }
  return { confirming, contradicting };
}

/**
 * Distinctive content tokens extracted from a raw user query — lowercased,
 * stopwords removed, length ≥ 4. Used as a relevance gate by
 * findCrossSourceAgreement so claims of "agreement" actually relate to the
 * question instead of generic shared vocabulary.
 */
function extractQueryAnchors(query: string): Set<string> {
  const stop = new Set([
    'best','top','reddit','what','which','where','when','why','how','about',
    'good','bad','vs','versus','compare','recommend','give','tell','please',
    'for','from','with','this','that','these','those','some','more','most',
    'they','them','their','have','has','had','was','were','are','being','been',
  ]);
  const out = new Set<string>();
  const tokens = (query.toLowerCase().match(/[a-z][a-z0-9'\-]{3,}/g) ?? []);
  for (const t of tokens) {
    if (!stop.has(t)) out.add(t);
  }
  return out;
}

function joinReasonLabels(labels: readonly string[]): string {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

// R16: Synthesize a Vai-voice paragraph that combines multiple forum sources
// into a single "here's my read across the threads" framing. Without this, the
// rendered answer for opinion-shaped queries reads as a stack of verbatim
// reddit titles with no synthesis tying them together. Returns null when the
// query isn't opinion-shaped or there aren't enough forum sources to bother.
function synthesizeVaiTake(
  query: string,
  used: readonly SearchSnippet[],
  primarySubject: string,
): string | null {
  const forumRx = /(reddit\.com|news\.ycombinator|stackoverflow|stackexchange|discourse|forum)/i;
  const forumCount = used.filter((u) => forumRx.test(u.domain ?? '')).length;
  if (forumCount < 2) return null;
  const isOpinionShape = /\b(?:best|top|recommend|why\s+do(?:es)?\s+people\s+(?:hate|love|like|dislike|prefer)|hate|love|prefer|favorite|opinion|worth\s+it|overrated|underrated|reddit|sentiment|thoughts?\s+on)\b/i.test(query);
  if (!isOpinionShape) return null;

  const qAnchors = extractQueryAnchors(query);
  const STOP = new Set([
    'just','like','really','people','game','games','thing','things','stuff',
    'good','bad','great','better','worse','also','about','some','many','much','more',
    'most','less','very','from','with','that','this','then','than','they','them',
    'their','there','here','what','when','where','which','because','since','still',
    'even','only','same','make','makes','made','take','takes','want','wants','need',
    'needs','know','think','thought','look','looks','feel','feels','seen','saw','say',
    'says','said','went','goes','come','came','gets','give','given','tell',
    'told','your','yours','have','having','been','were','will',
    'would','could','should','might','must','shall','dont','doesnt','wasnt','isnt',
    'arent','cant','cannot','wont','heres','theres','whats','wheres','play','playing',
    'time','year','years','day','days','first','last','long','well','update','edit',
    'guys','guess','genuinely','second','third','fourth',
    // contraction stems left behind when ' is dropped
    'didn','wasn','isn','aren','wouldn','couldn','shouldn','haven','hadn','hasn',
    'doesn','don','won','can','ain',
    // weak modals / fillers that surface as themes but don't describe anything
    'probably','maybe','perhaps','obviously','actually','basically','literally',
    'definitely','honestly','seriously','frankly','pretty','quite','kinda','sorta',
    'still','always','never','sometimes','often','rarely','barely','almost',
    // generic words that match across most threads without carrying meaning
    'brain','idea','point','reason','reasons','part','parts','way','ways','side',
    'sides','case','cases','kind','kinds','sort','sorts','sense','fact','facts',
    'lot','lots','bit','bits','one','two','three','many','few','number','set',
    'place','places','line','lines','top','bottom','end','start','around',
    'whole','entire','single','double',
  ]);
  const counts = new Map<string, { n: number; sources: Set<number> }>();
  for (let i = 0; i < used.length; i++) {
    if (!forumRx.test((used[i].domain ?? '').toLowerCase())) continue;
    const raw = used[i].text.replace(/^\s*\[r\/[^\]]+\]\s*/i, ' ').toLowerCase();
    const seen = new Set<string>();
    const toks = raw.match(/[a-z][a-z\-]{3,}/g) ?? [];
    for (const t of toks) {
      if (STOP.has(t) || qAnchors.has(t) || seen.has(t)) continue;
      seen.add(t);
      const e = counts.get(t) ?? { n: 0, sources: new Set<number>() };
      e.n++; e.sources.add(i); counts.set(t, e);
    }
  }
  const themes = [...counts.entries()]
    .filter(([, v]) => v.sources.size >= 2 && v.n >= 2)
    .sort((a, b) => b[1].sources.size - a[1].sources.size || b[1].n - a[1].n)
    .slice(0, 3)
    .map(([w]) => w);

  // Trim leading question-word noise from the subject so the Vai-take reads
  // as a topic, not as the query restated. Tokenize and drop a small prefix
  // set rather than one nested regex (avoids ReDoS risk).
  const SUBJECT_PREFIX_DROP = new Set([
    'why','how','what','when','where','who','is','are','do','does','did',
    'should','can','could','would','will','must','may','might',
    'people','users','gamers','players','folks','everyone','anyone',
    'i','you','we','they','hate','love','like','dislike','prefer',
    'recommend','think','feel','about','of','for',
    'the','a','an','new','old','best','top',
  ]);
  let cleanedSubject = (primarySubject || '').trim();
  if (cleanedSubject) {
    const toks = cleanedSubject.split(/\s+/);
    let drop = 0;
    while (drop < toks.length && drop < 6 && SUBJECT_PREFIX_DROP.has(toks[drop].toLowerCase())) drop++;
    cleanedSubject = toks.slice(drop).join(' ').trim();
  }
  const subj = cleanedSubject
    ? titleCaseSubject(cleanedSubject)
    : primarySubject
      ? titleCaseSubject(primarySubject)
      : 'this';
  const hateShape = /\bhate|dislike|why.*hate\b/i.test(query);
  const loveShape = /\blove|why.*(?:like|love|prefer)\b/i.test(query);

  if (themes.length === 0) {
    return `Here's my read across ${forumCount} forum threads on **${subj}** — opinions are scattered enough that no single theme dominates. The snippets below are the strongest individual takes I found, not a community consensus.`;
  }
  const lead = themes.join(', ');
  if (hateShape) {
    return `Reading across ${forumCount} forum threads on **${subj}**, the gripes that keep coming back are **${lead}**. It's not one deal-breaker — it's a cluster of friction points different users hit at different times. The threads below are community sentiment, not a verdict.`;
  }
  if (loveShape) {
    return `Reading across ${forumCount} forum threads on **${subj}**, what people consistently bring up as positives is **${lead}**. The snippets below back this up from different angles — community sentiment, not a verdict.`;
  }
  return `Reading across ${forumCount} forum threads on **${subj}**, the recurring talking points are **${lead}**. The snippets below show how different users frame those points — community sentiment, not a verdict.`;
}

function titleCaseSubject(subject: string): string {
  if (subject.trim().length === 0) return subject;
  return subject.charAt(0).toUpperCase() + subject.slice(1);
}

function isPerplexityProductSentence(sentence: string): boolean {
  return /\b(?:perplexity ai|answer engine|search engine|user queries|synthesizes responses|citations?|web search|chatbot|sources?)\b/i.test(sentence);
}

function isPerplexityMathSentence(sentence: string): boolean {
  return /\b(?:information theory|probability distribution|fair coin toss|fair die roll|cross-entropy|uncertainty for a discrete)\b/i.test(sentence);
}

function isPerplexityWrapperSentence(sentence: string): boolean {
  return /\b(?:inspired by perplexity|perplexity[-\s]?inspired|open[-\s]?source perplexity|perplexity clone|wrapper)\b/i.test(sentence);
}

function buildEvidenceSummary(
  query: string,
  used: readonly SearchSnippet[],
): {
  plan: VaiSearchPlan;
  primarySubject: string;
  comparisonSubject: string | null;
  summary: { text: string; sourceIndex: number } | null;
  supporting: Array<{ text: string; sourceIndex: number }>;
  reasons: Array<{ label: string; sourceIndex: number }>;
} {
  const plan = buildSearchPlan(query);
  const normalizedQuery = normalizeSearchQuery(query);
  const primarySubject = extractPrimarySubject(normalizedQuery, plan.entities);
  const comparisonSubject = extractComparisonSubject(normalizedQuery);
  const relevanceShape = inferRelevanceShape(query, plan);
  const candidates: Array<{ text: string; sourceIndex: number; score: number }> = [];
  const summaryCandidates: Array<{ text: string; sourceIndex: number; score: number }> = [];
  const reasons: Array<{ label: string; sourceIndex: number }> = [];
  const seenReasonLabels = new Set<string>();
  const actionQuestion = extractActionQuestionParts(query);

  // Intent-aware source-trust weighting: for opinion/recommendation queries,
  // community forums (reddit/HN/SO) are more relevant than encyclopedic
  // sources. For factual queries, encyclopedic sources beat forums.
  const _isOpinionQuery = /\b(?:best|top|recommend|should\s+i|which\s+one|favorite|prefer|good\s+for|worth\s+it|underrated|overrated|reddit|opinion|review|honest)\b/i.test(query)
    || plan.intent === 'recommendation'
    || plan.intent === 'opinion';
  const _isFactualQuery = !_isOpinionQuery && (
    plan.intent === 'definition'
    || plan.intent === 'explanation'
    || /\b(?:what\s+is|what\s+are|who\s+is|when\s+(?:did|does|was)|how\s+(?:does|do)|where\s+is|why\s+(?:does|did))\b/i.test(query)
  );
  const _sourceIntentBoost = (snippet: SearchSnippet): number => {
    const dom = (snippet.domain ?? '').toLowerCase();
    const isWiki = dom.includes('wikipedia') || dom.includes('britannica') || dom.includes('encyclopedia');
    const isForum = dom.includes('reddit') || dom.includes('news.ycombinator') || dom.includes('stackoverflow') || dom.includes('stackexchange') || dom.includes('quora');
    if (_isOpinionQuery) {
      if (isForum) return 4;
      if (isWiki) return -3;
    } else if (_isFactualQuery) {
      if (isWiki) return 3;
      if (isForum) return -2;
    }
    return 0;
  };

  for (let sourceIndex = 0; sourceIndex < used.length; sourceIndex += 1) {
    const snippet = used[sourceIndex];
    if (actionQuestion) {
      const actionEvidence = extractActionEvidenceSentence(query, snippet.text, snippet.title);
      if (actionEvidence) {
        const score = 20
          + (snippet.trust.tier === 'high' ? 3 : snippet.trust.tier === 'medium' ? 1 : -3)
          + Math.min(snippet.rank, 2.5);
        const candidate = { text: actionEvidence, sourceIndex, score };
        candidates.push(candidate);
        summaryCandidates.push(candidate);
      }
      continue;
    }
    const sentences = splitIntoSentences(snippet.text);

    for (const sentence of sentences) {
      if (relevanceShape === 'causal' && !causalSentenceAnswersQuery(sentence, primarySubject)) {
        continue;
      }
      let score = sentenceScore(sentence, query, plan, primarySubject, comparisonSubject);
      if (relevanceShape === 'causal') score += causalSentenceStrength(sentence);
      score += snippet.trust.tier === 'high' ? 3 : snippet.trust.tier === 'medium' ? 1 : -3;
      score += _sourceIntentBoost(snippet);
      score += Math.min(snippet.rank, 2.5);
      if (shouldBiasPerplexityToProduct(query, primarySubject) && isPerplexityWrapperSentence(sentence)) {
        score -= 9;
      }
      if (score > 0) {
        candidates.push({ text: sentence, sourceIndex, score });

        const lower = sentence.toLowerCase();
        const subjectLower = primarySubject.toLowerCase();
        const strongDefinitionLike = subjectLower.length > 0
          && new RegExp(`^${subjectLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*\\b(?:is|are|refers to)\\b`, 'i').test(lower);
        const definitionLike = subjectLower.length > 0
          && lower.includes(subjectLower)
          && /\b(?:is|are|refers to|functions by|supports|removes private data|stores little to no information)\b/i.test(sentence);
        if (strongDefinitionLike) {
          summaryCandidates.push({ text: sentence, sourceIndex, score: score + 8 });
        }
        if (definitionLike) {
          summaryCandidates.push({ text: sentence, sourceIndex, score: score + 5 });
        }

        // Release/availability-status lead: when user asks "is X out yet" / "did X release",
        // prefer sentences that actually describe release status.
        const _asksReleaseStatus = /\b(?:out\s+yet|released\s+yet|release\s+date|did\s+\S+\s+release|is\s+\S+\s+(?:out|released|available)\s+(?:yet|now)|when\s+(?:does|did|will|is)\s+\S+\s+(?:come\s+out|release|launch|drop))\b/i.test(query);
        if (_asksReleaseStatus) {
          const _releaseSentence = /\b(?:released\s+(?:on|in|worldwide|globally)|was\s+released|launched\s+(?:on|in)|came\s+out\s+(?:on|in)|release(?:d)?\s+date|available\s+(?:on|from|now|since)|out\s+now|launch\s+date|scheduled\s+(?:for|to)\s+release|set\s+(?:for|to)\s+release|delayed\s+(?:to|until)|announced\s+for)\b/i.test(sentence);
          if (_releaseSentence) {
            summaryCandidates.push({ text: sentence, sourceIndex, score: score + 12 });
          }
        }
      }

      for (const reasonPattern of COMPARISON_REASON_PATTERNS) {
        if (!seenReasonLabels.has(reasonPattern.label) && reasonPattern.pattern.test(sentence)) {
          seenReasonLabels.add(reasonPattern.label);
          reasons.push({ label: reasonPattern.label, sourceIndex });
        }
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  summaryCandidates.sort((a, b) => b.score - a.score);
  const summary = relevanceShape === 'causal'
    ? candidates.find((candidate) => !looksLikeWeakStandaloneLead(candidate.text)) ?? null
    : summaryCandidates.find((candidate) => !looksLikeWeakStandaloneLead(candidate.text))
      ?? candidates.find((candidate) => !looksLikeWeakStandaloneLead(candidate.text))
      ?? null;
  const supporting: Array<{ text: string; sourceIndex: number }> = [];

  const directCausalSupport = relevanceShape === 'causal'
    ? candidates.filter((candidate) => causalSentenceStrength(candidate.text) >= 8)
    : [];
  const preferredSupport = plan.intent === 'comparison'
    ? candidates.filter((candidate) => /\b(?:privacy|tracked|profiled|metasearch|aggregates?|self-host|search providers|instant-answer|instant answer|results)\b/i.test(candidate.text) && hasExplanatoryVerb(candidate.text))
    : relevanceShape === 'causal' && directCausalSupport.length > 0
      ? directCausalSupport
      : candidates;

  for (const candidate of preferredSupport) {
    if (supporting.length >= 2) break;
    if (summary && candidate.text === summary.text) continue;
    if (looksLikeWeakStandaloneLead(candidate.text)) continue;
    if (supporting.some((entry) => entry.text === candidate.text)) continue;
    supporting.push({ text: candidate.text, sourceIndex: candidate.sourceIndex });
  }

  return {
    plan,
    primarySubject,
    comparisonSubject,
    summary: summary ? { text: summary.text, sourceIndex: summary.sourceIndex } : null,
    supporting,
    reasons: reasons.slice(0, 3),
  };
}

// Honest-audit fix: query/snippet content-word overlap gate. Prevents the
// pipeline from emitting Bee Movie scripts, random GitHub repo blurbs, or
// other off-topic snippets when retrieval scored everything low. If none
// of the top snippets share any meaningful content word with the query,
// we refuse to render an answer and tell the user we didn't find anything.
const SEARCH_STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','of','to','in','on','for','at','by','with','from','as','is','are','was','were','be','been','being','this','that','these','those','it','its','i','you','we','they','he','she','my','your','our','their','his','her',
  'what','who','where','when','why','how','which','whom',
  'do','does','did','doing','done','have','has','had','having',
  'can','could','should','would','will','shall','may','might','must',
  'me','us','them','him','so','just','very','really','about','tell','give','show','say','said','please','some','any','all','no','not','yes','per',
  'thing','things','stuff','okay','ok','well','um','uh','hey','hi','hello','yo','vai',
]);
function extractContentWords(text: string): Set<string> {
  const out = new Set<string>();
  const tokens = text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [];
  for (const t of tokens) if (!SEARCH_STOPWORDS.has(t)) out.add(t);
  return out;
}
type RelevanceShape =
  | 'population'
  | 'yes-no'
  | 'recommendation'
  | 'comparison'
  | 'temporal'
  | 'causal'
  | 'definition'
  | 'how-to'
  | 'generic';

export interface SnippetRelevanceAssessment {
  readonly score: number;
  readonly matched: boolean;
  readonly shape: RelevanceShape;
  readonly topicHits: number;
  readonly topicCoverage: number;
  readonly queryHits: number;
  readonly shapeMatched: boolean;
}

const RELEVANCE_TOPIC_NOISE = new Set([
  'many','much','people','person','live','lives','living','population','inhabitants','residents',
  'recommend','recommended','recommendation','using','use','uses','should','would','could','good',
  'best','top','worth','bigger','larger','smaller','compare','compared','than','difference',
  'when','date','year','latest','current','stable','release','released','version','what','which','where',
  'explain','briefly','simple','simply','words','facts','there','that','this','one',
  'cause','causes','caused','reason','reasons',
  'phone','telephone','number','contact','details','online','website','email','address',
]);

const SHORT_TOPIC_ACRONYMS = new Set([
  'ai', 'ar', 'db', 'ev', 'ml', 'os', 'ui', 'ux', 'vr',
]);

function inferRelevanceShape(query: string, plan: VaiSearchPlan): RelevanceShape {
  const q = normalizeCommonTypos(query).toLowerCase();
  if (/\b(?:how\s+many\s+people|population|inhabitants?|residents?|people\s+live|lives?\s+there)\b/.test(q)) return 'population';
  if (/^(?:does|do|did|can|could|will|would|has|have|had|should|is|are)\b/.test(q)) return 'yes-no';
  if (/\b(?:recommend|should\s+i|would\s+you|worth\s+it|good\s+(?:idea|for)|which\s+one|best|top)\b/.test(q) || plan.intent === 'recommendation') return 'recommendation';
  if (/\b(?:bigger|larger|smaller|higher|lower|more\s+than|less\s+than|vs\.?|versus|compare|compared|difference\s+between)\b/.test(q) || plan.intent === 'comparison') return 'comparison';
  if (/\b(?:when|what\s+(?:year|date)|latest|current|release(?:d)?|version|today|now|202[4-9])\b/.test(q) || plan.intent === 'temporal' || plan.intent === 'current') return 'temporal';
  if (/\b(?:causes?|caused\s+by|what\s+(?:caused|led\s+to|triggered|drove)|reasons?\s+for|why\s+(?:did|does|is|are|was|were))\b/.test(q)) return 'causal';
  if (/^(?:what(?:'s|\s+is|\s+are)|who(?:\s+is|\s+are)|define|explain|describe|hva\s+er|forklar|beskriv)\b/i.test(q) || plan.intent === 'definition' || plan.intent === 'person') return 'definition';
  if (/\bhow\s+(?:to|do|can|does)\b/i.test(q) || plan.intent === 'how-to' || plan.intent === 'troubleshoot') return 'how-to';
  return 'generic';
}

function answerShapeMatches(shape: RelevanceShape, combined: string): boolean {
  switch (shape) {
    case 'population':
      return /\b(?:population|inhabitants?|residents?|census|metro\s+area|urban\s+area|municipality|people\s+(?:live|living)|lives?\s+in|\d[\d.,]*\s*(?:million|thousand|residents?|inhabitants?|people))\b/i.test(combined);
    case 'yes-no':
      return /\b(?:yes|no|has|have|had|makes?|made|sells?|sold|offers?|serves?|produces?|stocks?|carr(?:y|ies)|provides?|supports?|includes?|contains?|eats?|drinks?|available|menu|products?|manufactured?\s+by)\b/i.test(combined);
    case 'recommendation':
      return /\b(?:recommend|should|worth|useful|good\s+(?:choice|idea|for)|depends?|trade-?offs?|pros?|cons?|privacy|security|trust|risk|benefit|drawback|alternative|avoid|choose|prefer|restaurant|dining|eatery|cafe|café|menu|cuisine|food|reviews?|ratings?|stars?|address|located|opening\s+hours?|open\s+(?:now|today))\b/i.test(combined);
    case 'comparison':
      return /\b(?:bigger|larger|smaller|higher|lower|more\s+than|less\s+than|compared?|difference|versus|vs\.?|whereas|unlike|instead|advantage|trade-?off|area|population|rank|size|larger\s+than|smaller\s+than|privacy|metasearch|aggregates?|multiple\s+search\s+services|instant\s+answer|zero-click|api|not\s+a\s+general)\b/i.test(combined);
    case 'temporal':
      return /\b(?:released?|release\s+date|launched?|came\s+out|available|latest|current(?:ly)?|version|changelog|announced|scheduled|20\d{2}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(combined);
    case 'causal':
      return /\b(?:because(?:\s+of)?|caused?\s+by|causes?\s+(?:include|included|are|were)|due\s+to|led\s+to|result(?:ed|s)?\s+from|driven\s+by|triggered\s+by|contributed\s+to|root\s+causes?|reasons?\s+(?:include|included|are|were|for)|factors?\s+(?:include|included|are|were|behind|contributed))\b/i.test(combined);
    case 'definition':
      return /\b(?:is|are|was|were|refers\s+to|means|describes|known\s+as|defined\s+as|type\s+of|kind\s+of|creator|founded|born)\b/i.test(combined);
    case 'how-to':
      return /\b(?:step|steps|use|using|install|configure|setup|fix|debug|solve|works?|example|guide|tutorial|command|option)\b/i.test(combined);
    case 'generic':
      return true;
  }
}

function causalSentenceStrength(sentence: string): number {
  if (/\b(?:caused?\s+by|result(?:ed|s)?\s+from|because(?:\s+of)?|due\s+to)\b/i.test(sentence)) return 12;
  if (/\b(?:led\s+to|driven\s+by|triggered\s+by|root\s+causes?|factors?\s+(?:include|included|are|were|behind))\b/i.test(sentence)) return 8;
  if (/\b(?:contributed\s+to|contributor\s+to)\b/i.test(sentence)) return 2;
  return 0;
}

function causalSentenceAnswersQuery(sentence: string, primarySubject: string): boolean {
  if (!answerShapeMatches('causal', sentence)) return false;
  if (!primarySubject) return true;

  const target = primarySubject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const targetBeforeCause = new RegExp(
    `\\b${target}\\b.{0,100}\\b(?:caused?\\s+by|result(?:ed|s)?\\s+from|due\\s+to|driven\\s+by|triggered\\s+by|root\\s+causes?|reasons?\\s+(?:include|included|are|were)|factors?\\s+(?:include|included|are|were|behind))\\b`,
    'i',
  );
  const causeBeforeTarget = new RegExp(
    `\\b(?:led\\s+to|caused?|triggered|contributed\\s+to|contributor\\s+to)\\b.{0,120}\\b${target}\\b`,
    'i',
  );
  return targetBeforeCause.test(sentence) || causeBeforeTarget.test(sentence);
}

function countWordHits(words: ReadonlySet<string>, text: string): number {
  let hits = 0;
  for (const word of words) {
    if (textHasTopicAnchor(text, word)) hits += 1;
  }
  return hits;
}

interface WeightedTopicAnchor {
  readonly value: string;
  readonly weight: number;
}

interface ActionQuestionParts {
  readonly subject: readonly string[];
  readonly predicate: string;
  readonly object: readonly string[];
}

const ACTION_QUESTION_PREDICATE =
  'make|makes|made|making|manufacture|manufactures|manufactured|produce|produces|produced|sell|sells|sold|selling|stock|stocks|stocked|carry|carries|carried|have|has|had|offer|offers|offered|serve|serves|served|provide|provides|provided|support|supports|supported|include|includes|included|contain|contains|contained|eat|eats|ate|eating|drink|drinks|drank|drinking';

function extractActionQuestionParts(query: string): ActionQuestionParts | null {
  const normalized = normalizeCommonTypos(query)
    .toLowerCase()
    .replace(/[?.!]+$/g, '')
    .trim();
  const match = normalized.match(
    new RegExp(`^(?:does|do|did|can|could|will|would|has|have|had|should|is|are)\\s+(.+?)\\s+(${ACTION_QUESTION_PREDICATE})\\s+(.+)$`, 'i'),
  );
  if (!match) return null;

  const extract = (value: string): string[] => value
    .split(/\s+/)
    .map(sanitizeEntityToken)
    .filter((token) => token.length >= 3)
    .filter((token) => !SEARCH_STOPWORDS.has(token) && !RELEVANCE_TOPIC_NOISE.has(token));
  const subject = extract(match[1]);
  const object = extract(match[3]);
  if (subject.length === 0 || object.length === 0) return null;
  return { subject, predicate: match[2].toLowerCase(), object };
}

function topicAnchorWeight(value: string): number {
  const compactLength = value.replace(/[^a-z0-9]/gi, '').length;
  let weight = 1;
  if (compactLength >= 8) weight += 0.4;
  else if (compactLength >= 5) weight += 0.2;
  if (/[.+#-]/.test(value)) weight += 0.35;
  return weight;
}

function topicAnchorVariants(value: string): string[] {
  const variants = new Set([value.toLowerCase()]);
  if (value.length >= 5 && value.endsWith('ies')) variants.add(`${value.slice(0, -3)}y`);
  else if (value.length >= 5 && value.endsWith('s') && !value.endsWith('ss')) variants.add(value.slice(0, -1));
  else if (value.length >= 4) variants.add(`${value}s`);
  return [...variants];
}

function textHasTopicAnchor(text: string, value: string): boolean {
  const lower = text.toLowerCase();
  return topicAnchorVariants(value).some((variant) => {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(lower);
  });
}

function extractTopicAnchorsForRelevance(query: string, plan: VaiSearchPlan): WeightedTopicAnchor[] {
  const anchors = new Map<string, WeightedTopicAnchor>();
  const add = (value: string): void => {
    const raw = sanitizeEntityToken(value);
    const cleaned = raw.toLowerCase();
    const shortAcronym = /^[A-Z0-9]{2,6}$/.test(raw) || SHORT_TOPIC_ACRONYMS.has(cleaned);
    if (cleaned.length < 3 && !shortAcronym) return;
    if (SEARCH_STOPWORDS.has(cleaned) || RELEVANCE_TOPIC_NOISE.has(cleaned)) return;
    anchors.set(cleaned, { value: cleaned, weight: topicAnchorWeight(cleaned) + (shortAcronym ? 1.4 : 0) });
  };

  const actionQuestion = extractActionQuestionParts(query);
  if (actionQuestion) {
    for (const token of [...actionQuestion.subject, ...actionQuestion.object]) add(token);
    return [...anchors.values()];
  }

  for (const entity of plan.entities.slice(0, 8)) {
    for (const token of entity.split(/\s+/)) add(token);
  }
  if (anchors.size > 0) return [...anchors.values()];

  // The planner normally owns topic extraction. Fall back to lexical anchors
  // only when it found no entities at all, so filler words cannot dilute a
  // valid single-entity definition such as "explain perplexity simply".
  for (const token of query.match(/\b[A-Z][A-Za-z0-9.+#-]{1,}\b/g) ?? []) {
    add(token);
  }
  for (const word of extractQueryAnchors(query)) {
    add(word);
  }
  return [...anchors.values()];
}

function relevanceTextWindows(text: string): string[] {
  const chunks = text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const windows: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= 500) {
      windows.push(chunk);
      continue;
    }
    for (let start = 0; start < chunk.length; start += 350) {
      windows.push(chunk.slice(start, start + 500));
    }
  }
  return windows.length > 0 ? windows : [text];
}

function actionAnchorPattern(tokens: readonly string[]): string {
  const variants = tokens.flatMap((token) => topicAnchorVariants(token));
  const escaped = variants.map((variant) => variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `(?:${escaped.join('|')})`;
}

function actionRelationshipPattern(parts: ActionQuestionParts): RegExp {
  const subject = actionAnchorPattern(parts.subject);
  const object = actionAnchorPattern(parts.object);
  const forward = (verb: string): string => `\\b${subject}\\b.{0,100}\\b${verb}\\b.{0,100}\\b${object}\\b`;
  const reverse = (verb: string, connector: string): string => `\\b${object}\\b.{0,100}\\b${verb}\\b.{0,30}\\b${connector}\\b.{0,80}\\b${subject}\\b`;

  if (/^(?:make|makes|made|making|manufacture|manufactures|manufactured|produce|produces|produced)$/.test(parts.predicate)) {
    return new RegExp(`${forward('(?:make|makes|made|making|manufacture|manufactures|manufactured|produce|produces|produced)')}|${reverse('(?:made|manufactured|produced)', 'by')}`, 'i');
  }
  if (/^(?:sell|sells|sold|selling|stock|stocks|stocked|carry|carries|carried)$/.test(parts.predicate)) {
    return new RegExp(`${forward('(?:sell|sells|sold|selling|stock|stocks|stocked|carry|carries|carried|offer|offers|offered|include|includes|included)')}|${reverse('(?:sold|offered|available)', '(?:by|at|from|on)')}`, 'i');
  }
  if (/^(?:have|has|had|offer|offers|offered|serve|serves|served|provide|provides|provided|support|supports|supported|include|includes|included|contain|contains|contained)$/.test(parts.predicate)) {
    return new RegExp(`${forward('(?:have|has|had|offer|offers|offered|serve|serves|served|provide|provides|provided|support|supports|supported|include|includes|included|contain|contains|contained|feature|features|featured)')}|${reverse('(?:available|featured)', '(?:by|at|from|on)')}|\\b${object}\\b.{0,40}\\bon\\b.{0,60}\\b${subject}\\b`, 'i');
  }
  if (/^(?:eat|eats|ate|eating|drink|drinks|drank|drinking)$/.test(parts.predicate)) {
    return new RegExp(`${forward('(?:eat|eats|ate|eating|drink|drinks|drank|drinking)')}|\\b${object}\\b.{0,80}\\b(?:toxic|harmful|poisonous|unsafe)\\b.{0,40}\\b(?:for|to)\\b.{0,40}\\b${subject}\\b`, 'i');
  }

  const escaped = parts.predicate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(forward(escaped), 'i');
}

function extractActionEvidenceSentence(query: string, text: string, title = ''): string | null {
  const actionQuestion = extractActionQuestionParts(query);
  if (!actionQuestion) return null;
  const relation = actionRelationshipPattern(actionQuestion);
  return [title, ...relevanceTextWindows(text)].find((candidate) => {
    if (!candidate || candidate.includes('?')) return false;
    if (!actionQuestion.subject.every((token) => textHasTopicAnchor(candidate, token))) return false;
    if (!actionQuestion.object.every((token) => textHasTopicAnchor(candidate, token))) return false;
    return relation.test(candidate);
  }) ?? null;
}

function actionEvidenceMatches(query: string, text: string, title = ''): boolean {
  const actionQuestion = extractActionQuestionParts(query);
  if (!actionQuestion) return answerShapeMatches('yes-no', `${title}\n${text}`);
  return extractActionEvidenceSentence(query, text, title) !== null;
}

function assessTopicAnchorCoverage(anchors: readonly WeightedTopicAnchor[], text: string, title = ''): {
  hits: number;
  coverage: number;
} {
  const totalWeight = anchors.reduce((sum, anchor) => sum + anchor.weight, 0);
  let bestHits = 0;
  let bestMatchedWeight = 0;
  for (const window of relevanceTextWindows(text)) {
    const localText = title ? `${title}\n${window}` : window;
    let hits = 0;
    let matchedWeight = 0;
    for (const anchor of anchors) {
      if (!textHasTopicAnchor(localText, anchor.value)) continue;
      hits += 1;
      matchedWeight += anchor.weight;
    }
    if (matchedWeight <= bestMatchedWeight) continue;
    bestHits = hits;
    bestMatchedWeight = matchedWeight;
  }
  return {
    hits: bestHits,
    coverage: totalWeight > 0 ? bestMatchedWeight / totalWeight : 1,
  };
}

function topicAnchorGateMatches(
  anchors: readonly WeightedTopicAnchor[],
  topicHits: number,
  topicCoverage: number,
  shape: RelevanceShape,
): boolean {
  if (anchors.length === 0) return true;
  if (anchors.length === 1) return topicHits === 1;
  // Comparison synthesis intentionally combines side-specific evidence: one
  // source may describe SearXNG and another DuckDuckGo.
  if (shape === 'comparison') return topicHits >= 1;
  return topicHits >= 2 && topicCoverage >= 0.55;
}

function extractEntityQueryAnchors(query: string): Set<string> {
  const plan = buildSearchPlan(query);
  const anchors = extractTopicAnchorsForRelevance(query, plan);
  if (anchors.length > 0) return new Set(anchors.map((anchor) => anchor.value));
  return extractQueryAnchors(query);
}

function hasWrongShapePopulationNoise(combined: string): boolean {
  return /\b(?:shooting|shot|killed|injured|attack|crime|police|suspect|arrested|victims?|dead|death|massacre)\b/i.test(combined)
    && !answerShapeMatches('population', combined);
}

export function scoreSnippetRelevanceForQuery(
  query: string,
  snippet: Pick<SearchSnippet, 'text' | 'title' | 'domain'>,
): SnippetRelevanceAssessment {
  const plan = buildSearchPlan(query);
  const shape = inferRelevanceShape(query, plan);
  const combined = `${snippet.title || ''}\n${snippet.text || ''}`;
  const lower = combined.toLowerCase();
  const queryWords = extractContentWords(query);
  const topicAnchors = extractTopicAnchorsForRelevance(query, plan);
  const { hits: topicHits, coverage: topicCoverage } = assessTopicAnchorCoverage(topicAnchors, snippet.text || '', snippet.title || '');
  const queryHits = countWordHits(queryWords, lower);
  const primarySubject = extractPrimarySubject(normalizeSearchQuery(query), plan.entities);
  const shapeMatched = shape === 'yes-no'
    ? actionEvidenceMatches(query, snippet.text || '', snippet.title || '')
    : shape === 'causal'
      ? relevanceTextWindows(snippet.text || '').some((window) => causalSentenceAnswersQuery(window, primarySubject))
    : answerShapeMatches(shape, combined);

  let score = 0;
  if (topicAnchors.length > 0) score += topicCoverage * 0.45;
  else if (queryWords.size > 0) score += Math.min(queryHits / queryWords.size, 1) * 0.35;
  else score += 0.35;

  if (queryWords.size > 0) score += Math.min(queryHits / Math.max(queryWords.size, 1), 1) * 0.2;
  score += shapeMatched ? 0.3 : (shape === 'generic' ? 0 : -0.2);

  if (snippet.domain && /(reddit\.com|news\.ycombinator|stackoverflow|stackexchange|discourse|forum)/i.test(snippet.domain) && shape === 'recommendation') {
    score += 0.08;
  }
  if (shape === 'comparison' && topicHits > 0 && shapeMatched) {
    // Comparison answers can be assembled from side-specific evidence: one
    // source may explain SearXNG, another DuckDuckGo. Do not require every
    // compared entity to appear in every individual snippet.
    score += 0.12;
  }
  const packageSupportSource = shape === 'temporal'
    && /\bpypi\b/i.test(query)
    && /^(?:github\.com|gitlab\.com)$/i.test(snippet.domain ?? '')
    && topicHits > 0;
  if (packageSupportSource) {
    score += 0.12;
  }
  if (shape === 'population' && hasWrongShapePopulationNoise(combined)) {
    score -= 0.35;
  }

  const topicOk = topicAnchorGateMatches(topicAnchors, topicHits, topicCoverage, shape);
  const shapeOk = shape === 'generic' || shapeMatched || packageSupportSource;
  const threshold = shape === 'definition' || shape === 'generic' ? 0.38 : 0.5;
  const matched = packageSupportSource || (topicOk && shapeOk && score >= threshold);

  return {
    score: Math.max(0, Math.min(1, score)),
    matched,
    shape,
    topicHits,
    topicCoverage,
    queryHits,
    shapeMatched,
  };
}

export function filterRelevantSnippetsForQuery(
  query: string,
  snippets: readonly SearchSnippet[],
): SearchSnippet[] {
  return snippets
    .map((snippet) => ({ snippet, relevance: scoreSnippetRelevanceForQuery(query, snippet) }))
    .filter(({ snippet, relevance }) => relevance.matched && !looksLikeJunkSnippet(snippet.text, snippet.title || ''))
    .sort((a, b) => {
      const relevanceDelta = b.relevance.score - a.relevance.score;
      if (Math.abs(relevanceDelta) > 0.001) return relevanceDelta;
      return b.snippet.rank - a.snippet.rank;
    })
    .map(({ snippet }) => snippet);
}

// Honest-audit fix: README/SEO-style snippet detector. Web results sometimes
// surface low-quality landing pages or GitHub READMEs that happen to share
// keywords with the query (e.g. "Simple weather reporter of different capital
// cities in Australia." for "capital city of australia"). These are visibly
// off-topic to a human reader; refuse to render them as the answer.
function looksLikeJunkSnippet(text: string, title: string): boolean {
  const t = (text || '').trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  const titleLower = (title || '').toLowerCase();
  const seoOpeners = [
    /^if\s+you\s+(?:were|are)\s+looking\s+for\b/,
    /^featured\s+in\s+do\s+it\s+all\b/,
    /^you\s+(?:are|were)\s+at\s+(?:the\s+)?right\s+place\b/,
    /^(?:click|tap)\s+here\b/,
  ];
  for (const re of seoOpeners) if (re.test(lower)) return true;
  const readmeOpeners = [
    /^this\s+(?:python|node|javascript|typescript|rust|go|c\+\+|c#|java|ruby|php|bash|shell)?\s*(?:script|program|repo(?:sitory)?|module|package|library|tool|project|external\s+service)\b/,
    /^simple\s+(?:program|script|tool|app|api|weather\s+reporter|implementation|example|chat(?:bot)?|website)\b/,
    /^python\s+codes?\s+and\s+jupyter\b/,
    /^create\s+a\s+beginner-?friendly\b/,
    /^generally\s+(?:humanoid|robots?|the)\b/,
  ];
  for (const re of readmeOpeners) if (re.test(lower)) return true;
  if (lower.length < 400) {
    if (/\bat\s+right\s+place\b/.test(lower)) return true;
    if (/\bquillbot\s+writing\s+tools\b/.test(lower)) return true;
    if (/\bai\s+generator\s+tools\b/.test(lower)) return true;
  }
  // GitHub repo chrome leakage
  if (/\b(?:stars?|watchers?|forks?)\s+\d+\s+(?:stars?|watchers?|forks?)/.test(lower)) return true;
  if (/\bnotifications?\s+you\s+must\s+be\s+signed\s+in\b/.test(lower)) return true;
  if (/\bactivity\s+stars?\s+\d+\s+stars?\b/.test(lower)) return true;
  // Title indicators of repo browsing pages
  if (/\bgithub\b/.test(titleLower) && /\b(?:stars?|watchers?|forks?|notifications?)\b/.test(lower)) return true;
  return false;
}

function synthesizeAnswer(query: string, snippets: readonly SearchSnippet[], hadFilteredCandidates = false): string {
  if (snippets.length === 0) {
    if (hadFilteredCandidates) {
      return `I searched for "${query}" but didn't find anything that actually matches the question shape. The web results were off-topic, so I'm not going to invent an answer. Try rephrasing or being more specific.`;
    }
    return `I searched for "${query}" but couldn't find useful results. Try rephrasing or being more specific.`;
  }

  // Group by trust tier for the summary
  const highTrust = snippets.filter(s => s.trust.tier === 'high');
  const medTrust = snippets.filter(s => s.trust.tier === 'medium');
  const otherTrust = snippets.filter(s => s.trust.tier !== 'high' && s.trust.tier !== 'medium');

  // Build answer from highest trust sources first
  const ordered = [...highTrust, ...medTrust, ...otherTrust];
  const candidatesAll = ordered.slice(0, 8);

  const relevantUsed = filterRelevantSnippetsForQuery(query, candidatesAll);
  if (relevantUsed.length === 0) {
    return `I searched for "${query}" but didn't find anything that actually matches. The web results were off-topic, so I'm not going to invent an answer. Try rephrasing or being more specific.`;
  }
  const used = relevantUsed.slice(0, 5);

  if (isFreshLocalBusinessContactRequest(query) && used.some((snippet) => snippet.domain === 'openstreetmap.org')) {
    const listing = used.find((snippet) => snippet.domain === 'openstreetmap.org');
    if (listing) {
      const phone = /\bPhone:\s*((?:\+?\d[\d ()-]{5,}\d))/i.exec(listing.text)?.[1]?.trim();
      const website = /\bWebsite:\s*(https?:\/\/\S+?)(?:\.\s|$)/i.exec(listing.text)?.[1]?.trim();
      const email = /\bEmail:\s*(\S+@\S+?)(?:\.\s|$)/i.exec(listing.text)?.[1]?.trim();
      const hours = /\bOpening hours:\s*(.+?)(?:\.\s|$)/i.exec(listing.text)?.[1]?.trim();
      const sourceIndex = used.indexOf(listing);
      const lines: string[] = [];
      if (phone) lines.push(`The phone number for **${listing.title}** is **${phone}**. ${collectCitationMarks([sourceIndex])}`);
      if (website) lines.push(`Website: ${website}. ${collectCitationMarks([sourceIndex])}`);
      if (email) lines.push(`Email: ${email}. ${collectCitationMarks([sourceIndex])}`);
      if (hours) lines.push(`Opening hours: ${hours}. ${collectCitationMarks([sourceIndex])}`);
      if (lines.length > 0) {
        lines.push('', 'This is the current public listing; contact details can change.');
        return lines.join('\n');
      }
    }
  }

  if (isFreshLocalRecommendationRequest(query) && used.some((snippet) => snippet.domain === 'openstreetmap.org')) {
    const location = extractLocalRecommendationLocation(query) ?? 'the requested area';
    const venueListings = used.filter((snippet) => snippet.domain === 'openstreetmap.org').slice(0, 6);
    const lines = [
      `I found these currently listed options near ${location}. I can verify that the places are listed, but OpenStreetMap does not provide review scores, so I cannot honestly rank which one is "best":`,
      '',
    ];
    for (let index = 0; index < venueListings.length; index++) {
      const listing = venueListings[index];
      const sourceIndex = used.indexOf(listing);
      const detail = sanitizeSnippetText(listing.text)
        .replace(new RegExp(`^${listing.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+is\\s+listed\\s+as\\s+`, 'i'), '')
        .replace(/\s*OpenStreetMap confirms the listing details but does not provide a quality rating\.?\s*$/i, '')
        .trim();
      lines.push(`- **${listing.title}** - ${detail} ${collectCitationMarks([sourceIndex])}`.trim());
    }
    lines.push('');
    lines.push('Check the linked listing, menu, and recent reviews before travelling; hours and ownership can change.');
    return lines.join('\n');
  }

  const lines: string[] = [];
  const { plan, primarySubject, comparisonSubject, summary, supporting, reasons } = buildEvidenceSummary(query, used);
  const actionQuestion = extractActionQuestionParts(query);
  // Iter-17 guard: for "what is X" / "who is X" definition prompts, the lead
  // sentence must start with the entity + copula. Without this, retrieval
  // sometimes leads with a third-party mention fragment ("swift community
  // driven package for openai public api") instead of the actual definition
  // sentence. Scan all snippets for an entity-leading sentence and override
  // the summary if one exists.
  let effectiveSummary = summary;
  let suppressedLeadText: string | null = null;
  if (primarySubject && /^(?:what(?:'s|\s+is|\s+are|\s+was|\s+were)|who(?:\s+is|\s+are|\s+was|\s+were)|hva\s+er)\b/i.test(query.trim())) {
    const subj = primarySubject.toLowerCase();
    const subjEsc = subj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const entityLead = new RegExp(`^${subjEsc}[\\s.,'\u2019:;-]{0,8}(?:is|are|was|were|refers\\s+to)\\b`, 'i');
    const summaryHasEntityLead = summary ? entityLead.test(summary.text) : false;
    if (!summaryHasEntityLead) {
      let best: { text: string; sourceIndex: number } | null = null;
      for (let i = 0; i < used.length; i++) {
        const sents = splitIntoSentences(used[i].text);
        for (const s of sents) {
          if (entityLead.test(s) && s.length >= 40 && s.length <= 600) {
            best = { text: s, sourceIndex: i };
            break;
          }
        }
        if (best) break;
      }
      if (best) {
        if (summary) suppressedLeadText = summary.text;
        effectiveSummary = best;
      }
    }
  }

  // Release-status lead override: for "is X out yet" / "did X release" /
  // "when does X come out" queries, scan ALL retrieved snippets across all
  // sources for a sentence that actually describes release status, and use
  // it as the lead. The chunker often returns gameplay/plot paragraphs
  // even when the article's release-date sentence would be more relevant.
  const _asksReleaseStatusLead = /\b(?:out\s+yet|released\s+yet|release\s+date|did\s+\S+\s+release|is\s+\S+\s+(?:out|released|available)\s+(?:yet|now)|when\s+(?:does|did|will|is)\s+\S+\s+(?:come\s+out|release|launch|drop))\b/i.test(query);
  if (_asksReleaseStatusLead) {
    const _releasePat = /\b(?:released\s+(?:on|in|worldwide|globally)|was\s+released|launched\s+(?:on|in)|came\s+out\s+(?:on|in)|release\s+date|available\s+(?:on|from|now|since)|out\s+now|launch\s+date|scheduled\s+(?:for|to)\s+release|set\s+(?:for|to)\s+release|delayed\s+(?:to|until)|announced\s+for|will\s+(?:be\s+)?release(?:d)?|to\s+release\s+on)\b/i.test.bind(null);
    const _subj = primarySubject ? primarySubject.toLowerCase() : '';
    let _releaseBest: { text: string; sourceIndex: number; score: number } | null = null;
    for (let i = 0; i < used.length; i++) {
      const sents = splitIntoSentences(used[i].text);
      for (const s of sents) {
        if (s.length < 30 || s.length > 500) continue;
        if (!_releasePat(s)) continue;
        let sc = 10;
        // Prefer sentences that name the subject.
        if (_subj && s.toLowerCase().includes(_subj)) sc += 8;
        // Prefer sentences with explicit dates (year or month).
        if (/\b(?:19|20)\d{2}\b/.test(s)) sc += 4;
        if (/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(s)) sc += 3;
        // Prefer high-trust sources.
        sc += used[i].trust.tier === 'high' ? 3 : used[i].trust.tier === 'medium' ? 1 : -2;
        if (!_releaseBest || sc > _releaseBest.score) {
          _releaseBest = { text: s, sourceIndex: i, score: sc };
        }
      }
    }
    if (_releaseBest) {
      if (effectiveSummary) suppressedLeadText = effectiveSummary.text;
      effectiveSummary = { text: _releaseBest.text, sourceIndex: _releaseBest.sourceIndex };
    }
  }

  const prefersSimpleFraming = /\b(?:explain|definition|what is|what are|in simple words?)\b/i.test(query)
    || plan.intent === 'definition'
    || plan.intent === 'explanation';
  const asksWhatItDoes = /\bwhat\s+it\s+does\b/i.test(query) || plan.intent === 'definition' || plan.intent === 'explanation';
  const asksWhenToUse = /\b(?:when\s+should\s+i\s+use|when\s+to\s+use|best\s+fit|should\s+use\s+it|when\s+should\s+you\s+use)\b/i.test(query);

  // Recommendation-aware lead override: when the query is shaped like a
  // recommendation/opinion ask ("best X for Y", "reddit best ...") and the
  // chosen lead is an encyclopedic definition, prefer a community/forum
  // snippet that actually addresses the ask. Looks for a non-wiki source
  // whose snippet text shares ≥2 query-distinctive tokens, has reasonable
  // length, and isn't an off-topic AIO-style thread.
  const _recoQuery = /\b(?:best|top|recommend|should\s+i|which\s+one|favorite|prefer|good\s+for|reddit)\b/i.test(query)
    || plan.intent === 'recommendation'
    || plan.intent === 'opinion';
  if (_recoQuery && effectiveSummary) {
    const _leadDomain = (used[effectiveSummary.sourceIndex]?.domain ?? '').toLowerCase();
    const _leadHead = effectiveSummary.text.slice(0, 200).toLowerCase();
    const _leadIsEnc = /\b(?:is\s+(?:a|an|the)\s+(?:built-in|peripheral|input|output|type|kind|form|class|category|device|technology|system|method|process|product)|refers\s+to|is\s+defined\s+as)\b/i.test(_leadHead);
    if (_leadDomain.includes('wikipedia') || _leadIsEnc) {
      const _qAnchors = extractQueryAnchors(query);
      let _best: { text: string; sourceIndex: number; score: number } | null = null;
      for (let i = 0; i < used.length; i++) {
        if (i === effectiveSummary.sourceIndex) continue;
        const _src = used[i];
        const _dom = (_src.domain ?? '').toLowerCase();
        if (_dom.includes('wikipedia')) continue;
        const _txt = _src.text;
        const _txtLower = _txt.toLowerCase();
        // Skip obvious off-topic AIO/personal threads.
        if (/\b(?:aio|am\s+i\s+the|toddler|baby[-\s]?proof|sister|apartment|destroyed)\b/i.test(_txtLower)) continue;
        let _hits = 0;
        for (const a of _qAnchors) if (_txtLower.includes(a)) _hits++;
        if (_hits < 2) continue;
        if (_txt.length < 60 || _txt.length > 2000) continue;
        const _score = _hits * 10 + Math.min(_txt.length, 400) / 100;
        if (!_best || _score > _best.score) {
          _best = { text: _txt, sourceIndex: i, score: _score };
        }
      }
      if (_best) {
        suppressedLeadText = effectiveSummary.text;
        effectiveSummary = { text: _best.text, sourceIndex: _best.sourceIndex };
      }
    }
  }

  // ── Cross-source consensus: compute confirming/contradicting sources for the
  // lead so the answer reads as a synthesized conclusion, not a quoted snippet.
  // Multi-source citations on the lead show the reader Vai cross-checked.
  // queryAnchors gate prevents claiming "agreement" on generic vocabulary
  // unrelated to the actual question.
  const queryAnchors = extractEntityQueryAnchors(query);
  const leadAgreement = effectiveSummary
    ? findCrossSourceAgreement(effectiveSummary.text, used, effectiveSummary.sourceIndex, 3, queryAnchors)
    : { confirming: [] as number[], contradicting: [] as number[] };
  // Compute shape-mismatch early so we can drop misleading cross-source cites.
  const isRecommendationQuery = /\b(?:best|top|recommend|should\s+i|which\s+one|favorite|prefer|good\s+for|reddit)\b/i.test(query)
    || plan.intent === 'recommendation'
    || plan.intent === 'opinion';
  const _leadHeadEarly = effectiveSummary ? effectiveSummary.text.slice(0, 200).toLowerCase() : '';
  const leadIsEncyclopedic = /\b(?:is\s+(?:a|an|the)\s+(?:built-in|peripheral|input|output|type|kind|form|class|category|device|technology|system|method|process|product)|refers\s+to|is\s+defined\s+as)\b/i.test(_leadHeadEarly);
  const shapeMismatch = isRecommendationQuery && leadIsEncyclopedic;
  const leadCites = effectiveSummary
    ? (shapeMismatch
        ? [effectiveSummary.sourceIndex]
        : [effectiveSummary.sourceIndex, ...leadAgreement.confirming])
    : [0];

  // R16: For opinion-shaped forum-heavy results, lead with a Vai-voice synth
  // paragraph that ties the threads together. Without this, the body reads as
  // a stack of verbatim reddit titles. When the synth fires we skip the
  // generic cross-check intro line — the synth IS the cross-check.
  const vaiTake = synthesizeVaiTake(query, used, primarySubject);
  if (vaiTake) {
    lines.push(vaiTake);
    lines.push('');
  }

  // Vai-voice intro: when consensus exists across multiple sources, signal up
  // front that the lead is a *cross-checked* finding, not a one-source quote.
  // Keeps responses from feeling like "here's a reddit snippet I pasted".
  // (Shape-mismatch already computed above; reuse it here.)
  const showCrossCheckIntro = !vaiTake
    && effectiveSummary
    && leadAgreement.confirming.length >= 1
    && !shapeMismatch;
  if (showCrossCheckIntro) {
    const total = leadAgreement.confirming.length + 1;
    lines.push(`Cross-checked across ${total} sources — they converge on this:`);
    lines.push('');
  } else if (shapeMismatch && !vaiTake) {
    // Honest hedge: tell the reader the sources didn't actually answer the ask.
    lines.push(`Heads up — I couldn't find a source that directly answers "${query.trim()}". The best I have is background context; treat the below as starting points, not a recommendation.`);
    lines.push('');
  }

  if (effectiveSummary) {
    const leadText = cleanLeadText(effectiveSummary.text);
    if (actionQuestion) {
      const isNegative = /\b(?:no|not|never|doesn'?t|don'?t|cannot|can'?t|shouldn'?t|mustn'?t|avoid|toxic|harmful|poisonous|unsafe)\b/i.test(leadText);
      lines.push(`**${isNegative ? 'No' : 'Yes'}** - ${leadText} ${collectCitationMarks(leadCites)}`.trim());
    } else {
      lines.push(`${leadText} ${collectCitationMarks(leadCites)}`.trim());
    }
  } else {
    if (inferRelevanceShape(query, plan) === 'causal') {
      return `I searched for "${query}" but the sources did not contain a direct explanation of the cause. I found related material, but I am not going to present it as a conclusion. Try rephrasing or being more specific.`;
    }
    const fallbackSource = used[0];
    const fallbackText = sanitizeSnippetText(fallbackSource.text);
    const snippetText = fallbackText.length > 220 ? `${fallbackText.slice(0, 220)}...` : fallbackText;
    const fallbackLead = cleanLeadText(snippetText);
    if (looksLikeWeakStandaloneLead(fallbackLead)) {
      return `I searched for "${query}" but the sources did not contain a direct, useful answer. I found related material, but I am not going to present it as a conclusion. Try rephrasing or being more specific.`;
    }
    lines.push(`${fallbackLead} ${collectCitationMarks([0])}`.trim());
  }

  // Filter out the suppressed (off-topic) lead from supporting if it slipped in.
  const supportingFiltered = suppressedLeadText
    ? supporting.filter((entry) => entry.text !== suppressedLeadText)
    : supporting;

  // Pre-compute per-support agreement so we can tag bullets with confirming
  // sources and decide whether the section reads as "Where sources agree" vs
  // "Key points" (i.e. uncorroborated highlights).
  const supportAgreement = supportingFiltered.map((entry) =>
    findCrossSourceAgreement(entry.text, used, entry.sourceIndex, 3, queryAnchors),
  );
  const hasCrossSupport = supportAgreement.some((a) => a.confirming.length > 0);
  const hasContradiction = leadAgreement.contradicting.length > 0
    || supportAgreement.some((a) => a.contradicting.length > 0);

  if (prefersSimpleFraming && supportingFiltered.length > 0) {
    const simpleLead = supportingFiltered[0];
    const simpleAgreement = supportAgreement[0];
    const simpleCites = [simpleLead.sourceIndex, ...simpleAgreement.confirming];
    lines.push('');
    lines.push('In simple words');
    lines.push(`${cleanLeadText(simpleLead.text)} ${collectCitationMarks(simpleCites)}`.trim());
  }

  if (plan.intent === 'comparison' && comparisonSubject) {
    if (reasons.length > 0) {
      const reasonSentence = `The strongest reasons to prefer ${titleCaseSubject(primarySubject)} over ${comparisonSubject} are ${joinReasonLabels(reasons.map((reason) => reason.label))}. ${collectCitationMarks(reasons.map((reason) => reason.sourceIndex))}`;
      lines.push('');
      lines.push(reasonSentence.trim());
    }

    if (supportingFiltered.length > 0) {
      lines.push('');
      lines.push(hasCrossSupport ? 'Where sources agree:' : 'Key evidence:');
      for (let i = 0; i < supportingFiltered.length; i++) {
        const entry = supportingFiltered[i];
        const cites = [entry.sourceIndex, ...supportAgreement[i].confirming];
        lines.push(`- ${cleanLeadText(entry.text)} ${collectCitationMarks(cites)}`.trim());
      }
    }
  } else if (supportingFiltered.length > 0) {
    lines.push('');
    const remainingStart = prefersSimpleFraming ? 1 : 0;
    const remainingSupport = supportingFiltered.slice(remainingStart);
    const remainingAgreement = supportAgreement.slice(remainingStart);
    const remainingHasCross = remainingAgreement.some((a) => a.confirming.length > 0);
    const sectionHeading = remainingHasCross
      ? 'Where sources agree:'
      : asksWhatItDoes
        ? 'What it does:'
        : asksWhenToUse
          ? 'Best fit:'
          : 'Key points:';
    if (remainingSupport.length > 0) {
      lines.push(sectionHeading);
      for (let i = 0; i < remainingSupport.length; i++) {
        const entry = remainingSupport[i];
        const cites = [entry.sourceIndex, ...remainingAgreement[i].confirming];
        lines.push(`- ${cleanLeadText(entry.text)} ${collectCitationMarks(cites)}`.trim());
      }
    }
  }

  // Contradiction callout: when other sources negate the lead's anchor terms,
  // surface it instead of silently picking one side. Reader sees the conflict.
  if (hasContradiction) {
    const contradictingIdx = [
      ...leadAgreement.contradicting,
      ...supportAgreement.flatMap((a) => a.contradicting),
    ];
    const unique = [...new Set(contradictingIdx)];
    if (unique.length > 0) {
      lines.push('');
      lines.push(`Heads up — ${collectCitationMarks(unique)} frame this differently. Worth comparing those pages directly before relying on the takeaway above.`);
    }
  }

  // Confidence footer: replaces the previous meta "N sources line up" line.
  // Only when the lead has strong cross-confirmation (≥2 OTHER sources) AND
  // we have a reasonable evidence base (≥3 used sources). Conveys a calibrated
  // confidence signal in Vai's voice without restating the cite count.
  if (effectiveSummary && leadAgreement.confirming.length >= 2 && used.length >= 3) {
    lines.push('');
    lines.push('Confidence: high — multiple independent sources told the same story, and I picked the lead from where they agreed.');
  } else if (used.length > 0 && leadAgreement.confirming.length === 0) {
    lines.push('');
    lines.push(
      used.length === 1
        ? 'Confidence: limited - I found one entity-relevant source, so treat this as sourced evidence rather than a cross-checked conclusion.'
        : 'Confidence: limited - the sources are relevant, but I did not find a second source confirming the same claim.',
    );
  }

  return lines.join('\n');
}

// ── Page Reading (Step 5: READ — fetch full page content for top results) ──

/**
 * Fetch and extract readable text from a URL.
 * Lightweight extraction — strips HTML tags, nav, scripts, ads.
 * Returns null on any failure (network, timeout, safety).
 */
async function readPage(url: string, timeoutMs: number, maxChars: number): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      headers: {
        'User-Agent': 'VeggaAI/0.1 (Local AI Learning Agent)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeoutMs),
    }, {
      checkDns: process.env.NODE_ENV !== 'test',
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('xhtml')) return null;

    const html = await res.text();
    const text = extractReadableText(html);
    if (text.length < 50) return null;

    // Content safety scan
    const safety = scanContentSafety(text.slice(0, 1000));
    if (!safety.safe) return null;

    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}

/** Strip HTML to readable text — lightweight version of ingest/web's extractMainContent */
function extractReadableText(html: string): string {
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Try semantic containers first
  const mainMatch = cleaned.match(/<main[^>]*>([\s\S]+)<\/main>/i);
  const articleMatch = cleaned.match(/<article[^>]*>([\s\S]+)<\/article>/i);
  if (mainMatch && mainMatch[1].length > 200) cleaned = mainMatch[1];
  else if (articleMatch && articleMatch[1].length > 200) cleaned = articleMatch[1];

  // Strip remaining tags
  cleaned = cleaned.replace(/<\/?[^>]+(>|$)/g, ' ');
  // Normalize whitespace
  cleaned = cleaned.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

/**
 * Read full pages for the top-N ranked snippets.
 * Enriches snippet text with full page content when available.
 */
async function readTopPages(
  snippets: SearchSnippet[],
  topN: number,
  timeoutMs: number,
  maxChars: number,
): Promise<{ enriched: SearchSnippet[]; pagesRead: number }> {
  const urlsSeen = new Set<string>();
  const toRead: Array<{ index: number; url: string }> = [];

  for (let i = 0; i < snippets.length && toRead.length < topN; i++) {
    const s = snippets[i];
    // Only read from trusted sources with real URLs
    if (s.trust.tier === 'untrusted') continue;
    if (urlsSeen.has(s.url)) continue;
    // Skip DuckDuckGo internal URLs
    if (s.url.includes('duckduckgo.com')) continue;
    try {
      const hostname = new URL(s.url).hostname.replace(/^www\./, '');
      if (REGISTRY_METADATA_HOSTS.has(hostname) || STRUCTURED_METADATA_HOSTS.has(hostname)) continue;
    } catch {
      continue;
    }
    urlsSeen.add(s.url);
    toRead.push({ index: i, url: s.url });
  }

  if (toRead.length === 0) return { enriched: snippets, pagesRead: 0 };

  const pageResults = await Promise.all(
    toRead.map(({ url }) => readPage(url, timeoutMs, maxChars)),
  );

  let pagesRead = 0;
  const enriched = [...snippets];
  for (let j = 0; j < toRead.length; j++) {
    const pageContent = pageResults[j];
    if (!pageContent || pageContent.length < 100) continue;
    pagesRead++;

    const { index } = toRead[j];
    const original = enriched[index];
    // Merge: use page content (richer) but keep original metadata
    enriched[index] = {
      ...original,
      text: pageContent.slice(0, maxChars),
      // Boost rank for successfully-read pages
      rank: original.rank * 1.3,
    };
  }

  // Re-sort after rank boost
  enriched.sort((a, b) => b.rank - a.rank);
  return { enriched, pagesRead };
}

// ── LRU Cache ──

interface CacheEntry {
  response: SearchResponse;
  timestamp: number;
}

class SearchCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): SearchResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.response;
  }

  set(key: string, response: SearchResponse): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { response, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ── Main Pipeline ──

export class SearchPipeline {
  private readonly config: SearchPipelineConfig;
  private readonly cache: SearchCache;
  private readonly controller = new ThorsenAdaptiveController();
  private onLearn: OnSearchLearn | null = null;

  constructor(config?: Partial<SearchPipelineConfig>) {
    this.config = { ...DEFAULT_SEARCH_CONFIG, ...config };
    this.cache = new SearchCache(this.config.cacheSize, this.config.cacheTtlMs);
  }

  /** Register a callback to learn from search results (used by VaiEngine). */
  setLearnCallback(cb: OnSearchLearn): void {
    this.onLearn = cb;
  }

  /** Build a search plan without executing it (preview). */
  plan(query: string): VaiSearchPlan {
    return buildSearchPlan(query);
  }

  /** Clear the result cache. */
  clearCache(): void {
    this.cache.clear();
  }

  /** Execute the full search pipeline: clarify → fan out → rank → read → cross-check → conclude */
  async search(query: string): Promise<SearchResponse> {
    // Check cache first
    const cacheKey = contentFingerprint(query.toLowerCase());
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        durationMs: 0,
        sync: {
          ...cached.sync,
          latencyMs: 0,
        },
        audit: [
          {
            step: 'fetch',
            detail: `Cache hit: reused ${cached.sources.length} recently verified source${cached.sources.length === 1 ? '' : 's'}`,
            durationMs: 0,
          },
          {
            step: 'conclude',
            detail: 'Reused the recent sourced answer; no new network request was made',
            durationMs: 0,
          },
        ],
      };
    }

    const start = Date.now();
    const audit: AuditEntry[] = [];

    // Step 1: CLARIFY — normalize into structured plan
    const clarifyStart = Date.now();
    const plan = buildSearchPlan(query);
    audit.push({ step: 'clarify', detail: `Intent: ${plan.intent}, entities: [${plan.entities.join(', ')}], ${plan.fanOutQueries.length} sub-queries`, durationMs: Date.now() - clarifyStart });

    // Step 2+3: FAN OUT + FETCH — parallel sub-queries
    const fanOutStart = Date.now();
    const preSnapshot = this.controller.snapshot();
    const adaptiveMaxFanOut = Math.max(1, Math.min(this.config.maxFanOut, preSnapshot.concurrency));
    const adaptiveReadTopN = preSnapshot.state === 'linear'
      ? 1
      : preSnapshot.state === 'parallel'
        ? Math.min(this.config.readTopN, 2)
        : this.config.readTopN;
    const queries = plan.fanOutQueries.slice(0, adaptiveMaxFanOut);
    const allRaw: Array<RawSearchResult & { queryIndex: number }> = [];

    const fetchPromises = queries.map((q, idx) =>
      fetchProviderChain(q, this.config, plan.entities).then(results =>
        results.slice(0, this.config.resultsPerQuery).map(r => ({ ...r, queryIndex: idx })),
      ).catch(() => [] as Array<RawSearchResult & { queryIndex: number }>),
    );

    const batchResults = await Promise.all(fetchPromises);
    for (const batch of batchResults) {
      allRaw.push(...batch);
    }

    audit.push({ step: 'fan-out', detail: `${queries.length} queries, ${allRaw.length} raw results`, durationMs: Date.now() - fanOutStart });

    // Step 4: RANK — score by trust × relevance, deduplicate
    const rankStart = Date.now();
    const ranked = rankSnippets(allRaw, this.config.minTrustScore, query);
    audit.push({ step: 'rank', detail: `${ranked.length} snippets after trust filter + dedup (from ${allRaw.length} raw)`, durationMs: Date.now() - rankStart });

    // Step 5: READ — fetch full page content for top-N results
    const readStart = Date.now();
    const { enriched, pagesRead } = await readTopPages(
      ranked.slice(0, this.config.maxSnippets),
      adaptiveReadTopN,
      this.config.fetchTimeoutMs,
      this.config.maxPageChars,
    );
    audit.push({ step: 'read', detail: `${pagesRead} pages read from top ${Math.min(ranked.length, this.config.maxSnippets)} results`, durationMs: Date.now() - readStart });

    // Step 6: CROSS-CHECK — verify claims across multiple sources
    const crossStart = Date.now();
    const verified = crossCheck(enriched);
    audit.push({ step: 'cross-check', detail: `${verified.length} snippets after cross-check`, durationMs: Date.now() - crossStart });

    // Gate synthesis on relevance to the user's actual ask, not just domain
    // trust. This prevents same-entity but wrong-shape snippets (for example
    // Oslo shooting news for an Oslo population question) from reaching the
    // answer body or the UI source list.
    const relevanceStart = Date.now();
    let relevant = filterRelevantSnippetsForQuery(query, verified);
    audit.push({
      step: 'rank',
      detail: `${relevant.length}/${verified.length} snippets survived relevance + answer-shape gate`,
      durationMs: Date.now() - relevanceStart,
    });

    // Soft fallback: strict gate can drop every snippet (common on DDG-only
    // runs). Prefer a cautious answer from top verified hits over empty sources.
    if (relevant.length === 0 && verified.length > 0) {
      const soft = verified.slice(0, Math.min(3, verified.length));
      const softAnswer = synthesizeAnswer(query, soft, true);
      if (!/didn't find anything|couldn't find useful/i.test(softAnswer)) {
        relevant = soft;
        audit.push({
          step: 'rank',
          detail: `soft-fallback: using ${relevant.length} top verified snippet(s) after strict gate`,
          durationMs: 0,
        });
      }
    }

    // Step 7: CONCLUDE — synthesize answer with citations
    const concludeStart = Date.now();
    const answer = synthesizeAnswer(query, relevant, verified.length > 0);
    audit.push({ step: 'conclude', detail: `Answer synthesized from ${relevant.length} relevant sources`, durationMs: Date.now() - concludeStart });

    // Notify learn callback with top results
    if (this.onLearn) {
      for (const s of relevant.slice(0, 3)) {
        if (s.text.length > 50 && s.trust.tier !== 'untrusted') {
          this.onLearn(s.text.slice(0, 2000), s.url);
        }
      }
    }

    const durationMs = Date.now() - start;
    this.controller.observe(durationMs);
    const sync = this.controller.snapshot();
    const syncState = classifySyncState(durationMs);
    audit.push({
      step: 'conclude',
      detail: `ThorsenCurve=${syncState}, recommendedConcurrency=${sync.concurrency}, median=${sync.medianLatency}ms, p95=${sync.p95Latency}ms`,
      durationMs: 0,
    });

    const response: SearchResponse = {
      answer,
      sources: relevant,
      plan,
      rawResultCount: allRaw.length,
      confidence: computeConfidence(relevant),
      durationMs,
      sync: {
        state: syncState,
        latencyMs: durationMs,
        recommendedConcurrency: sync.concurrency,
        medianLatencyMs: sync.medianLatency,
        p95LatencyMs: sync.p95Latency,
        observations: sync.observations,
      },
      audit,
    };

    // Cache the result (R18: skip caching empty/failed responses so a cold-
    // start or rate-limit blip doesn't poison the 10-minute cache window).
    if (relevant.length > 0) {
      this.cache.set(cacheKey, response);
    }

    return response;
  }
}

// ── Follow-Up Suggestions (Perplexity-style) ──

/**
 * Generate 2-3 follow-up questions based on the search query and results.
 * These help users dig deeper into the topic without reformulating.
 */
export function generateFollowUps(query: string, response: SearchResponse): string[] {
  const normalizedQuery = normalizeFollowUpTopic(query);
  const plan = response.plan;
  const entities = plan.entities
    .map((entity) => sanitizeTopicPhrase(entity))
    .filter((entity) => entity.length > 0)
    .filter((entity) => !ENTITY_STOP_WORDS.has(entity.toLowerCase()))
    .slice(0, 3);
  const primarySource = response.sources[0];
  const sourceTitle = primarySource?.title?.trim() || '';
  const normalizedSourceTitle = sourceTitle.length > 0
    ? normalizeSourceTitleForFollowUps(sourceTitle)
    : normalizeSourceTitleForFollowUps((primarySource?.domain || '').replace(/^www\./, ''));
  const querySubject = cleanQuerySubject(extractPrimarySubject(normalizedQuery || query, entities));
  const fallbackEntity = normalizedSourceTitle
    || response.sources[0]?.domain
    || sanitizeTopicPhrase(query)
    || 'this topic';
  const subjectParts = querySubject.length > 0
    ? [querySubject]
    : (entities.length > 0 ? entities : [fallbackEntity]);
  const topicSeed = sanitizeTopicPhrase(subjectParts.join(' ').trim()) || fallbackEntity;
  const followUps: string[] = [];

  if (query.trim() === '') return [];

  if (/\bvinext\b/i.test(normalizedQuery)) {
    return [
      'Turn this starter into a premium landing page',
      'Add auth and a dashboard shell to this app',
      'When should I pick Vinext over Next.js or plain Vite?',
    ];
  }

  if (/\b(?:version|stable|latest|release|lts)\b/i.test(query) && normalizedSourceTitle.length > 0) {
    followUps.push(`What changed recently in ${normalizedSourceTitle}?`);
    followUps.push(`Migration notes for the current ${normalizedSourceTitle} release`);
    followUps.push(`${normalizedSourceTitle} release notes and breaking changes`);
    return finalizeFollowUps(followUps);
  }

  if (/\b(?:official|docs?|documentation|guide|page|pages)\b/i.test(query) && normalizedSourceTitle.length > 0) {
    followUps.push(`Show me a practical example from ${normalizedSourceTitle}`);
    followUps.push(`Common mistakes people make with ${normalizedSourceTitle}`);
    followUps.push(`What should I read next about ${normalizedSourceTitle}?`);
    return finalizeFollowUps(followUps);
  }

  return generateTopicFollowUps(topicSeed, plan.intent);
}

// touch for reload
// r17 touch
// r18 touch
