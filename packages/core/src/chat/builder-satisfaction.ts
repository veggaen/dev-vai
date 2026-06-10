/**
 * Builder Mode 2.0 — request-satisfaction gate (Master.md §4.7, §12.5.3).
 *
 * The old `hasPrimaryBuilderFileOutput` check suppressed escalation whenever the
 * engine emitted *any* titled code-fence — so a generic scaffold (a bare Vite
 * `package.json` + empty `App.tsx`) counted as "done" and blocked the turn from
 * escalating to a model that could actually build the requested app. That is
 * the root cause of the builder 0/39 ceiling: scaffolding masqueraded as
 * completion (§4.7 "do not confuse scaffolding with completion").
 *
 * This evaluator answers the real question — *does the artifact actually
 * satisfy what the user asked for?* — structurally: it extracts the request's
 * salient feature anchors and measures how many the produced artifact engages.
 * No hard-coded templates; the only knob is a configurable coverage threshold.
 */

/** Titled code-fence = a build artifact (a file block). Shared shape with the service. */
const BUILDER_FILE_BLOCK = /```[^\r\n`]*\b(?:title|path|file|filename)=["'][^"']+["']/i;

/** Build verbs + glue that are not distinctive feature anchors. */
const REQUEST_STOP_WORDS = new Set([
  'build', 'builder', 'create', 'make', 'making', 'want', 'need', 'give', 'please', 'add', 'using', 'use',
  'app', 'application', 'apps', 'project', 'thing', 'something', 'version', 'runnable', 'now', 'first',
  'tiny', 'small', 'simple', 'basic', 'quick', 'compact', 'nice', 'clean', 'polished', 'preview',
  'with', 'and', 'the', 'for', 'that', 'this', 'into', 'from', 'your', 'have', 'has', 'are', 'its',
  'should', 'would', 'can', 'will', 'lets', 'let', 'about', 'like', 'real', 'feel', 'feels', 'them',
  'live', 'ready', 'good', 'great', 'better', 'best', 'full', 'whole', 'over', 'each', 'every',
]);

export interface BuilderSatisfactionConfig {
  /** Fraction of request anchors the artifact must engage to count as satisfying. Default 0.4. */
  readonly minAnchorCoverage?: number;
}

export interface BuilderSatisfactionReport {
  readonly hasFileBlocks: boolean;
  readonly satisfied: boolean;
  readonly coverage: number;
  readonly anchorsHit: number;
  readonly anchorsTotal: number;
  readonly missingAnchors: readonly string[];
  readonly reasons: readonly string[];
}

export function hasBuilderFileBlocks(text: string): boolean {
  return BUILDER_FILE_BLOCK.test(text ?? '');
}

export interface BuilderFileBlockRepair {
  readonly text: string;
  readonly changed: boolean;
  readonly reason?: 'single-html-index';
}

/**
 * Recover the narrow formatting miss a small local builder model commonly
 * makes: one complete standalone HTML document in an untitled fence. The
 * sandbox needs `title="index.html"` to apply it. Multi-file or partial output
 * stays untouched because inferring paths there would be guesswork.
 */
export function repairBuilderFallbackFileBlocks(output: string): BuilderFileBlockRepair {
  const text = output ?? '';
  if (!text || hasBuilderFileBlocks(text)) return { text, changed: false };

  const blocks = [...text.matchAll(/```([^\r\n`]*)\r?\n([\s\S]*?)```/g)];
  if (blocks.length !== 1) return { text, changed: false };

  const match = blocks[0];
  const info = (match[1] ?? '').trim();
  const body = match[2] ?? '';
  const language = info.split(/\s+/)[0]?.toLowerCase() ?? '';
  const isCompleteHtml =
    (language === '' || language === 'html' || language === 'htm')
    && /(?:<!doctype\s+html|<html[\s>])/i.test(body)
    && /<\/html>/i.test(body);
  if (!isCompleteHtml || match.index === undefined) return { text, changed: false };

  const repaired = `\`\`\`${language || 'html'} title="index.html"\n${body}\`\`\``;
  return {
    text: `${text.slice(0, match.index)}${repaired}${text.slice(match.index + match[0].length)}`,
    changed: true,
    reason: 'single-html-index',
  };
}

/** Scaffold boilerplate files whose contents/names must NOT count toward request coverage. */
const BOILERPLATE_PATH = /(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^"']*\.json|vite\.config\.[jt]s|postcss\.config\.[jt]s|tailwind\.config\.[jt]s|\.gitignore|\.npmrc)$/i;
const TITLED_BLOCK = /```[^\r\n`]*\b(?:title|path|file|filename)=["']([^"']+)["']\s*([\s\S]*?)```/gi;

/**
 * Build the haystack used to measure request coverage from the paths/contents
 * of *non-boilerplate* file blocks only. Excluding visible prose stops a model
 * from "satisfying" a missing feature by merely describing it after the files.
 * Excluding package.json & config files stops a generic scaffold from gaming
 * the request through its package name (a real live case:
 * "tiny-single-file-html-counter").
 */
function buildCoverageHaystack(output: string): string {
  const text = output ?? '';
  const parts: string[] = [];
  for (const match of text.matchAll(TITLED_BLOCK)) {
    const path = match[1] ?? '';
    const body = match[2] ?? '';
    if (BOILERPLATE_PATH.test(path)) continue; // skip scaffold boilerplate
    parts.push(path, body);
  }
  return parts.join('\n').toLowerCase();
}

/** Distinctive feature tokens the request asks for (domain nouns, file types, named features). */
export function extractRequestAnchors(prompt: string): string[] {
  const tokens = (prompt ?? '')
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^[.#]+|[.#]+$/g, ''))
    .filter((t) => t.length >= 3 && !REQUEST_STOP_WORDS.has(t) && !/^\d+$/.test(t));
  return [...new Set(tokens)];
}

/**
 * Evaluate whether a produced builder artifact satisfies the user's request.
 * Pure: depends only on the prompt + the produced text.
 */
export function evaluateBuilderRequestSatisfaction(
  prompt: string,
  output: string,
  config?: BuilderSatisfactionConfig,
): BuilderSatisfactionReport {
  const minCoverage = config?.minAnchorCoverage ?? 0.4;
  const hasFileBlocks = hasBuilderFileBlocks(output);
  const anchors = extractRequestAnchors(prompt);
  const haystack = buildCoverageHaystack(output);

  const hit: string[] = [];
  const missing: string[] = [];
  for (const anchor of anchors) {
    if (haystack.includes(anchor)) hit.push(anchor);
    else missing.push(anchor);
  }
  const coverage = anchors.length === 0 ? 1 : hit.length / anchors.length;

  const reasons: string[] = [];
  if (!hasFileBlocks) reasons.push('no-file-blocks');
  if (anchors.length > 0 && coverage < minCoverage) {
    reasons.push(`low-anchor-coverage:${hit.length}/${anchors.length}`);
  }

  // Satisfying = produced real file artifacts AND engaged enough of the request's
  // feature anchors. A scaffold with files but near-zero feature coverage fails.
  const satisfied = hasFileBlocks && (anchors.length === 0 || coverage >= minCoverage);

  return {
    hasFileBlocks,
    satisfied,
    coverage,
    anchorsHit: hit.length,
    anchorsTotal: anchors.length,
    missingAnchors: missing,
    reasons,
  };
}
