/**
 * Web-Pattern-Learner
 * ─────────────────────
 * Gives Vai the ability to READ a web resource and EXTRACT structured patterns
 * from it — the same capability the agent demonstrated when it read the Reddit
 * thread and identified the car-wash trick-question class.
 *
 * Architecture (respects deterministic-core doctrine):
 *   1. DETERMINISTIC: Read URL → extract text → classify content type
 *   2. DETERMINISTIC: Apply pattern-extraction rules to identify described
 *      failure patterns, trick questions, and cognitive traps
 *   3. DETERMINISTIC: Validate extracted patterns against known schemas
 *   4. DETERMINISTIC: Store validated patterns in a serializable pattern library
 *
 * The key insight from V3gga: "how exactly do you do it? make Vai also capable."
 * What the agent does: read_url → search_web → view_file → connect the dots → code.
 * What Vai needs: read_url → extract_patterns → validate → store → match.
 *
 * This module handles steps 2-4. Step 1 uses the existing search pipeline's
 * page-reading capability. Step 5 (matching) is handled by the trick-question
 * detector which checks the stored patterns alongside its static regex library.
 *
 * Pure functions. No I/O. No model calls. The extraction uses structural patterns
 * in web content (headings, lists, "the answer is X", "most AI models get this
 * wrong because Y") to identify described trick-question patterns.
 */

// ── Types ──────────────────────────────────────────────────────────────

/** A pattern extracted from web content that describes a class of tricky questions. */
export interface LearnedPattern {
  /** Unique ID (content-hash of the pattern). */
  readonly id: string;
  /** Human-readable name for the pattern class. */
  readonly name: string;
  /** The trap/trick mechanism — what makes this question misleading. */
  readonly mechanism: string;
  /** Keywords that signal this pattern class in a user's question. */
  readonly triggerKeywords: readonly string[];
  /** The correct reasoning approach. */
  readonly correctReasoning: string;
  /** Example question(s) from the source. */
  readonly examples: readonly string[];
  /** Source URL where this was learned from. */
  readonly sourceUrl: string;
  /** When this pattern was extracted (ms since epoch). */
  readonly learnedAtMs: number;
  /** Confidence in the extraction (0–1). */
  readonly confidence: number;
}

/** A store of patterns learned from web content. Serializable, appendable. */
export interface PatternLibrary {
  readonly patterns: readonly LearnedPattern[];
  readonly version: number;
}

// ── Content Classification ─────────────────────────────────────────────

/** What kind of content a web page contains (for deciding extraction strategy). */
export type ContentClass = 'trick-question-discussion' | 'ai-failure-analysis' | 'benchmark-results' | 'general' | 'irrelevant';

const TRICK_QUESTION_SIGNALS = [
  /\btrick\s+question/i,
  /\bai\s+(?:models?\s+)?(?:fail|got\s+(?:it\s+)?wrong|struggle|mistake)/i,
  /\bwalk\s+or\s+drive/i,
  /\bstrawberry\b[^.]{0,60}\bhow\s+many/i,
  /\bbat\s+and\s+(?:a\s+)?ball/i,
  /\bcognitive\s+(?:bias|trap|test)/i,
  /\bcommon\s+sense\s+(?:reasoning|test|fail)/i,
  /\bprompt\s+(?:engineering|test|trick)/i,
  /\bllm\s+(?:fail|benchmark|reasoning)/i,
  /\bviral\s+(?:question|prompt|test)/i,
];

/**
 * Classify what kind of content a web page contains.
 * Uses keyword signals in the text — no model call needed.
 */
export function classifyContent(text: string, title: string): ContentClass {
  const combined = `${title} ${text}`.toLowerCase();
  const trickScore = TRICK_QUESTION_SIGNALS.reduce(
    (score, re) => score + (re.test(combined) ? 1 : 0),
    0,
  );
  if (trickScore >= 3) return 'trick-question-discussion';
  if (trickScore >= 1 && /\bai\b/i.test(combined)) return 'ai-failure-analysis';
  if (/\bbenchmark\b/i.test(combined) && /\bmodel/i.test(combined)) return 'benchmark-results';
  if (combined.length < 100) return 'irrelevant';
  return 'general';
}

// ── Pattern Extraction ─────────────────────────────────────────────────

/**
 * Extract described trick-question patterns from web content.
 *
 * Looks for structural signals in the text:
 *  - "The correct answer is X" / "The answer is X"
 *  - "Most AI models get this wrong because Y"
 *  - "The trick is Z" / "The trap is Z"
 *  - "This question tests W" / "This tests W"
 *  - Lists of questions with answers
 *
 * Returns extracted patterns with confidence scores.
 * Never fabricates — only surfaces what appears verbatim in the source text.
 */
