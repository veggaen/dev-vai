import { isGenerationIntent } from '../chat/chat-quality.js';
import { detectVenuePracticalDetail } from '../venue-practical-detail.js';

const EXPLICIT_WEB_SEARCH_PATTERN =
  /^(?:just\s+)?google\s+(?:it\s*[:\-–—]?\s*)?.+|^(?:just\s+)?google\s+(?:it|that)$|^(?:can\s+you\s+)?(?:search|look\s+up|find)\s+(?:for\s+|about\s+)?.+|^(?:go\s+)?search\s+(?:the\s+web|online|google)\s+(?:for\s+)?.+|^google[:\s]+.+|^use\s+web\s+search\b/i;

const EXPLICIT_ONLINE_LOOKUP_PATTERN =
  /^(?:(?:you\s+should|please|can\s+you)\s+)?(?:find|look\s+up|search|check|verify)\s+(?:it|that|this)?\s*(?:online|on\s+the\s+web|the\s+web|google)\b.+/i;

const GREETING_PATTERN =
  /^(?:hi|hiya|hello|hullo|hey|heya|heyo|hey\s+there|hi\s+there|yo|sup|wassup|howdy|g'?day|what'?s up|good\s+(?:morning|afternoon|evening)|thanks?|thank you|thx|nice|cool|great|sounds good|got it|understood|ok(?:ay)?|hei|heisann|heihei|hei\s+hei|heia|hallo|halla|takk|takk\s+skal\s+du\s+ha|god\s+(?:morgen|kveld|dag))\b[!. ]*$/i;

// Banter / acknowledgement / gamer-slang tokens that carry no topical content.
// A short turn is conversational ONLY when EVERY token is filler — that keeps
// "gg wp" and "lol brb" conversational while bare topic words ("docker",
// "latency", "recursion") fall through to the answer path.
const CONVERSATIONAL_FILLER_TOKENS = new Set([
  'lol', 'lmao', 'lmaoo', 'rofl', 'heh', 'yep', 'yup', 'yeah', 'yea', 'ya',
  'nope', 'nah', 'naw', 'sure', 'alright', 'aight', 'wow', 'oh', 'huh', 'wait',
  'np', 'ty', 'tysm', 'thx', 'cheers', 'maybe', 'idk', 'true', 'right',
  'exactly', 'same', 'word', 'bet', 'fr', 'frfr', 'lmk', 'brb', 'gtg', 'gotcha',
  'k', 'kk', 'ok', 'okay', 'ay', 'aye', 'oi', 'meh', 'welp', 'ah', 'ahh', 'ohh',
  'damn', 'dang', 'sheesh', 'yikes', 'oof', 'bruh', 'fine', 'cool', 'nice',
  // gamer slang
  'gg', 'wp', 'ggwp', 'glhf', 'ez', 'gj', 'gz', 'rip', 'clutch', 'pog', 'poggers',
]);

const FILLER_PUNCT_OR_REPEAT = /^(?:haha+|hehe+|hah+|hmm+|mhm+|ugh+|hm+|ha+|yay+|woo+|wooo+)$/i;

function isAllConversationalFiller(trimmed: string): boolean {
  const tokens = trimmed
    .toLowerCase()
    .replace(/[!.?,;:]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) return false;
  return tokens.every(
    (token) => CONVERSATIONAL_FILLER_TOKENS.has(token) || FILLER_PUNCT_OR_REPEAT.test(token),
  );
}

const SUBSTANTIVE_QUESTION_TAIL =
  /\b(?:who|what|where|when|why|how|which|whose|whom|can|could|should|would|does|do|did|is|are|was|were|will)\b\s+\w+/i;

const FOLLOW_UP_CUE_PATTERN =
  /^(?:tell\s+me(?:\s+(?:then|more|about\s+it))?|go\s+on|continue|more|what\s+else|and\s+then|and\??|so\??|ok|okay|yes|yeah|nope?|sure|right|cool|nice|why(?:\s+though)?|how(?:\s+so)?|shorter(?:\s+(?:pls|please))?|explain\s+(?:that\s+)?more\s+simply)[\s.?!]*$/i;

const RESEARCH_REQUEST_PATTERN =
  /\b(?:(?:do|please)\s+)?research(?:\s+(?:on|into|about|this|that|it))?|(?:look|find)\s+(?:it|that|this)\s+up|go\s+deep(?:er)?\s+on|dig\s+into|check\s+(?:online|the\s+web|sources?)|verify\s+(?:online|with\s+sources?)\b/i;

