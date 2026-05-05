/**
 * ConversationFacts — extracts durable facts from a chat history and answers
 * fact-recall questions deterministically. Stateless. Re-runs on every turn.
 *
 * Companion to `meta-router.ts`:
 *   - meta-router answers questions *about the chat* ("first message", "count")
 *   - this module answers questions *about durable user-stated facts* in the
 *     chat ("what's my project's name", "what stack did I pick", "what did I
 *     decide", "what did I tell you to never do")
 *
 * Why stateless re-extraction instead of a DB store (Thorsen):
 *   - Trust layer 1 (Types): inputs and outputs are fully typed and readonly.
 *   - Trust layer 2 (Consistency): one canonical extractor — no drift between
 *     a "stored facts" cache and the conversation transcript.
 *   - Trust layer 3 (Coverage): pure function ⇒ unit-testable end-to-end.
 *   - Trust layer 4 (Semantics): facts are always derived from the source of
 *     truth (the persisted messages), so they cannot go stale.
 *   - Trust layer 5 (Security): no new persistence boundary, no migration.
 *
 * Caching can be layered later if profiling demands it. The extractor is
 * intentionally cheap (regex passes over user turns only).
 */

export interface FactsHistoryMessage {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
}

export interface ProjectFact {
  /** Project name as the user wrote it (case preserved). */
  readonly name: string;
  /** Free-form descriptors written near the name (kind, theme, vibe). */
  readonly descriptors: readonly string[];
  /** Stack keywords attributed to THIS project (turns where it was active). */
  readonly stacks: readonly string[];
  /** 1-based user-turn index where the project was first introduced. */
  readonly firstSeenTurn: number;
}

export interface DecisionFact {
  /** The locked-in choice as written by the user. */
  readonly choice: string;
  /** The category if extractable (e.g. "styling", "stack"). */
  readonly category: string | null;
  readonly turn: number;
}

export interface ConstraintFact {
  /** Verbatim constraint text from the user's message. */
  readonly text: string;
  /** Coarse category for downstream filtering. */
  readonly kind: 'must' | 'must-not' | 'preference';
  readonly turn: number;
}

export interface IterationChange {
  /** The change request the user issued (paraphrased to a clean sentence). */
  readonly request: string;
  readonly turn: number;
}

export interface ConversationFacts {
  readonly projects: readonly ProjectFact[];
  readonly stacks: readonly string[];
  readonly featureNames: readonly string[];
  readonly decisions: readonly DecisionFact[];
  readonly constraints: readonly ConstraintFact[];
  readonly iterationChanges: readonly IterationChange[];
}

export interface FactRecallResult {
  readonly reply: string;
  readonly intent:
    | 'project-name'
    | 'project-stack'
    | 'project-features'
    | 'project-current'
    | 'project-first'
    | 'project-list'
    | 'project-by-name'
    | 'project-stack-named'
    | 'decision'
    | 'constraint'
    | 'last-change'
    | 'iteration-list'
    | 'iteration-count'
    | 'iteration-first'
    | 'project-summary';
}

// ─── Extraction ──────────────────────────────────────────────