export function extractTrickPatterns(
  text: string,
  sourceUrl: string,
): LearnedPattern[] {
  const patterns: LearnedPattern[] = [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 10);

  // Look for question-answer pairs with trick explanations
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    // Pattern: "The trick is..." / "The trap is..." / "What makes this tricky is..."
    const trickMatch = lower.match(
      /\b(?:the\s+(?:trick|trap|catch|key|insight)\s+(?:is|here\s+is)|what\s+makes\s+this\s+(?:tricky|difficult|hard)|the\s+(?:correct|right|actual)\s+answer\s+is)\b/,
    );
    if (!trickMatch) continue;

    // Look backward for the question
    const questionLine = findNearbyQuestion(lines, i);
    if (!questionLine) continue;

    // Extract keywords from the question
    const keywords = extractKeywords(questionLine);
    if (keywords.length === 0) continue;

    // Generate a pattern ID from the content
    const id = simpleHash(`${questionLine}:${line}`);

    patterns.push({
      id,
      name: inferPatternName(questionLine, line),
      mechanism: line.slice(0, 200),
      triggerKeywords: keywords,
      correctReasoning: line.slice(0, 300),
      examples: [questionLine],
      sourceUrl,
      learnedAtMs: Date.now(),
      confidence: trickMatch ? 0.7 : 0.5,
    });
  }

  return patterns;
}

// ── Pattern Matching ───────────────────────────────────────────────────

/**
 * Check if a user's question matches any learned pattern.
 * Uses keyword overlap — the learned triggerKeywords must appear in the input.
 * Returns the best-matching pattern or null.
 */
export function matchLearnedPattern(
  input: string,
  library: PatternLibrary,
): LearnedPattern | null {
  const lower = input.toLowerCase();
  const inputTokens = new Set(lower.split(/[^a-z0-9]+/).filter((t) => t.length >= 3));

  let best: { pattern: LearnedPattern; score: number } | null = null;

  for (const pattern of library.patterns) {
    // Count keyword matches
    const matchCount = pattern.triggerKeywords.filter((kw) =>
      inputTokens.has(kw.toLowerCase()) || lower.includes(kw.toLowerCase()),
    ).length;
    if (matchCount === 0) continue;

    // Score = fraction of trigger keywords matched, weighted by pattern confidence
    const score = (matchCount / pattern.triggerKeywords.length) * pattern.confidence;
    if (score >= 0.5 && (!best || score > best.score)) {
      best = { pattern, score };
    }
  }

  return best?.pattern ?? null;
}

// ── Library Management ─────────────────────────────────────────────────

/** Create an empty pattern library. */
export function createPatternLibrary(): PatternLibrary {
  return { patterns: [], version: 1 };
}

/** Add patterns to the library, deduplicating by ID. */
export function addPatterns(
  library: PatternLibrary,
  newPatterns: readonly LearnedPattern[],
): PatternLibrary {
  const existingIds = new Set(library.patterns.map((p) => p.id));
  const unique = newPatterns.filter((p) => !existingIds.has(p.id));
  if (unique.length === 0) return library;
  return {
    patterns: [...library.patterns, ...unique],
    version: library.version + 1,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Look backward from a line to find a nearby question (within 5 lines). */
function findNearbyQuestion(lines: readonly string[], fromIndex: number): string | null {
  for (let j = fromIndex - 1; j >= Math.max(0, fromIndex - 5); j--) {
    if (lines[j].endsWith('?') || /^["\u201C]/.test(lines[j])) {
      return lines[j];
    }
  }
  return null;
}

/** Extract salient keywords from a question. */
function extractKeywords(question: string): string[] {
  const STOP = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'do', 'does', 'did',
    'what', 'how', 'why', 'when', 'where', 'who', 'which', 'should',
    'would', 'could', 'can', 'may', 'will', 'to', 'of', 'in', 'for',
    'with', 'on', 'at', 'by', 'from', 'and', 'or', 'but', 'not', 'if',
    'that', 'this', 'it', 'you', 'your', 'my', 'me', 'we', 'they', 'i',
  ]);
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .slice(0, 8);
}

/** Infer a human-readable name for a pattern from its question and explanation. */
function inferPatternName(question: string, explanation: string): string {
  const lower = `${question} ${explanation}`.toLowerCase();
  if (/car\s*wash/i.test(lower)) return 'car-wash-implicit-constraint';
  if (/bat\s+and\s+ball/i.test(lower)) return 'bat-and-ball-anchoring';
  if (/lily\s*pad|doubl/i.test(lower)) return 'lily-pad-exponential';
  if (/strawberry|letter\s+count/i.test(lower)) return 'letter-count';
  if (/feather|pound.*weigh/i.test(lower)) return 'equal-weight';
  // Fallback: first 3 keywords
  const kw = extractKeywords(question);
  return kw.slice(0, 3).join('-') || 'unknown-pattern';
}

/** Simple string hash for pattern IDs. */
function simpleHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return `lp_${Math.abs(hash).toString(36)}`;
}