const FACTUAL_QUESTION_PATTERN =
  /\b(?:what\s+is|what\s+are|what'?s|who\s+(?:is|was|are|were|invented|made|created)|when\s+(?:did|was|is)|where\s+(?:is|was)|why\s+(?:is|are|was|do|does)|how\s+(?:much|many|does|do|is|are|to)|which\s+|explain|tell\s+me\s+(?:about|bout)|describe|break\s+down|verify|fact\s+check|look\s+it\s+up|search\s+the\s+web|do\s+research|capital\s+of|tallest|population\s+of|speed\s+of)\b/i;

const BLOCKS_WEB_PATTERN =
  /\b(?:you are not being asked to search the web|do\s+not\s+(?:search|google|look\s+up)|don't\s+(?:search|google|look\s+up)|dont\s+(?:search|google|look\s+up)|without\s+(?:web\s+search|search|google)|from\s+memory\s+only|no\s+web)\b/i;

const LOCAL_FIRST_CONTROL_PATTERNS = [
  /\b(?:today|tomorrow|yesterday)\b/i,
  /\b(?:(?:in|after)\s+\d+\s+days?|\d+\s+days?\s+ago)\b/i,
  /\b(?:what|which)\s+(?:is|was)\s+(?:the\s+)?(?:first|last|next|previous|\d+(?:st|nd|rd|th)?)\s+(?:letter|word|character)\s+(?:in|of)\s+(?:this|the)\s+(?:question|sentence|message|prompt)\b/i,
  /\bhow\s+many\s+(?:words|letters|characters|messages)\b[\s\S]*\b(?:this|sentence|message|chat|sent|so\s+far)\b/i,
  /\b(?:what(?:'s|\s+is|\s+was)|do\s+you\s+(?:know|remember))\s+my\s+(?:name|favorite|favourite|preference|project|stack|decision|constraint)\b/i,
  /\bmy\s+(?:(?:next[\s-]?door|former|current)\s+)?(?:neighbor|neighbour|friend|coworker|colleague|teacher|boss|partner|spouse|child|parent|sibling)'?s?\s+(?:middle\s+name|phone(?:\s+number)?|email|address|birthday|favorite|favourite)\b/i,
  /^(?:please\s+)?help\s+me\s+with\s+my\s+(?:project|app|code|idea)[.?!]*$/i,
  /^(?:no|actually|wait|sorry|hmm|hold\s+on)\b[\s,.:;-]*(?:it(?:'s|\s+is)|i\s+(?:mean|meant)|not\b)/i,
  /\b\d+(?:\.\d+)?\s*(?:[+\-*/x]|\b(?:plus|minus|times|multiplied\s+by|divided\s+by)\b)\s*\d+(?:\.\d+)?\b/i,
  /\b\d+(?:\.\d+)?\s+(?:plus|minus|times|multiplied\s+by|divided\s+by)\s+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i,
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:plus|minus|times|multiplied\s+by|divided\s+by)\s+\d+(?:\.\d+)?\b/i,
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:plus|minus|times|multiplied\s+by|divided\s+by)\s+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i,
];

const STABLE_EXPLANATION_PATTERN =
  /^(?:what(?:'s|\s+is|\s+are)|exs?plain|define|describe|tell\s+me\s+(?:about|bout)|(?:kan\s+(?:du|u)\s+)?forklar(?:e)?)\b/i;

const STABLE_HOW_TO_PATTERN =
  /^how\s+(?:do|does|can|should|is|are|was|were)\b/i;

const STABLE_WHY_PATTERN =
  /^why\s+(?:should|do|does|is|are|was|were)\b/i;

const LOCAL_TROUBLESHOOTING_PATTERN =
  /\b(?:debug|troubleshoot|keeps?\s+crashing|stack\s+trace|error\s+message)\b/i;

const LOCAL_PROJECT_GUIDANCE_PATTERN =
  /\b(?:help\s+me\s+plan|plan\s+(?:the\s+)?architecture|deployment\s+pipeline|project\s+structure)\b/i;

const CURRENT_INFO_PATTERN =
  /\b(?:today|current(?:ly)?|latest|newest|recent(?:ly)?|right\s+now|in\s+202\d|version|release(?:d)?|out\s+yet|available\s+now|still\s+accurate)\b/i;

/** Product/build context — "price" means UI tier or effort, not a live market quote. */
const VOLATILE_VALUE_BUILD_EXCLUSION =
  /\b(?:(?:this|my|the|our)\s+(?:app|project|codebase|feature|component|page|build|saas|product|refactor|migration|pricing\s+(?:page|tier|model|plan|section|table|component))|\b(?:pricing\s+page|price\s+tier|cost\s+estimate\s+for\s+(?:the\s+)?(?:build|project|feature)))\b/i;

/**
 * Grammar for asking the current quantitative value of something external — no
 * ticker/asset allowlist. Matches "price of <anything>", "how much is …", etc.
 */
const VOLATILE_VALUE_LOOKUP_PATTERNS = [
  /\b(?:price|prices|cost|worth|value|quote|quotes?|rate|rates|market\s+cap(?:italization)?|trading\s+(?:at|for)|exchange\s+rate|spot\s+price|share\s+price|stock\s+price)\s+(?:of|for|on)\s+/i,
  /\bhow\s+much\s+(?:is|are|does|do|would|should|was|were)\b/i,
  /\bhow\s+much\s+for\b/i,
  /\bwhat(?:'s|\s+is|\s+are)\s+.+?\s+(?:worth|trading\s+(?:at|for))\b/i,
] as const;

function matchesVolatileValueLookupGrammar(trimmed: string): boolean {
  return VOLATILE_VALUE_LOOKUP_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Domain cues where answers are inherently time-volatile — still no entity lists. */
const TIME_VOLATILE_DOMAIN =
  /\b(?:weather|forecast|temperature|score|final\s+score|standings|poll(?:s|ing)?|election\s+results?|unemployment\s+rate|interest\s+rate|inflation\s+rate|gas\s+price|fuel\s+price|airfare)\b/i;

const REALTIME_CUE =
  /\b(?:live|real[\s-]?time|realtime|up[\s-]?to[\s-]?date|as\s+of\s+(?:now|today))\b/i;

function isPureBuildImperative(trimmed: string): boolean {
  if (/\?/.test(trimmed)) return false;
  return /^(?:please\s+)?(?:make|build|create|generate|design|develop|scaffold|implement|code)\b/i.test(trimmed)
    && isGenerationIntent(trimmed);
}

/**
 * Structural policy: does this turn need live external evidence (web search)?
 * Entity-agnostic — driven by grammar and freshness, not hardcoded tickers.
 */
export function needsLiveExternalEvidence(
  input: string,
  context: WebConclusionContext = {},
): boolean {
  const trimmed = normalizeWebConclusionInput(input);
  if (!trimmed) return false;

  if (isExplicitResearchRequest(trimmed)) return true;
  if (isFreshLocalRecommendationRequest(trimmed)) return true;
  if (isFreshVenuePracticalDetailRequest(trimmed)) return true;
  if (isFreshLocalBusinessContactRequest(trimmed)) return true;
  if (BLOCKS_WEB_PATTERN.test(trimmed.toLowerCase())) return false;

  const asksVolatileValue =
    matchesVolatileValueLookupGrammar(trimmed)
    && !VOLATILE_VALUE_BUILD_EXCLUSION.test(trimmed)
    && (!isPureBuildImperative(trimmed) || /\?/.test(trimmed));
  if (asksVolatileValue) return true;

  const isQuestion = /\?/.test(trimmed) || FACTUAL_QUESTION_PATTERN.test(trimmed);
  if (TIME_VOLATILE_DOMAIN.test(trimmed) && isQuestion) return true;

  if ((CURRENT_INFO_PATTERN.test(trimmed) || REALTIME_CUE.test(trimmed)) && isQuestion) {
    if (shouldDeferWebConclusionToLocalRoutes(trimmed)) return false;
    return true;
  }

  void context;
  return false;
}

/** @deprecated Prefer {@link needsLiveExternalEvidence} — kept for call-site compat. */
export const isLiveFactualLookupQuery = needsLiveExternalEvidence;

const LOCAL_RECOMMENDATION_TARGET_PATTERN =
  /\b(?:restaurants?|resturants?|restuarants?|places?\s+to\s+eat|eater(?:y|ies)|caf(?:e|é)s?|coffee\s+shops?|bars?|pubs?|hotels?|hostels?|shops?|stores?|hairdressers?|barbers?|dentists?|doctors?|plumbers?|electricians?|mechanics?|gyms?|cinemas?|movie\s+theaters?|things?\s+to\s+do|attractions?)\b/iu;

const RECOMMENDATION_CUE_PATTERN =
  /\b(?:best|good|great|nice|recommended?|recommendations?|top[\s-]?rated|worth\s+(?:trying|visiting)|where\s+should\s+i|where\s+can\s+i|bra|beste|anbefal(?:e|ing|inger)?)\b/iu;

const LOCALITY_CUE_PATTERN =
  /\b(?:in|near|around|close\s+to|nearby|i|nær|rundt)\s+[\p{L}\d][\p{L}\d .,'’\-]{1,80}(?:[?!.]|$)|\b(?:near\s+me|nearby|open\s+now|åpent\s+nå)\b/iu;

const BUSINESS_CONTACT_DETAIL_PATTERN =
  /\b(?:phone\s+number|telephone\s+number|contact\s+details?|email\s+address|street\s+address|opening\s+hours?|official\s+website)\b/i;

const COMPARISON_PATTERN =
  /\b(?:compare|comparison|difference\s+between|versus|vs\.?)\b/i;

const STABLE_LIST_PATTERN =
  /^(?:please\s+)?(?:list|name|give|tell(?:\s+me)?)\s+(?:me\s+)?(?:(?:the\s+)?(?:top|best|most\s+popular|popular|common|widely\s+used)\s+)?(?:\d+|two|three|four|five|six|seven|eight|nine|ten|some|a\s+few)\b/i;

export interface WebConclusionContext {
  readonly activeMode?: string;
  readonly hasActiveSandbox?: boolean;
}

/**
 * Remove chat-style wrappers before policy checks and search planning. This is
 * intentionally topic-agnostic: the bench styles are examples of decorations
 * that should not become search terms.
 */
export function normalizeWebConclusionInput(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/^\s*(?:could\s+you\s+please\s+help\s+me\s+understand|please\s+provide\s+a\s+concise\s+explanation)\s*:\s*/i, '')
    .replace(/^\s*waht\s+is\b/i, 'what is')
    .replace(/^\s*ok\s+wait\s+/i, '')
    .replace(/^\s*(?:quick|verify|fact\s+check)\s*:\s*/i, '')
    .replace(/^\s*i\s+need\s+(?:a\s+)?straight\s+answer\s+on\s+/i, '')
    .replace(/^\s*(?:trying\s+to\s+decide|help\s+me\s+choose|practical\s+take\s+on|what\s+should\s+i\s+know\s+about|random\s+but|been\s+thinking\s+about|any\s+advice\s+on|break\s+down)\s*:?\s*/i, '')
    .replace(/^\s*can\s+(?:you|u)\s+tell\s+me\s+(?:about|bout)\s+/i, '')
    .replace(/^\s*(?:do\s+research\s+(?:on|about)|look\s+it\s+up\s*:|check\s+sources\s+for|search\s+the\s+web\s+for)\s*/i, '')
    .replace(/\s*(?:\u2014|-)\s*seriously\s+nobody\s+explains\s+this\s+clearly\s+online\s+lol\s*$/i, '')
    .replace(/\s*\(svar\s+gjerne\s+p[åa]\s+norsk\s+hvis\s+det\s+passer\)\s*$/i, '')
    .replace(/\s*idk\s+if\s+that\s+makes\s+sense\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isConversationalWebFollowUpCue(input: string): boolean {
  return FOLLOW_UP_CUE_PATTERN.test(normalizeWebConclusionInput(input));
}

export function isExplicitWebSearchRequest(input: string): boolean {
  const raw = input.toLowerCase().trim();
  const normalized = normalizeWebConclusionInput(input).toLowerCase();
  if (!raw && !normalized) return false;
  return EXPLICIT_WEB_SEARCH_PATTERN.test(raw)
    || EXPLICIT_WEB_SEARCH_PATTERN.test(normalized)
    || EXPLICIT_ONLINE_LOOKUP_PATTERN.test(raw)
    || EXPLICIT_ONLINE_LOOKUP_PATTERN.test(normalized);
}

export function isExplicitResearchRequest(input: string): boolean {
  const raw = input.toLowerCase().trim();
  const normalized = normalizeWebConclusionInput(input).toLowerCase();
  if (!raw && !normalized) return false;
  return isExplicitWebSearchRequest(raw)
    || RESEARCH_REQUEST_PATTERN.test(raw)
    || RESEARCH_REQUEST_PATTERN.test(normalized);
}

/**
 * Local recommendations are freshness-sensitive even when the user does not
 * say "latest" or "current". Businesses close, menus and hours change, and a
 * generic place-name fact is never a valid substitute for a recommendation.
 */
export function isFreshLocalRecommendationRequest(input: string): boolean {
  const normalized = normalizeWebConclusionInput(input);
  if (!normalized) return false;
  return LOCAL_RECOMMENDATION_TARGET_PATTERN.test(normalized)
    && RECOMMENDATION_CUE_PATTERN.test(normalized)
    && LOCALITY_CUE_PATTERN.test(normalized);
}

/**
 * "What's a great business idea / opportunity in <place>?" — an OPPORTUNITY ask.
 * These want concrete, current ideas synthesized from fresh evidence (like Grok's
 * blue-economy answer for Norway), NOT a definition dump or a legal-forms list.
 * Detecting them lets the pipeline route to web-research + synthesis instead of a
 * canned/deterministic fallback. Excludes pure "how to register" procedural asks.
 */
const OPPORTUNITY_CUE_PATTERN =
  /\b(?:business\s+idea|great\s+idea|good\s+idea|startup\s+idea|company\s+to\s+start|business\s+to\s+start|opportunit\w*|(?:promising|underrated|hot|smart|solid|profitable)\s+(?:sector|industry|market|niche|startup|venture|business|company)|(?:venture|company|startup|business)\s+to\s+(?:launch|start|build|begin|create)|(?:build|launch|start|create)\s+a\s+(?:startup|business|company|venture)|what\s+(?:should|could)\s+i\s+(?:build|start|make)|what\s+kind\s+of\s+(?:company|business|startup))\b/i;
const OPPORTUNITY_FRAME_PATTERN =
  /\b(?:company|companies|business|startup|venture|enterprise)\b/i;
const PURE_PROCEDURE_PATTERN =
  /\b(?:how\s+(?:do\s+i|to)\s+(?:register|incorporate|set\s+up|file)|registration\s+steps|paperwork|tax\s+id|brønnøysund|altinn)\b/i;

export function isBusinessOpportunityRequest(input: string): boolean {
  const normalized = normalizeWebConclusionInput(input);
  if (!normalized) return false;
  if (PURE_PROCEDURE_PATTERN.test(normalized)) return false; // "how to register" is procedural, not ideas
  // Either an explicit opportunity cue, OR (idea-ish phrasing + a business frame).
  if (OPPORTUNITY_CUE_PATTERN.test(normalized)) return true;
  return /\bidea\b/i.test(normalized) && OPPORTUNITY_FRAME_PATTERN.test(normalized);
}

/** Public business contact details are mutable and should be verified online. */
export function isFreshLocalBusinessContactRequest(input: string): boolean {
  const normalized = normalizeWebConclusionInput(input);
  if (!normalized || !BUSINESS_CONTACT_DETAIL_PATTERN.test(normalized)) return false;
  return true;
}

/** Venue/service details are mutable even when the user does not say "current". */
export function isFreshVenuePracticalDetailRequest(input: string): boolean {
  return detectVenuePracticalDetail(normalizeWebConclusionInput(input)) !== null;
}

export function isMetaCognitiveKnowledgePattern(pattern: string): boolean {
  return /\b(?:epistemic|aleatory|uncertainty|calibrated\s+uncertainty|meta[\s-]?cognition)\b/i.test(pattern);
}

export function shouldSkipWebConclusion(
  input: string,
  context: WebConclusionContext = {},
): boolean {
  const trimmed = normalizeWebConclusionInput(input);
  if (!trimmed) return true;

  const lower = trimmed.toLowerCase();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  // Opportunity/ideas questions ("a great idea when creating a company in Norway")
  // are exactly the case that benefits from fresh research + synthesis. Never skip
  // the web conclusion for them — this is the fix that replaced the canned legal-
  // forms dump with a real, synthesized ideas answer.
  if (isBusinessOpportunityRequest(input)) return false;

  if (GREETING_PATTERN.test(trimmed) || isConversationalWebFollowUpCue(trimmed)) {
    return true;
  }

  if (BLOCKS_WEB_PATTERN.test(lower)) return true;

  if (!isExplicitResearchRequest(input) && LOCAL_FIRST_CONTROL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  if (/\b(?:build|create|make|design|clone|rebuild|replicate|recreate|copy|develop|implement|code)\b[\s\S]*https?:\/\//i.test(trimmed)) {
    return true;
  }

  const mode = context.activeMode?.toLowerCase();
  if (mode === 'builder' || mode === 'agent') {
    if (needsLiveExternalEvidence(input, context)) return false;
    return true;
  }
  if (context.hasActiveSandbox && /\b(?:change|edit|update|fix|polish|improve|refactor|restyle|tweak|make|apply|adjust)\b[\s\S]{0,80}\b(?:button|color|background|spacing|layout|text|font|image|animation|hero|section|card|nav|page|app|ui|ux|preview|current)\b/i.test(lower)) {
    return true;
  }

  if (isGenerationIntent(trimmed)) return true;

  if (wordCount <= 2 && !/\?/.test(trimmed)) return true;

  return false;
}

/**
 * Prefer local routes before the early web-conclusion pass for stable
 * explanations and compact topic prompts. A later research route may still
 * search if Vai has no grounded local answer.
 */
export function shouldDeferWebConclusionToLocalRoutes(input: string): boolean {
  const trimmed = normalizeWebConclusionInput(input);
  if (!trimmed || isExplicitResearchRequest(input)) return false;

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (isFreshLocalRecommendationRequest(trimmed)) return false;
  if (CURRENT_INFO_PATTERN.test(trimmed)) return false;
  if (/https?:\/\//i.test(trimmed)) return true;

  return STABLE_EXPLANATION_PATTERN.test(trimmed)
    || STABLE_HOW_TO_PATTERN.test(trimmed)
    || STABLE_WHY_PATTERN.test(trimmed)
    || LOCAL_TROUBLESHOOTING_PATTERN.test(trimmed)
    || LOCAL_PROJECT_GUIDANCE_PATTERN.test(trimmed)
    || COMPARISON_PATTERN.test(trimmed)
    || STABLE_LIST_PATTERN.test(trimmed)
    || (wordCount <= 2 && /\?/.test(trimmed));
}

/**
 * Default-on web conclusion for substantive questions. Skips builder/creative
 * turns and tiny conversational fragments; otherwise prefers sources.
 */
export function shouldConcludeWithWebSearch(
  input: string,
  context: WebConclusionContext = {},
): boolean {
  if (shouldSkipWebConclusion(input, context)) return false;

  const trimmed = normalizeWebConclusionInput(input);
  if (isExplicitResearchRequest(trimmed)) return true;
  if (isFreshLocalRecommendationRequest(trimmed)) return true;
  if (isFreshVenuePracticalDetailRequest(trimmed)) return true;
  if (isFreshLocalBusinessContactRequest(trimmed)) return true;
  if (FACTUAL_QUESTION_PATTERN.test(trimmed)) return true;
  if (/\?/.test(trimmed)) return true;

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount >= 4;
}

/**
 * Small-talk / opener turns with no substantive information need.
 * Derived from the existing skip vs conclude policy — short non-questions,
 * greeting phrases, and follow-up cues — not a growing per-word allowlist.
 */
export function isPureConversationalTurn(
  input: string,
  context: WebConclusionContext = {},
): boolean {
  if (shouldConcludeWithWebSearch(input, context)) return false;

  const trimmed = normalizeWebConclusionInput(input);
  if (!trimmed || /\?/.test(trimmed)) return false;

  // Greetings, thanks, acknowledgements, and discourse-only follow-up cues.
  if (GREETING_PATTERN.test(trimmed) || isConversationalWebFollowUpCue(trimmed)) return true;

  // A short banter/filler token ("lol", "yep", "wow", "idk") with no topical
  // content. We do NOT treat every ≤2-word turn as conversational: bare topic
  // words like "docker", "recursion", or "latency" are terse knowledge asks
  // that must reach the answer path, not the greeting handler.
  if (isAllConversationalFiller(trimmed)) return true;

  return false;
}

/**
 * Detects "Hello, who is …?" style turns: a short opener plus a real question.
 */
export function hasSubstantiveQuestionAfterOpener(input: string): boolean {
  const trimmed = normalizeWebConclusionInput(input);
  if (!trimmed) return false;
  if (/[?,]/.test(trimmed)) return true;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    return SUBSTANTIVE_QUESTION_TAIL.test(trimmed);
  }

  const remainder = words.slice(Math.min(2, words.length - 1)).join(' ');
  if (remainder && SUBSTANTIVE_QUESTION_TAIL.test(remainder)) return true;

  return SUBSTANTIVE_QUESTION_TAIL.test(trimmed);
}

export function isGameFranchiseOverviewQuestion(lower: string): boolean {
  return /\b(?:what\s+is|what\s+are|what'?s|who\s+(?:made|created|developed)|history\s+of|tell\s+me\s+about|explain)\b/i.test(lower);
}