const PROJECT_INTRO_PATTERNS: readonly RegExp[] = [
  /\b(?:building|build|make|making|creating|started|working\s+on)\s+(?:a\s+|an\s+|the\s+|my\s+)?(?:(?:new\s+)?(?:project\s+(?:called\s+)?)?)?["']?([A-Z][\w&-]{2,30})["']?/gi,
  /\bproject\s*(?:name)?\s*[:=]\s*["']?([A-Z][\w&-]{2,30})["']?/gi,
  /\b(?:project|app|tool|service|product)\s+(?:called|named)\s+["']?([A-Z][\w&-]{2,30})["']?/gi,
  /\b(?:I\s+want\s+to\s+build|let's\s+build)\s+(?:a\s+|an\s+|the\s+)?(?:[a-z]+\s+){0,3}(?:called\s+)?["']?([A-Z][\w&-]{2,30})["']?/gi,
  // General "called <Name>" / "named <Name>" — captures things like
  // "a coffee shop called Brewline" where the noun isn't project/app/tool.
  /\b(?:called|named)\s+["']?([A-Z][\w&-]{2,30})["']?/gi,
];

const STACK_KEYWORDS: readonly string[] = [
  'Next.js', 'NextJS', 'Nuxt', 'SvelteKit', 'Astro', 'Remix', 'Vite', 'React', 'Vue',
  'Svelte', 'Solid', 'Qwik', 'Angular', 'Express', 'Hono', 'Fastify', 'Koa',
  'Prisma', 'Drizzle', 'Kysely', 'TypeORM', 'Sequelize', 'Mongoose',
  'Postgres', 'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'Supabase', 'PlanetScale',
  'Tailwind', 'TailwindCSS', 'Bootstrap', 'shadcn', 'Radix', 'Mantine', 'ChakraUI',
  'Lucia', 'NextAuth', 'Auth.js', 'Clerk', 'Auth0', 'Firebase',
  'tRPC', 'GraphQL', 'REST', 'gRPC',
  'TypeScript', 'JavaScript', 'Python', 'Rust', 'Go', 'Bun', 'Deno', 'Node',
  'Vercel', 'Netlify', 'Cloudflare', 'AWS', 'Fly.io',
];

const STACK_INTRO_PATTERNS: readonly RegExp[] = [
  /\bstack\s*[:=]?\s*([A-Za-z0-9 .+,/&-]+?)(?:[.\n]|$)/gi,
  /\b(?:using|use|with|on)\s+([A-Z][A-Za-z0-9.+&-]+(?:\s*\+\s*[A-Z][A-Za-z0-9.+&-]+)+)/g,
];

const FEATURE_NAME_PATTERN =
  /\b(?:main\s+feature|feature|module|component)\s+(?:is\s+|called\s+|named\s+)?["']([\w &-]{2,40})["']/gi;

const DECISION_PATTERNS: readonly RegExp[] = [
  /\b(?:decision|decided|going\s+with|chose|choose|picking|picked|locked\s+in|let's\s+go\s+with|I'(?:m|ll)\s+going\s+with|I'm\s+choosing|commit(?:ted|ting)?\s+to)\s*[:=]?\s*([\w][\w +.&/-]{1,80}?)(?:[.\n]|\s+(?:and|but|because|since)\b|$)/gi,
  /\bgoing\s+with\s+the\s+([\w][\w +.&/-]{1,40}?)\s+(?:option|approach|route|path)/gi,
];

const CONSTRAINT_INTRO_RE =
  /\b(important|note|rule|reminder|constraint|requirement|always|every\s+(?:code\s+)?answer|throughout(?:\s+this\s+(?:chat|conversation))?)\b\s*[:.\-—]?\s*/i;

const MUST_NOT_PATTERNS: readonly RegExp[] = [
  /\b(?:must\s+not|never|do\s+not|don't|no)\s+([^.!?]+)/gi,
];
const MUST_PATTERNS: readonly RegExp[] = [
  /\b(?:must|always|need\s+to|have\s+to|should\s+only|only\s+use|require[ds]?)\s+([^.!?]+)/gi,
];
const PREFERENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:I\s+prefer|preferably|prefer\s+to|favo(?:u)?r|liking|tend\s+to\s+use)\s+([^.!?]+)/gi,
];

const ITERATION_CHANGE_PATTERNS: readonly RegExp[] = [
  /\b(?:add|remove|change|update|tweak|adjust|increase|decrease|make\s+(?:it\s+)?more|switch\s+to|swap\s+to|use\s+a)\s+([^.!?]{4,120})/gi,
  /\bnow\s+(?:add|change|make|switch)\s+([^.!?]{4,120})/gi,
];

const STOP_PROJECT_NAMES: ReadonlySet<string> = new Set([
  // Words that often follow "building" but are not project names.
  'A', 'An', 'The', 'My', 'Our', 'Some', 'Just', 'Something', 'Anything', 'Nothing',
  'It', 'This', 'That', 'These', 'Those', 'There', 'Here', 'Now', 'Today', 'Tomorrow',
  'And', 'But', 'Or', 'So', 'Then', 'When', 'While', 'After', 'Before', 'Because',
  'You', 'I', 'We', 'They', 'He', 'She', 'Yes', 'No', 'OK', 'Okay',
  'TypeScript', 'JavaScript', 'React', 'Vue', 'Svelte', 'Angular', 'Python', 'Rust',
  'Next', 'Nuxt', 'Vite', 'Node', 'Bun', 'Deno', 'Webpack', 'Tailwind',
  'API', 'CRUD', 'UI', 'UX', 'CRM', 'CMS', 'AI', 'ML', 'LLM', 'PWA', 'SPA', 'SSR',
  'CSS', 'HTML', 'SQL', 'JSON', 'YAML', 'XML', 'HTTP', 'HTTPS', 'WebSocket',
  'Postgres', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'GraphQL',
  'Hello', 'Hi', 'Hey',
]);

function uniq<T>(arr: readonly T[], key: (x: T) => string = (x) => String(x)): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function descriptorsAround(text: string, name: string): string[] {
  const idx = text.indexOf(name);
  if (idx < 0) return [];
  const window = text.slice(Math.max(0, idx - 80), Math.min(text.length, idx + name.length + 120));
  const tags: string[] = [];
  const wantedTags: ReadonlyArray<[string, RegExp]> = [
    ['dark theme', /\bdark\s+(?:theme|mode|palette)\b/i],
    ['light theme', /\blight\s+(?:theme|mode)\b/i],
    ['scheduling tool', /\bscheduling\s+tool\b/i],
    ['markdown notes app', /\bmarkdown\s+notes?\s+app\b/i],
    ['notes app', /\bnotes?\s+app\b/i],
    ['todo app', /\btodo\s+app\b/i],
    ['meal planner', /\bmeal\s+planner\b/i],
    ['weekly view', /\bweekly\s+view\b/i],
    ['drag-and-drop', /\bdrag.?and.?drop\b/i],
    ['CRM', /\bCRM\b/],
    ['coffee shop', /\bcoffee\s+shop\b/i],
    ['landing page', /\blanding\s+page\b/i],
    ['blog', /\bblog\b/i],
    ['dashboard', /\bdashboard\b/i],
    ['calm aesthetic', /\bcalm\b/i],
  ];
  for (const [label, pat] of wantedTags) {
    if (pat.test(window)) tags.push(label);
  }
  return tags;
}

function extractProjectsFromTurn(content: string, turnIndex: number): ProjectFact[] {
  const projects: ProjectFact[] = [];
  for (const pat of PROJECT_INTRO_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      const candidate = m[1]?.trim();
      if (!candidate) continue;
      if (STOP_PROJECT_NAMES.has(candidate)) continue;
      if (candidate.length < 3) continue;
      if (!/^[A-Z]/.test(candidate)) continue;
      projects.push({
        name: candidate,
        descriptors: descriptorsAround(content, candidate),
        stacks: [],
        firstSeenTurn: turnIndex,
      });
    }
  }
  return uniq(projects, (p) => p.name.toLowerCase());
}

function extractStacksFromTurn(content: string): string[] {
  const found: string[] = [];
  for (const kw of STACK_KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/[.+]/g, '\\$&')}\\b`, 'i');
    if (re.test(content)) found.push(kw);
  }
  for (const pat of STACK_INTRO_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      const phrase = m[1]?.trim();
      if (!phrase) continue;
      // Split on +, ,, /, &
      for (const part of phrase.split(/\s*[+,/&]\s*/)) {
        const trimmed = part.trim();
        if (trimmed.length >= 2 && /^[A-Za-z]/.test(trimmed)) found.push(trimmed);
      }
    }
  }
  return uniq(found.map((s) => s.replace(/\s+/g, ' ')));
}

function extractFeatureNamesFromTurn(content: string): string[] {
  const found: string[] = [];
  let m: RegExpExecArray | null;
  FEATURE_NAME_PATTERN.lastIndex = 0;
  while ((m = FEATURE_NAME_PATTERN.exec(content)) !== null) {
    const name = m[1]?.trim();
    if (name) found.push(name);
  }
  // Also catch quoted feature names that follow "calling the main feature"
  const altRe = /\bcalling\s+(?:the\s+)?(?:main\s+)?feature\s+["']([\w &-]{2,40})["']/gi;
  while ((m = altRe.exec(content)) !== null) {
    const name = m[1]?.trim();
    if (name) found.push(name);
  }
  return uniq(found);
}

function extractDecisionsFromTurn(content: string, turn: number): DecisionFact[] {
  const out: DecisionFact[] = [];
  for (const pat of DECISION_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      const choice = m[1]?.trim();
      if (!choice) continue;
      if (choice.length < 2) continue;
      out.push({ choice, category: inferDecisionCategory(content, choice), turn });
    }
  }
  return uniq(out, (d) => d.choice.toLowerCase());
}

function inferDecisionCategory(content: string, choice: string): string | null {
  const lower = `${content} ${choice}`.toLowerCase();
  if (/\bstyl(?:ing|e)|css|tailwind|chakra|mantine|shadcn|bootstrap\b/.test(lower)) return 'styling';
  if (/\bauth|login|sign[\s-]?in|signin|signup\b/.test(lower)) return 'auth';
  if (/\bdb|database|postgres|mysql|sqlite|mongodb|prisma|drizzle\b/.test(lower)) return 'database';
  if (/\bframework|stack|react|vue|svelte|next|nuxt|astro\b/.test(lower)) return 'framework';
  if (/\bdeploy|hosting|vercel|netlify|cloudflare|aws\b/.test(lower)) return 'deployment';
  return null;
}

function extractConstraintsFromTurn(content: string, turn: number): ConstraintFact[] {
  const out: ConstraintFact[] = [];
  // Only look for constraints if there's a constraint signal nearby (avoid false positives in casual chat).
  const hasSignal = CONSTRAINT_INTRO_RE.test(content);
  const apply = (patterns: readonly RegExp[], kind: ConstraintFact['kind']) => {
    for (const pat of patterns) {
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(content)) !== null) {
        const text = m[1]?.trim().replace(/\s+/g, ' ');
        if (!text || text.length < 3) continue;
        // Restrict to constraint signal blocks unless wording is explicit.
        if (!hasSignal && kind === 'must-not' && !/^(?:use|include|allow|let|add|do|create)/i.test(text)) continue;
        if (!hasSignal && kind === 'must' && !/^(?:use|only|include|stick|adopt|prefer)/i.test(text)) continue;
        out.push({ text, kind, turn });
      }
    }
  };
  apply(MUST_NOT_PATTERNS, 'must-not');
  apply(MUST_PATTERNS, 'must');
  apply(PREFERENCE_PATTERNS, 'preference');
  return uniq(out, (c) => `${c.kind}|${c.text.toLowerCase()}`);
}

function looksLikeQuestion(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (!trimmed.includes('?')) return false;
  // Heuristic: starts with an interrogative or auxiliary verb.
  return /^(?:what|which|when|where|why|how|who|whose|can|could|would|should|do|does|did|is|are|was|were|will|am|have|has|had|may|might)\b/i.test(trimmed);
}

function extractIterationChangesFromTurn(content: string, turn: number): IterationChange[] {
  if (looksLikeQuestion(content)) return [];
  const out: IterationChange[] = [];
  for (const pat of ITERATION_CHANGE_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      const fragment = m[0]?.trim().replace(/\s+/g, ' ');
      if (!fragment) continue;
      out.push({ request: fragment, turn });
    }
  }
  return uniq(out, (c) => c.request.toLowerCase());
}

export function extractConversationFacts(
  history: readonly FactsHistoryMessage[],
): ConversationFacts {
  // Mutable accumulator for projects so we can attach per-project stacks
  // as later turns mention them while that project is "active".
  const projectAcc = new Map<string, { name: string; descriptors: string[]; stacks: string[]; firstSeenTurn: number }>();
  const stacks: string[] = [];
  const featureNames: string[] = [];
  const decisions: DecisionFact[] = [];
  const constraints: ConstraintFact[] = [];
  const iterationChanges: IterationChange[] = [];
  let activeProjectKey: string | null = null;

  let userTurnIndex = 0;
  for (const msg of history) {
    if (msg.role !== 'user') continue;
    userTurnIndex += 1;

    const newProjects = extractProjectsFromTurn(msg.content, userTurnIndex);
    for (const p of newProjects) {
      const key = p.name.toLowerCase();
      if (!projectAcc.has(key)) {
        projectAcc.set(key, {
          name: p.name,
          descriptors: [...p.descriptors],
          stacks: [],
          firstSeenTurn: p.firstSeenTurn,
        });
      } else {
        const existing = projectAcc.get(key)!;
        for (const d of p.descriptors) if (!existing.descriptors.includes(d)) existing.descriptors.push(d);
      }
      activeProjectKey = key;
    }

    // Mention-based active-project switch: if this turn names an existing
    // known project (without re-introducing it), switch active to that one.
    if (newProjects.length === 0) {
      for (const [key, entry] of projectAcc) {
        const nameRe = new RegExp(`\\b${entry.name.replace(/[\\^$.*+?()[\\]{}|]/g, '\\\\$&')}\\b`, 'i');
        if (nameRe.test(msg.content)) {
          activeProjectKey = key;
          break;
        }
      }
    }

    const turnStacks = extractStacksFromTurn(msg.content);
    stacks.push(...turnStacks);
    if (activeProjectKey && turnStacks.length > 0) {
      const proj = projectAcc.get(activeProjectKey);
      if (proj) {
        for (const s of turnStacks) if (!proj.stacks.includes(s)) proj.stacks.push(s);
      }
    }

    featureNames.push(...extractFeatureNamesFromTurn(msg.content));
    decisions.push(...extractDecisionsFromTurn(msg.content, userTurnIndex));
    constraints.push(...extractConstraintsFromTurn(msg.content, userTurnIndex));
    iterationChanges.push(...extractIterationChangesFromTurn(msg.content, userTurnIndex));
  }

  const projects: ProjectFact[] = [...projectAcc.values()]
    .sort((a, b) => a.firstSeenTurn - b.firstSeenTurn)
    .map((p) => ({
      name: p.name,
      descriptors: Object.freeze([...p.descriptors]) as readonly string[],
      stacks: Object.freeze([...p.stacks]) as readonly string[],
      firstSeenTurn: p.firstSeenTurn,
    }));

  return Object.freeze({
    projects: Object.freeze(projects) as readonly ProjectFact[],
    stacks: Object.freeze(uniq(stacks)) as readonly string[],
    featureNames: Object.freeze(uniq(featureNames)) as readonly string[],
    decisions: Object.freeze(uniq(decisions, (d) => `${d.category ?? ''}|${d.choice.toLowerCase()}`)) as readonly DecisionFact[],
    constraints: Object.freeze(uniq(constraints, (c) => `${c.kind}|${c.text.toLowerCase()}`)) as readonly ConstraintFact[],
    iterationChanges: Object.freeze(iterationChanges) as readonly IterationChange[],
  });
}

// ─── Recall router ───────────────────────────────────────────

const PROJECT_NAME_RECALL_RE =
  /\b(?:what(?:'s|\s+is|\s+was)?|which|recall|tell\s+me|remind\s+me\s+of|whats)\b[^?]*\b(?:my|the|our|this|current)\s+(?:project|app|tool|service|product)\s*(?:'s)?\s*name\b|\bwhat\s+(?:project|app)\s+(?:name\s+)?(?:did|am)\s+i\s+(?:just\s+)?(?:gave?|building|working\s+on)/i;

// "what's my current project", "what project am I currently working on",
// "what am I working on now", "current project"
const PROJECT_CURRENT_RECALL_RE =
  /\b(?:what(?:'s|\s+is)?|which)\s+(?:is\s+)?(?:my|the)\s+current\s+(?:project|app|build)\b|\bwhat\s+(?:project|app)\s+am\s+i\s+(?:currently|now)\s+(?:working\s+on|building|iterating)\b|\bwhat'?s?\s+the\s+current\s+project\s+i'?m\s+iterating\s+on\b/i;

// "what was my first project", "earliest project", "first project I mentioned"
const PROJECT_FIRST_RECALL_RE =
  /\b(?:what\s+was|which\s+was)\s+(?:my|the)\s+(?:first|earliest|original|initial)\s+(?:project|app|build)\b|\b(?:first|earliest|original)\s+project\s+(?:i\s+)?(?:mentioned|told\s+you|introduced)/i;

// "what projects am I working on", "list my projects", "all projects"
const PROJECT_LIST_RECALL_RE =
  /\bwhat\s+projects\s+(?:am\s+i|do\s+i\s+have)\b|\blist\s+(?:my|the|all)\s+projects\b|\b(?:all|both)\s+projects\b[^?]*\?|\bwhat\s+(?:are\s+)?(?:all\s+)?(?:my|the)\s+projects\b/i;

// "remind me what X is", "what is X", "tell me about X" — captures the name.
const PROJECT_BY_NAME_RECALL_RE =
  /\b(?:remind\s+me\s+(?:what|about)|tell\s+me\s+about|what\s+is|describe)\s+([A-Z][\w&-]{2,30})\b(?:\s+(?:is|again))?\??/i;

// "what stack does X use", "what stack is X using"
const PROJECT_STACK_NAMED_RE =
  /\bwhat\s+(?:stack|tech|framework)\s+(?:does|is)\s+([A-Z][\w&-]{2,30})\s+(?:use|using|built\s+with|on)/i;

const PROJECT_SUMMARY_RECALL_RE =
  /\bremind\s+me\s+(?:of|about)\s+(?:my|the|our)\s+project(?:'s)?(?:\s+name)?(?:\s*,?\s*(?:stack|features?|main\s+feature|tech))*\b|\bwhat'?s?\s+(?:my|the|our)\s+project\s+(?:name|setup|details)\b/i;

const STACK_RECALL_RE =
  /\b(?:what|which|remind\s+me\s+of|tell\s+me)\b[^?]*\b(?:stack|tech|technologies|frameworks?)\b/i;

const FEATURE_RECALL_RE =
  /\b(?:what|which|remind\s+me\s+of)\b[^?]*\b(?:main\s+feature|features?)\b[^?]*?(?:name|called)?/i;

const DECISION_RECALL_RE =
  /\b(?:what|which)\b[^?]*\b(?:did\s+i|have\s+i)\s+(?:decide|choose|pick|commit(?:ted)?\s+to|go\s+with|locked?\s+in)\b/i;
const STYLING_DECISION_RECALL_RE =
  /\bwhich\s+(?:styling|css|design)\s+(?:approach|library|framework|method)\s+did\s+i\s+(?:pick|choose|commit|go\s+with)/i;

const LAST_CHANGE_RECALL_RE =
  /\b(?:what\s+was\s+the\s+(?:most\s+recent|last|latest)\s+change|what\s+(?:change|tweak|update)\s+did\s+i\s+(?:last|just)\s+(?:ask|request))/i;

// "what changes have we made", "list the changes", "what have we changed",
// "what edits have I asked for", "recap the iterations"
const ITERATION_LIST_RECALL_RE =
  /\b(?:what\s+(?:changes|edits|tweaks|iterations|updates)\s+(?:have\s+(?:we|i)|has\s+(?:there|been))|list\s+(?:the\s+)?(?:changes|edits|iterations|updates)|recap\s+(?:the\s+)?(?:changes|iterations|edits)|what\s+have\s+(?:we|i)\s+(?:changed|added|edited|tweaked|updated|done))\b/i;

// "how many changes have I requested", "how many edits did I ask for",
// "count the changes", "how many iterations"
const ITERATION_COUNT_RECALL_RE =
  /\b(?:how\s+many\s+(?:changes|edits|tweaks|iterations|updates|requests|revisions)\b|count\s+(?:the\s+)?(?:changes|edits|iterations))/i;

// "what was the first change I asked for", "what did I first ask to change",
// "what was my original change request"
const ITERATION_FIRST_RECALL_RE =
  /\b(?:what\s+was\s+(?:the\s+|my\s+)?(?:first|earliest|original|initial)\s+(?:change|edit|tweak|iteration|update|request|revision)|what\s+did\s+i\s+(?:first|originally|initially)\s+(?:ask\s+(?:to\s+(?:change|add|edit))|change|add))/i;

const GO_BACK_RE =
  /\b(?:go\s+back|revert|undo|roll\s+back)\s+(?:to\s+)?(?:the\s+)?(?:previous|prior|earlier|last|original|first)\s+(?:version|state|design|build|generation|iteration)?/i;
const GO_BACK_ALT_RE =
  /\b(?:actually,?\s*)?(?:go\s+back|revert|undo|roll\s+back)\b[^?]*?\b(?:previous|prior|earlier|last|original|first)\b/i;

const CONSTRAINT_RECALL_RE =
  /\b(?:what\s+(?:constraint|rule|requirement)|what\s+did\s+i\s+(?:say|tell\s+you)\s+(?:never\s+to\s+do|to\s+(?:always|never)|about\s+constraints))/i;

function fmtList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function tryHandleFactRecall(
  content: string,
  history: readonly FactsHistoryMessage[],
): FactRecallResult | null {
  const text = content.trim();
  if (!text) return null;

  const facts = extractConversationFacts(history);

  // Project list ("what projects am I working on", "list my projects").
  // Must run BEFORE project-current/first/name since "what projects" overlaps.
  if (PROJECT_LIST_RECALL_RE.test(text)) {
    if (facts.projects.length === 0) return { reply: "You haven't told me about any projects yet in this chat.", intent: 'project-list' };
    const lines = facts.projects.map((p, i) => {
      const desc = p.descriptors.length > 0 ? ` — ${fmtList(p.descriptors)}` : '';
      return `${i + 1}. **${p.name}**${desc}`;
    });
    return { reply: `Projects in this chat:\n${lines.join('\n')}`, intent: 'project-list' };
  }

  // Stack scoped to a named project ("what stack does Tide use").
  // Must run before generic STACK_RECALL_RE.
  {
    const m = PROJECT_STACK_NAMED_RE.exec(text);
    if (m && m[1]) {
      const wanted = m[1].toLowerCase();
      const proj = facts.projects.find((p) => p.name.toLowerCase() === wanted);
      if (proj && proj.stacks.length > 0) {
        return { reply: `**${proj.name}** uses ${fmtList(proj.stacks)}.`, intent: 'project-stack-named' };
      }
    }
  }

  // First project ("what was my first project")
  if (PROJECT_FIRST_RECALL_RE.test(text)) {
    if (facts.projects.length === 0) return { reply: "You haven't told me about any projects yet in this chat.", intent: 'project-first' };
    const first = facts.projects[0];
    const desc = first.descriptors.length > 0 ? ` — ${fmtList(first.descriptors)}` : '';
    return { reply: `Your first project was **${first.name}**${desc}.`, intent: 'project-first' };
  }

  // Current project ("what's my current project")
  if (PROJECT_CURRENT_RECALL_RE.test(text)) {
    if (facts.projects.length === 0) return { reply: "You haven't told me about any projects yet in this chat.", intent: 'project-current' };
    const current = facts.projects[facts.projects.length - 1];
    const desc = current.descriptors.length > 0 ? ` — ${fmtList(current.descriptors)}` : '';
    return { reply: `Your current project is **${current.name}**${desc}.`, intent: 'project-current' };
  }

  // Project lookup by name ("remind me what Inkwell is", "what is Tide").
  // Only fires when the captured name matches an extracted project to avoid
  // hijacking generic "what is X" questions about non-projects.
  {
    const m = PROJECT_BY_NAME_RECALL_RE.exec(text);
    if (m && m[1]) {
      const wanted = m[1].toLowerCase();
      const proj = facts.projects.find((p) => p.name.toLowerCase() === wanted);
      if (proj) {
        const parts: string[] = [`**${proj.name}**`];
        if (proj.descriptors.length > 0) parts.push(`— ${fmtList(proj.descriptors)}`);
        if (proj.stacks.length > 0) parts.push(`(stack: ${fmtList(proj.stacks)})`);
        return { reply: `${parts.join(' ')}.`, intent: 'project-by-name' };
      }
    }
  }

  // Project summary ("remind me of project name, stack, main feature")
  if (PROJECT_SUMMARY_RECALL_RE.test(text)
    || (/\bremind\s+me\b/i.test(text) && /\bproject(?:'s)?\b/i.test(text) && /\bstack\b/i.test(text))) {
    const lines: string[] = [];
    if (facts.projects.length > 0) {
      lines.push(`Project: **${facts.projects[facts.projects.length - 1].name}**`);
    }
    if (facts.stacks.length > 0) {
      lines.push(`Stack: ${fmtList(facts.stacks)}`);
    }
    if (facts.featureNames.length > 0) {
      lines.push(`Main feature: ${fmtList(facts.featureNames.map((n) => `"${n}"`))}`);
    }
    if (lines.length === 0) return null;
    return { reply: lines.join('. ') + '.', intent: 'project-summary' };
  }

  // Project name ("what's my project name", "what project did I just give you")
  if (PROJECT_NAME_RECALL_RE.test(text)) {
    if (facts.projects.length === 0) return { reply: "You haven't told me a project name yet in this chat.", intent: 'project-name' };
    const latest = facts.projects[facts.projects.length - 1];
    const desc = latest.descriptors.length > 0 ? ` — ${fmtList(latest.descriptors)}` : '';
    return { reply: `Your project is **${latest.name}**${desc}.`, intent: 'project-name' };
  }

  // Stack
  if (STACK_RECALL_RE.test(text)) {
    if (facts.stacks.length === 0) return null; // let normal chat handle it
    // If the same prompt also asks for the project name, include it.
    const asksName = /\bname\s+of\s+the\s+(?:project|app)\b/i.test(text)
      || PROJECT_NAME_RECALL_RE.test(text);
    if (asksName && facts.projects.length > 0) {
      const proj = facts.projects[facts.projects.length - 1];
      const stacksToShow = proj.stacks.length > 0 ? proj.stacks : facts.stacks;
      return { reply: `Your project is **${proj.name}** and it uses ${fmtList(stacksToShow)}.`, intent: 'project-stack' };
    }
    if (facts.projects.length === 1) {
      const proj = facts.projects[0];
      const stacksToShow = proj.stacks.length > 0 ? proj.stacks : facts.stacks;
      return { reply: `Your project **${proj.name}** uses ${fmtList(stacksToShow)}.`, intent: 'project-stack' };
    }
    return { reply: `You said you're using ${fmtList(facts.stacks)}.`, intent: 'project-stack' };
  }

  // Feature names
  if (FEATURE_RECALL_RE.test(text) && facts.featureNames.length > 0) {
    return { reply: `Your main feature is ${fmtList(facts.featureNames.map((n) => `"${n}"`))}.`, intent: 'project-features' };
  }

  // Styling-specific decision recall (very common)
  if (STYLING_DECISION_RECALL_RE.test(text)) {
    const stylingDecision = [...facts.decisions].reverse().find((d) => d.category === 'styling');
    if (stylingDecision) {
      return { reply: `You committed to **${stylingDecision.choice}** for styling.`, intent: 'decision' };
    }
  }

  // Generic decision recall
  if (DECISION_RECALL_RE.test(text)) {
    if (facts.decisions.length === 0) return null;
    const latest = facts.decisions[facts.decisions.length - 1];
    return { reply: `You decided on **${latest.choice}**${latest.category ? ` (for ${latest.category})` : ''}.`, intent: 'decision' };
  }

  // Iteration list ("what changes have we made so far")
  if (ITERATION_LIST_RECALL_RE.test(text)) {
    if (facts.iterationChanges.length === 0) {
      return { reply: "You haven't asked for any changes yet in this chat.", intent: 'iteration-list' };
    }
    const lines = facts.iterationChanges.map((c, i) => `${i + 1}. ${c.request}`);
    const projectBit = facts.projects.length > 0
      ? ` for **${facts.projects[facts.projects.length - 1].name}**`
      : '';
    return {
      reply: `Changes you've asked for${projectBit} so far:\n${lines.join('\n')}`,
      intent: 'iteration-list',
    };
  }

  // Iteration count ("how many changes have I requested")
  if (ITERATION_COUNT_RECALL_RE.test(text)) {
    const n = facts.iterationChanges.length;
    if (n === 0) return { reply: "You haven't asked for any changes yet in this chat.", intent: 'iteration-count' };
    const word = n === 1 ? 'one change' : `${n} changes`;
    return { reply: `You've requested ${word} so far in this chat.`, intent: 'iteration-count' };
  }

  // First iteration recall ("what was the first change I asked for")
  if (ITERATION_FIRST_RECALL_RE.test(text)) {
    const first = facts.iterationChanges[0];
    if (!first) return { reply: "You haven't asked for any changes yet in this chat.", intent: 'iteration-first' };
    return { reply: `The first change you asked for was: ${first.request}.`, intent: 'iteration-first' };
  }

  // Last change recall (combined with project recall when worded together)
  if (LAST_CHANGE_RECALL_RE.test(text)) {
    const latest = facts.iterationChanges[facts.iterationChanges.length - 1];
    if (!latest) return null;
    let reply = `The most recent change you asked for was: ${latest.request}.`;
    // If the same prompt asks for the project name too, prepend it.
    if (PROJECT_NAME_RECALL_RE.test(text) || /\bname\s+of\s+the\b/i.test(text)) {
      const proj = facts.projects[facts.projects.length - 1];
      if (proj) reply = `Project **${proj.name}**. ${reply}`;
    }
    return { reply, intent: 'last-change' };
  }

  // Constraint recall
  if (CONSTRAINT_RECALL_RE.test(text)) {
    if (facts.constraints.length === 0) return null;
    const lines = facts.constraints.slice(-5).map((c) => `- (${c.kind}) ${c.text}`);
    return { reply: `Constraints you set in this chat:\n${lines.join('\n')}`, intent: 'constraint' };
  }

  // "Go back to the previous version" — describe the prior state we'd revert to.
  if (GO_BACK_RE.test(text) || GO_BACK_ALT_RE.test(text)) {
    const changes = facts.iterationChanges;
    if (changes.length === 0) return null;
    const latestChange = changes[changes.length - 1];
    const projectBit = facts.projects.length > 0
      ? ` for **${facts.projects[facts.projects.length - 1].name}**`
      : '';
    const reply = `Reverting${projectBit} to the previous version — undoing your last change ("${latestChange.request}") and restoring the prior state.`;
    return { reply, intent: 'last-change' };
  }

  return null;
}

/**
 * Build a short system-prompt prelude from extracted facts. Inserted before
 * model dispatch so non-meta turns also stay anchored to user-stated facts
 * and constraints. Returns null when there are no facts worth surfacing.
 */
export function buildFactsSystemPrelude(facts: ConversationFacts): string | null {
  const lines: string[] = [];
  if (facts.projects.length > 0) {
    const p = facts.projects[facts.projects.length - 1];
    const desc = p.descriptors.length > 0 ? ` (${fmtList(p.descriptors)})` : '';
    lines.push(`- Active project: ${p.name}${desc}`);
  }
  if (facts.stacks.length > 0) {
    lines.push(`- Stack the user named: ${fmtList(facts.stacks)}`);
  }
  if (facts.featureNames.length > 0) {
    lines.push(`- Feature names the user named: ${fmtList(facts.featureNames)}`);
  }
  if (facts.decisions.length > 0) {
    const last = facts.decisions[facts.decisions.length - 1];
    lines.push(`- Latest user decision: ${last.choice}${last.category ? ` (${last.category})` : ''}`);
  }
  if (facts.constraints.length > 0) {
    const lastFew = facts.constraints.slice(-3);
    for (const c of lastFew) {
      lines.push(`- Constraint (${c.kind}): ${c.text}`);
    }
  }
  if (lines.length === 0) return null;
  return [
    'Known facts the user has stated earlier in this conversation. Honor them in every reply unless the user changes them:',
    ...lines,
  ].join('\n');
}
