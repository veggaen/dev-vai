import { detectMultiIntent, type IntentPart } from './multi-intent.js';

/**
 * Deterministic multi-intent COVERAGE check.
 *
 * The failure this fixes: a message with two distinct asks ("explain JWT AND
 * build the app") gets a draft that satisfies ONE part and silently drops the
 * other. The council caught the *misread* but had no crisp signal for "you
 * answered part 1 but skipped part 2". This gives it one — computed by Vai (not
 * the models: fact-quarantine), so a redraft can be demanded when a part is
 * missing.
 *
 * Coverage is heuristic-but-honest: for each part we derive a few salient content
 * anchors (nouns the ask is *about*) and check whether the draft addresses them.
 * A build part additionally requires build-shaped output (file blocks / code) to
 * count as covered — answering "build me an app" with prose is NOT coverage. Pure.
 */

export interface PartCoverage {
  readonly part: IntentPart;
  readonly covered: boolean;
  /** The anchors we looked for (for the auditable trail / UI). */
  readonly anchors: readonly string[];
  /** Why it was judged covered / not. */
  readonly reason: string;
}

export interface CoverageReport {
  readonly isMultiIntent: boolean;
  readonly parts: readonly PartCoverage[];
  /** Parts the draft did NOT address — the dropped deliverables. */
  readonly missingParts: readonly PartCoverage[];
  /** True when at least one distinct part was dropped. */
  readonly hasMissingPart: boolean;
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'with', 'me',
  'my', 'it', 'that', 'this', 'how', 'what', 'why', 'when', 'then', 'also',
  'please', 'can', 'you', 'i', 'is', 'are', 'be', 'do', 'does', 'use', 'using',
  'explain', 'build', 'make', 'create', 'show', 'tell', 'works', 'work', 'about',
  'so', 'both', 'when', 'only', 'page', 'app', // generic build nouns handled separately
]);

/** Salient content anchors for a part — the words it is really *about*. */
function anchorsOf(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []) {
    const w = raw.replace(/[.\-]+$/, '');
    if (w.length < 3 || STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 5) break;
  }
  return out;
}

// Build output = a real code fence, a file-title block, a manifest, or a source
// path — NOT a bare framework mention. "Next.js" in prose must not count, so we
// require a path separator or fence, never a lone `.js`/`.tsx` token.
const BUILD_OUTPUT_RE = /```|title=["'][^"']+["']|\bpackage\.json\b|(?:^|\s)(?:src|app|pages|components)\/[\w./-]+\.(?:tsx?|jsx?|css|html)\b/im;

function coverPart(part: IntentPart, draft: string): PartCoverage {
  const lower = draft.toLowerCase();
  const anchors = anchorsOf(part.text);
  const anchorHits = anchors.filter((a) => lower.includes(a)).length;
  // "About-ness": most of the part's salient anchors show up in the draft.
  const anchorsCovered = anchors.length === 0 || anchorHits / anchors.length >= 0.5;

  if (part.action === 'build') {
    // A build part is only covered when the draft actually SHIPS build output AND
    // is on-subject. Prose about the topic does not satisfy "build me X".
    const hasBuildOutput = BUILD_OUTPUT_RE.test(draft);
    const covered = hasBuildOutput && anchorsCovered;
    return {
      part,
      covered,
      anchors,
      reason: covered
        ? 'build output present and on-subject'
        : !hasBuildOutput
          ? 'no build output (files/code) for a build request'
          : 'build output present but does not address this part',
    };
  }

  // An answer part is covered when the draft addresses its subject anchors.
  return {
    part,
    covered: anchorsCovered,
    anchors,
    reason: anchorsCovered ? 'subject addressed in the answer' : 'subject not addressed',
  };
}

/**
 * Report which parts of a (possibly multi-intent) message the draft covered.
 * Single-intent messages return `isMultiIntent: false` with no missing parts —
 * so callers can cheaply gate the whole coverage path on multi-intent turns.
 */
export function checkMultiIntentCoverage(userMessage: string, draft: string): CoverageReport {
  const multi = detectMultiIntent(userMessage);
  if (!multi.isMultiIntent) {
    return { isMultiIntent: false, parts: [], missingParts: [], hasMissingPart: false };
  }
  const parts = multi.parts.map((p) => coverPart(p, draft || ''));
  const missingParts = parts.filter((p) => !p.covered);
  return {
    isMultiIntent: true,
    parts,
    missingParts,
    hasMissingPart: missingParts.length > 0,
  };
}

/** A compact, human-legible line naming the dropped deliverables (for redraft + UI). */
export function describeMissingParts(report: CoverageReport): string {
  if (!report.hasMissingPart) return '';
  const names = report.missingParts.map((p) => {
    const label = p.part.action === 'build' ? 'build' : 'answer';
    const subject = p.anchors.slice(0, 3).join(' ') || p.part.text.slice(0, 40);
    return `${label}: ${subject}`;
  });
  return `The draft did not address ${report.missingParts.length} of the ${report.parts.length} requests — missing → ${names.join(' | ')}.`;
}
