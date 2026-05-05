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
import { classifySyncState, ThorsenAdaptiveController } from '../thorsen/types.js';
import { normalizeInputForUnderstanding } from '../input-normalization.js';

// ── Query Normalization (Step 1: CLARIFY) ──

/** Common query intent markers */
const INTENT_PATTERNS: ReadonlyArray<{ pattern: RegExp; intent: string }> = [
  { pattern: /^(what is|what are|what's|define)\b/i, intent: 'definition' },
  { pattern: /^(hva\s+er)\b/i, intent: 'definition' },
  { pattern: /^(how to|how do|how can|how does)\b/i, intent: 'how-to' },
  { pattern: /^(hvordan|korleis)\b/i, intent: 'how-to' },
  { pattern: /^(why|why does|why is|why are|explain|describe)\b/i, intent: 'explanation' },
  { pattern: /^(forklar|beskriv|hvorfor)\b/i, intent: 'explanation' },
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
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'about', 'and', 'but',
  'or', 'if', 'what', 'which', 'who', 'whom', 'this', 'that', 'these',
  'those', 'i', 'me', 'my', 'it', 'its', 'we', 'they', 'search', 'find',
  'look', 'up', 'tell', 'give', 'show', 'get', 'know', 'please', 'explain',
  'describe', 'explained', 'simple', 'words', 'simply', 'include', 'sources',
  'source', 'citation', 'citations', 'references', 'reference',
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
  const trimmed = normalizeCommonTypos(query.trim());
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
    .replace(/^(?:what\s+(?:is|are|was|were)|what's|what\s+do\s+you\s+know(?:\s+(?:about|of|on|regarding))?|do\s+you\s+know(?:\s+(?:about|of|on|regarding))?|have\s+you\s+heard\s+(?:of|about)|define|explain|describe|tell\s+me\s+about|who\s+(?:is|are|was|were)|how\s+(?:does|do)|why\s+(?:does|is|are|would|should)|hva\s+er|forklar|beskriv|fortell\s+meg\s+om|hvordan(?:\s+fungerer)?)\s+/i, '')
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
  const intent = hasComparisonMarkers(lower) ? 'comparison' : (matched?.intent ?? 'general');

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
      return finalizeFollowUps([
        'Narrow this to the strongest recommendation',
        'Show the key trade-offs',
        'Give me the shortest useful version',
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
    case 'comparison':
      if (comparisonSubject) {
        queries.push(`${primarySubject} vs ${comparisonSubject}`);
        queries.push(`${primarySubject} compared to ${comparisonSubject}`);
      }
      queries.push(`${primarySubject} official docs`);
      queries.push(`${primarySubject} pros cons comparison`);
      break;
    case 'recommendation':
      queries.push(`best ${entityStr} 2025`);
      queries.push(`${entityStr} alternatives comparison`);
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

async function fetchDuckDuckGo(query: string, timeoutMs: number): Promise<RawSearchResult[]> {
  const results: RawSearchResult[] = [];
  const primarySubject = extractPrimarySubject(query, []);

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

  // 2. Wikipedia REST API — free, reliable, no key needed, high-quality summaries
  if (results.length < 3) {
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

function looksLikeNoisyUiSentence(sentence: string): boolean {
  if (NOISY_SENTENCE_PATTERN.test(sentence)) return true;
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

function joinReasonLabels(labels: readonly string[]): string {
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
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
  const candidates: Array<{ text: string; sourceIndex: number; score: number }> = [];
  const summaryCandidates: Array<{ text: string; sourceIndex: number; score: number }> = [];
  const reasons: Array<{ label: string; sourceIndex: number }> = [];
  const seenReasonLabels = new Set<string>();

  for (let sourceIndex = 0; sourceIndex < used.length; sourceIndex += 1) {
    const snippet = used[sourceIndex];
    const sentences = splitIntoSentences(snippet.text);

    for (const sentence of sentences) {
      let score = sentenceScore(sentence, query, plan, primarySubject, comparisonSubject);
      score += snippet.trust.tier === 'high' ? 3 : snippet.trust.tier === 'medium' ? 1 : -3;
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
  const summary = summaryCandidates[0] ?? candidates[0] ?? null;
  const supporting: Array<{ text: string; sourceIndex: number }> = [];

  const preferredSupport = plan.intent === 'comparison'
    ? candidates.filter((candidate) => /\b(?:privacy|tracked|profiled|metasearch|aggregates?|self-host|search providers|instant-answer|instant answer|results)\b/i.test(candidate.text) && hasExplanatoryVerb(candidate.text))
    : candidates;

  for (const candidate of preferredSupport) {
    if (supporting.length >= 2) break;
    if (summary && candidate.text === summary.text) continue;
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
  'me','us','them','him','so','just','very','really','about','tell','give','show','say','said','please','some','any','all','no','not','yes',
  'thing','things','stuff','okay','ok','well','um','uh','hey','hi','hello','yo','vai',
]);
function extractContentWords(text: string): Set<string> {
  const out = new Set<string>();
  const tokens = text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [];
  for (const t of tokens) if (!SEARCH_STOPWORDS.has(t)) out.add(t);
  return out;
}
function snippetSharesQueryWords(snippetText: string, queryWords: Set<string>, minHits = 1): boolean {
  if (queryWords.size === 0) return true; // nothing to gate on
  const lower = snippetText.toLowerCase();
  let hits = 0;
  for (const w of queryWords) {
    if (lower.includes(w)) {
      hits++;
      if (hits >= minHits) return true;
    }
  }
  return false;
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

function synthesizeAnswer(query: string, snippets: readonly SearchSnippet[]): string {
  if (snippets.length === 0) {
    return `I searched for "${query}" but couldn't find useful results. Try rephrasing or being more specific.`;
  }

  // Group by trust tier for the summary
  const highTrust = snippets.filter(s => s.trust.tier === 'high');
  const medTrust = snippets.filter(s => s.trust.tier === 'medium');
  const otherTrust = snippets.filter(s => s.trust.tier !== 'high' && s.trust.tier !== 'medium');

  // Build answer from highest trust sources first
  const ordered = [...highTrust, ...medTrust, ...otherTrust];
  const candidatesAll = ordered.slice(0, 8);

  // Honest-audit gate: drop snippets that share too few content words with the
  // query. With ≥2 query content words, require ≥2 hits (in title+text combined)
  // so a single common-word coincidence ("india") cannot pull in an off-topic doc.
  // Also drop README/SEO-style snippets entirely.
  const queryWords = extractContentWords(query);
  const minHits = queryWords.size >= 2 ? 2 : 1;
  const relevantUsed = candidatesAll.filter((s) => {
    if (looksLikeJunkSnippet(s.text, s.title || '')) return false;
    // Body-alone gate: requires minHits-1 (min 1) hit in the snippet text so
    // JWST-style bodies that say "the telescope uses infrared optics" (1 hit)
    // aren't blocked even though the TITLE already supplies the second hit.
    // The combined (title+text) gate below is the strict gate.
    const bodyMinHits = Math.max(1, minHits - 1);
    if (queryWords.size > 0 && !snippetSharesQueryWords(s.text, queryWords, bodyMinHits)) return false;
    const combined = `${s.title || ''} \n ${s.text}`;
    return snippetSharesQueryWords(combined, queryWords, minHits);
  });
  if (relevantUsed.length === 0) {
    return `I searched for "${query}" but didn't find anything that actually matches. The web results were off-topic, so I'm not going to invent an answer. Try rephrasing or being more specific.`;
  }
  const used = relevantUsed.slice(0, 5);

  const lines: string[] = [];
  const { plan, primarySubject, comparisonSubject, summary, supporting, reasons } = buildEvidenceSummary(query, used);
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
  const prefersSimpleFraming = /\b(?:explain|definition|what is|what are|in simple words?)\b/i.test(query)
    || plan.intent === 'definition'
    || plan.intent === 'explanation';
  const asksWhatItDoes = /\bwhat\s+it\s+does\b/i.test(query) || plan.intent === 'definition' || plan.intent === 'explanation';
  const asksWhenToUse = /\b(?:when\s+should\s+i\s+use|when\s+to\s+use|best\s+fit|should\s+use\s+it|when\s+should\s+you\s+use)\b/i.test(query);

  if (effectiveSummary) {
    lines.push(`${effectiveSummary.text} ${collectCitationMarks([effectiveSummary.sourceIndex])}`.trim());
  } else {
    const fallbackSource = used[0];
    const fallbackText = sanitizeSnippetText(fallbackSource.text);
    const snippetText = fallbackText.length > 220 ? `${fallbackText.slice(0, 220)}...` : fallbackText;
    lines.push(`${snippetText} ${collectCitationMarks([0])}`.trim());
  }

  // Filter out the suppressed (off-topic) lead from supporting if it slipped in.
  const supportingFiltered = suppressedLeadText
    ? supporting.filter((entry) => entry.text !== suppressedLeadText)
    : supporting;

  if (prefersSimpleFraming && supportingFiltered.length > 0) {
    const simpleLead = supportingFiltered[0];
    lines.push('');
    lines.push('In simple words');
    lines.push(`${simpleLead.text} ${collectCitationMarks([simpleLead.sourceIndex])}`.trim());
  }

  if (plan.intent === 'comparison' && comparisonSubject) {
    if (reasons.length > 0) {
      const reasonSentence = `The strongest reasons to prefer ${titleCaseSubject(primarySubject)} over ${comparisonSubject} are ${joinReasonLabels(reasons.map((reason) => reason.label))}. ${collectCitationMarks(reasons.map((reason) => reason.sourceIndex))}`;
      lines.push('');
      lines.push(reasonSentence.trim());
    }

    if (supportingFiltered.length > 0) {
      lines.push('');
      lines.push('Key evidence:');
      for (const entry of supportingFiltered) {
        lines.push(`- ${entry.text} ${collectCitationMarks([entry.sourceIndex])}`.trim());
      }
    }
  } else if (supportingFiltered.length > 0) {
    lines.push('');
    const remainingSupport = prefersSimpleFraming ? supportingFiltered.slice(1) : supportingFiltered;
    const sectionHeading = asksWhatItDoes
      ? 'What it does:'
      : asksWhenToUse
        ? 'Best fit:'
        : 'Key points:';
    if (remainingSupport.length > 0) {
      lines.push(sectionHeading);
      for (const entry of remainingSupport) {
        lines.push(`- ${entry.text} ${collectCitationMarks([entry.sourceIndex])}`.trim());
      }
    }
  }

  lines.push('');
  lines.push('**Sources**');
  for (let i = 0; i < used.length; i++) {
    const s = used[i];
    const title = s.title || s.domain;
    lines.push(`${i + 1}. [${title}](${s.url})`);
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
    validateSearchUrl(url); // SSRF check
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'VeggaAI/0.1 (Local AI Learning Agent)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
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
      if (REGISTRY_METADATA_HOSTS.has(hostname)) continue;
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
    if (cached) return cached;

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

    // Step 7: CONCLUDE — synthesize answer with citations
    const concludeStart = Date.now();
    const answer = synthesizeAnswer(query, verified);
    audit.push({ step: 'conclude', detail: `Answer synthesized from ${verified.length} sources`, durationMs: Date.now() - concludeStart });

    // Notify learn callback with top results
    if (this.onLearn) {
      for (const s of verified.slice(0, 3)) {
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
      sources: verified,
      plan,
      rawResultCount: allRaw.length,
      confidence: computeConfidence(verified),
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

    // Cache the result
    this.cache.set(cacheKey, response);

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
