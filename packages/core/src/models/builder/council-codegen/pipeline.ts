import type { TokenUsage } from '../../adapter.js';
import { buildReactViteTsApp } from '../compose-builder-app.js';
import { detectBrandBlueprint } from './brand-blueprints.js';
import {
  buildArchitectMessages,
  buildCoderMessages,
  buildEditMessages,
  buildEditRepairMessages,
  buildRepairMessages,
  buildReviewerMessages,
  buildStylistMessages,
  buildStylistRepairMessages,
} from './prompts.js';
import {
  extractAppFiles,
  extractClassNames,
  extractTitledFiles,
  validateEditedFiles,
  validateGeneratedApp,
  type ExtractedAppFiles,
} from './validate-app.js';
import type {
  AppValidationReport,
  CodegenReviewNote,
  CouncilAppSpec,
  CouncilCodegenEvent,
  CouncilCodegenInput,
  CouncilCodegenMember,
  CouncilCodegenResult,
  CouncilEditContext,
  CouncilWithheldProposal,
} from './types.js';

const DEFAULT_MAX_REPAIRS = 2;
const DEFAULT_MAX_REVIEWERS = 2;
const ARCHITECT_MAX_TOKENS = 700;
const CODER_MAX_TOKENS = 7000;
const STYLIST_MAX_TOKENS = 3500;
const REVIEWER_MAX_TOKENS = 700;

/** Pull the first balanced JSON object out of a model reply (fences/prose tolerated). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const source = text ?? '';
  const start = source.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = source.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
        } catch {
          // Common 7B miss: trailing comma before } or ].
          try {
            const parsed = JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
            return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function toStringArray(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, cap);
}

function kebab(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'vai-council-app';
}

/** Derive an honest spec straight from the brief when the architect's JSON is unusable. */
export function specFromBrief(brief: string): CouncilAppSpec {
  const words = brief
    .replace(/^(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:build|create|make|design|generate|develop)\s+(?:me\s+|us\s+)?(?:an?\s+|the\s+)?/i, '')
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 5);
  const title = words.length > 0
    ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').replace(/[.!?]+$/, '')
    : 'Vai Council App';
  return {
    title,
    packageName: kebab(title),
    summary: brief.trim().slice(0, 200),
    features: [brief.trim().slice(0, 300)],
    fromArchitect: false,
  };
}

function parseSpec(reply: string, brief: string): CouncilAppSpec {
  const json = extractJsonObject(reply);
  if (!json) return specFromBrief(brief);
  const title = typeof json.title === 'string' && json.title.trim() ? json.title.trim().slice(0, 80) : null;
  const summary = typeof json.summary === 'string' && json.summary.trim() ? json.summary.trim().slice(0, 300) : null;
  const features = toStringArray(json.features, 6);
  if (!title || features.length === 0) return specFromBrief(brief);
  return {
    title,
    packageName: kebab(typeof json.packageName === 'string' && json.packageName.trim() ? json.packageName : title),
    summary: summary ?? brief.trim().slice(0, 200),
    features,
    fromArchitect: true,
  };
}

function parseReview(memberId: string, reply: string): CodegenReviewNote {
  const json = extractJsonObject(reply);
  if (!json) {
    return { memberId, verdict: 'ship', mustFix: [], notes: [], error: 'unparseable-review' };
  }
  const verdict = json.verdict === 'needs-work' ? 'needs-work' : 'ship';
  return {
    memberId,
    verdict,
    mustFix: toStringArray(json.mustFix, 4),
    notes: toStringArray(json.notes, 4),
  };
}

function addUsage(total: TokenUsage, usage?: TokenUsage): TokenUsage {
  if (!usage) return total;
  return {
    promptTokens: total.promptTokens + (usage.promptTokens ?? 0),
    completionTokens: total.completionTokens + (usage.completionTokens ?? 0),
  };
}

interface Candidate {
  readonly files: ExtractedAppFiles;
  readonly validation: AppValidationReport;
}

/** Prefer valid candidates; then fewer hard errors; then fewer soft errors. */
function betterCandidate(a: Candidate | null, b: Candidate): Candidate {
  if (!a) return b;
  if (a.validation.ok !== b.validation.ok) return a.validation.ok ? a : b;
  if (a.validation.errors.length !== b.validation.errors.length) {
    return b.validation.errors.length < a.validation.errors.length ? b : a;
  }
  return b.validation.softErrors.length < a.validation.softErrors.length ? b : a;
}

function assembleOutput(spec: CouncilAppSpec, files: ExtractedAppFiles, memberIds: readonly string[]): string {
  const app = buildReactViteTsApp({
    packageName: spec.packageName,
    title: spec.title,
    appTsx: files.appTsx ?? '',
    stylesCss: files.stylesCss ?? '',
  });
  const intro = `**${spec.title}** — built by Vai's council (${memberIds.join(', ')}). ${spec.summary}`;
  const featureLines = spec.features.length > 1
    ? ['', ...spec.features.map((f) => `- ${f}`)]
    : [];
  return [intro, ...featureLines, '', app].join('\n');
}

/**
 * Run the council codegen pipeline: architect → coder → static validation →
 * council review → bounded repair → assemble onto the known-good Vite scaffold.
 *
 * Yields stage events (for UI progress) and finally a `result` event whose
 * payload is null when nothing valid could be produced — the caller then falls
 * back to the single-model builder arm.
 */
export async function* councilGenerateApp(input: CouncilCodegenInput): AsyncGenerator<CouncilCodegenEvent> {
  const members = input.members;
  if (members.length === 0 || !input.brief.trim()) {
    yield { type: 'result', result: null };
    return;
  }
  if (input.edit && input.edit.files.length > 0) {
    yield* councilEditApp(input, input.edit);
    return;
  }

  const coder = members[0];
  const reviewers = members.slice(1, 1 + (input.maxReviewers ?? DEFAULT_MAX_REVIEWERS));
  const maxRepairs = input.maxRepairs ?? DEFAULT_MAX_REPAIRS;
  const blueprint = detectBrandBlueprint(input.brief);
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
  const actedMemberIds: string[] = [];

  // ── Architect ──
  yield {
    type: 'stage',
    stage: 'architect',
    label: blueprint
      ? `${coder.displayName ?? coder.id} is drafting the spec against the ${blueprint.brand} blueprint`
      : `${coder.displayName ?? coder.id} is drafting the build spec`,
    memberId: coder.id,
    status: 'running',
  };
  let spec: CouncilAppSpec;
  try {
    const reply = await coder.complete(buildArchitectMessages(input.brief, blueprint), { maxTokens: ARCHITECT_MAX_TOKENS, temperature: 0.3 });
    usage = addUsage(usage, reply.usage);
    spec = parseSpec(reply.text, input.brief);
  } catch {
    spec = specFromBrief(input.brief);
  }
  // A clone spec must carry the blueprint even if the architect dropped items
  // — the blueprint features ARE the request.
  if (blueprint && spec.features.length < blueprint.features.length) {
    spec = { ...spec, features: blueprint.features };
  }
  actedMemberIds.push(coder.id);
  yield {
    type: 'stage',
    stage: 'architect',
    label: spec.fromArchitect ? `Spec ready: ${spec.title}` : 'Architect spec unusable — building straight from the brief',
    detail: spec.features.slice(0, 4).join(' · '),
    memberId: coder.id,
    status: 'done',
  };

  // ── Coder: App.tsx ONLY. The stylesheet is generated afterwards FOR the
  // app's class list, so an App↔CSS mismatch is structurally impossible. ──
  yield { type: 'stage', stage: 'code', label: `${coder.displayName ?? coder.id} is writing the app`, memberId: coder.id, status: 'running' };
  const validateApp = (app: string | null) => validateEditedFiles(
    new Map(app ? [['src/App.tsx', app]] : []),
    ['src/App.tsx'],
    { brief: input.brief },
  );
  let appTsx: string | null = null;
  let appValidation: AppValidationReport;
  try {
    let reply = await coder.complete(buildCoderMessages(input.brief, spec, blueprint), { maxTokens: CODER_MAX_TOKENS, temperature: 0.4 });
    usage = addUsage(usage, reply.usage);
    appTsx = extractAppFiles(reply.text).appTsx;
    // Transient daemon hiccup (cold model, queued request, thinking-stripped
    // empty): a blockless reply gets ONE immediate retry before burning the
    // repair budget — live failure: two near-instant empty replies in a row.
    if (!appTsx) {
      yield {
        type: 'stage',
        stage: 'code',
        label: `Empty reply from ${coder.displayName ?? coder.id} (${reply.text.trim().length} chars) — retrying once`,
        memberId: coder.id,
        status: 'running',
      };
      reply = await coder.complete(buildCoderMessages(input.brief, spec, blueprint), { maxTokens: CODER_MAX_TOKENS, temperature: 0.5 });
      usage = addUsage(usage, reply.usage);
      appTsx = extractAppFiles(reply.text).appTsx;
    }
    appValidation = await validateApp(appTsx);
  } catch (error) {
    yield {
      type: 'stage',
      stage: 'code',
      label: 'Coder call failed',
      detail: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
      memberId: coder.id,
      status: 'done',
    };
    yield { type: 'result', result: null };
    return;
  }
  yield {
    type: 'stage',
    stage: 'validate',
    label: appValidation.ok ? `App.tsx static checks passed (${appValidation.checker})` : `App.tsx checks found ${appValidation.errors.length} issue(s)`,
    detail: appValidation.errors.slice(0, 3).join(' | ') || undefined,
    status: 'done',
  };

  // ── Council review (only worth convening over compilable code) ──
  const reviews: CodegenReviewNote[] = [];
  if (appValidation.ok && appTsx) {
    for (const reviewer of reviewers) {
      yield { type: 'stage', stage: 'review', label: `${reviewer.displayName ?? reviewer.id} is reviewing the build`, memberId: reviewer.id, status: 'running' };
      try {
        const reply = await reviewer.complete(
          buildReviewerMessages(input.brief, spec, appTsx, blueprint),
          { maxTokens: REVIEWER_MAX_TOKENS, temperature: 0.2 },
        );
        usage = addUsage(usage, reply.usage);
        reviews.push(parseReview(reviewer.id, reply.text));
      } catch (error) {
        reviews.push({
          memberId: reviewer.id,
          verdict: 'ship',
          mustFix: [],
          notes: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
      actedMemberIds.push(reviewer.id);
      const note = reviews[reviews.length - 1];
      yield {
        type: 'stage',
        stage: 'review',
        label: note.error
          ? `${reviewer.displayName ?? reviewer.id} could not review (non-blocking)`
          : `${reviewer.displayName ?? reviewer.id}: ${note.verdict === 'ship' ? 'ship it' : `needs work (${note.mustFix.length} must-fix)`}`,
        detail: note.mustFix.slice(0, 2).join(' | ') || undefined,
        memberId: reviewer.id,
        status: 'done',
      };
    }
  }

  // ── Bounded App repair: validation errors first, then reviewer must-fixes ──
  let repairsUsed = 0;
  while (repairsUsed < maxRepairs) {
    const reviewDriven = appValidation.ok && reviews.some((r) => r.mustFix.length > 0);
    const issues = [
      ...appValidation.errors,
      ...(appValidation.ok ? reviews.flatMap((r) => r.mustFix) : []),
    ].slice(0, 6);
    if (issues.length === 0 && appTsx) break;
    if (issues.length === 0) issues.push('No src/App.tsx code block was produced — emit the complete file.');

    repairsUsed += 1;
    yield {
      type: 'stage',
      stage: 'repair',
      label: `App repair pass ${repairsUsed}/${maxRepairs} (${issues.length} issue(s))`,
      detail: issues.slice(0, 2).join(' | '),
      memberId: coder.id,
      status: 'running',
    };
    try {
      const reply = await coder.complete(
        buildRepairMessages(input.brief, spec, appTsx ?? '', issues, blueprint),
        { maxTokens: CODER_MAX_TOKENS, temperature: 0.3 },
      );
      usage = addUsage(usage, reply.usage);
      const repairedApp = extractAppFiles(reply.text).appTsx;
      const repairedValidation = await validateApp(repairedApp);
      const changed = repairedApp !== null && repairedApp !== appTsx;
      const improved = changed && (
        appTsx === null
        || (repairedValidation.ok && !appValidation.ok)
        || (repairedValidation.ok === appValidation.ok && repairedValidation.errors.length < appValidation.errors.length)
        || (appValidation.ok && repairedValidation.ok) // review-driven rewrite with clean checks
      );
      if (improved) {
        appTsx = repairedApp;
        appValidation = repairedValidation;
      }
      yield {
        type: 'stage',
        stage: 'repair',
        label: improved
          ? (appValidation.ok ? 'Repair fixed the blocking issues' : `Repair improved the build (${appValidation.errors.length} issue(s) left)`)
          : 'Repair did not improve the build — keeping the previous version',
        status: 'done',
      };
      // Reviewer must-fixes get exactly one repair attempt — win or lose —
      // so a strict reviewer can't burn the whole budget on taste. Validation
      // errors DO get the remaining budget.
      if (reviewDriven && improved) reviews.length = 0;
    } catch {
      yield { type: 'stage', stage: 'repair', label: 'Repair call failed — keeping the previous version', status: 'done' };
      break;
    }
  }

  const unresolvedReviewIssues = reviews.flatMap((review) => review.mustFix);
  if (unresolvedReviewIssues.length > 0) {
    yield {
      type: 'stage',
      stage: 'validate',
      label: `Build withheld — ${unresolvedReviewIssues.length} Council must-fix issue(s) remain`,
      detail: unresolvedReviewIssues.slice(0, 2).join(' | '),
      status: 'done',
    };
  }
  if (!appValidation.ok || !appTsx || unresolvedReviewIssues.length > 0) {
    yield { type: 'result', result: null };
    return;
  }

  // ── Stylist: CSS for the EXACT class list extracted from the final App ──
  const classNames = extractClassNames(appTsx);
  yield {
    type: 'stage',
    stage: 'style',
    label: `${coder.displayName ?? coder.id} is styling ${classNames.length} classes (${spec.title})`,
    detail: classNames.slice(0, 8).join(', '),
    memberId: coder.id,
    status: 'running',
  };
  let stylesCss: string | null = null;
  let pairValidation: AppValidationReport | null = null;
  let stylistRepairs = 0;
  try {
    let reply = await coder.complete(buildStylistMessages(spec, classNames, appTsx, blueprint), { maxTokens: STYLIST_MAX_TOKENS, temperature: 0.4 });
    usage = addUsage(usage, reply.usage);
    stylesCss = extractAppFiles(reply.text).stylesCss;
    if (!stylesCss) {
      yield { type: 'stage', stage: 'style', label: 'Empty stylist reply — retrying once', memberId: coder.id, status: 'running' };
      reply = await coder.complete(buildStylistMessages(spec, classNames, appTsx, blueprint), { maxTokens: STYLIST_MAX_TOKENS, temperature: 0.5 });
      usage = addUsage(usage, reply.usage);
      stylesCss = extractAppFiles(reply.text).stylesCss;
    }
    pairValidation = await validateGeneratedApp({ appTsx, stylesCss });
    while (stylistRepairs < 2) {
      const issues = [...pairValidation.errors, ...pairValidation.softErrors].slice(0, 6);
      if (issues.length === 0 && stylesCss) break;
      if (issues.length === 0) issues.push('No src/styles.css code block was produced — emit the complete stylesheet.');
      stylistRepairs += 1;
      yield {
        type: 'stage',
        stage: 'style',
        label: `Style repair pass ${stylistRepairs}/2 (${issues.length} issue(s))`,
        detail: issues.slice(0, 2).join(' | '),
        memberId: coder.id,
        status: 'running',
      };
      const repairReply = await coder.complete(
        buildStylistRepairMessages(spec, classNames, stylesCss ?? '', issues, blueprint),
        { maxTokens: STYLIST_MAX_TOKENS, temperature: 0.3 },
      );
      usage = addUsage(usage, repairReply.usage);
      const repairedCss = extractAppFiles(repairReply.text).stylesCss;
      const repairedValidation = await validateGeneratedApp({ appTsx, stylesCss: repairedCss });
      const better = repairedCss !== null && (
        stylesCss === null
        || repairedValidation.errors.length < pairValidation.errors.length
        || (repairedValidation.errors.length === pairValidation.errors.length
          && repairedValidation.softErrors.length <= pairValidation.softErrors.length)
      );
      if (better) {
        stylesCss = repairedCss;
        pairValidation = repairedValidation;
      }
    }
  } catch {
    yield { type: 'stage', stage: 'style', label: 'Stylist call failed', memberId: coder.id, status: 'done' };
    yield { type: 'result', result: null };
    return;
  }
  yield {
    type: 'stage',
    stage: 'style',
    label: pairValidation?.ok ? 'Stylesheet covers the app — visual checks passed' : `Styling still failing (${pairValidation?.errors.length ?? 0} issue(s))`,
    detail: pairValidation && !pairValidation.ok ? pairValidation.errors.slice(0, 2).join(' | ') : undefined,
    status: 'done',
  };

  if (!pairValidation?.ok || !stylesCss) {
    yield { type: 'result', result: null };
    return;
  }

  yield { type: 'stage', stage: 'assemble', label: `Assembling ${spec.title} onto the Vite scaffold`, status: 'done' };
  const files: ExtractedAppFiles = { appTsx, stylesCss };
  const result: CouncilCodegenResult = {
    output: assembleOutput(spec, files, actedMemberIds),
    spec,
    validation: pairValidation,
    reviews,
    repairsUsed: repairsUsed + stylistRepairs,
    usage,
    memberIds: actedMemberIds,
  };
  yield { type: 'result', result };
}

function fenceLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'tsx') return 'tsx';
  if (ext === 'ts') return 'ts';
  if (ext === 'css') return 'css';
  if (ext === 'html') return 'html';
  if (ext === 'json') return 'json';
  return '';
}

function renderEditOutput(projectName: string, _brief: string, files: ReadonlyMap<string, string>, _memberIds: readonly string[]): string {
  const blocks: string[] = [];
  for (const [path, body] of files) {
    blocks.push(`\`\`\`${fenceLanguage(path)} title="${path}"\n${body}\n\`\`\``);
  }
  const changed = [...files.keys()].join(', ');
  return [
    `Prepared a Council-reviewed change for **${projectName}**. ${files.size} file${files.size === 1 ? ' is' : 's are'} ready for review: ${changed}. Nothing is applied until the project approval step completes.`,
    '',
    ...blocks,
  ].join('\n');
}

interface EditCandidate {
  readonly files: ReadonlyMap<string, string>;
  readonly validation: AppValidationReport;
  readonly rawOutput: string;
  readonly safetyFixes: readonly string[];
}

function betterEditCandidate(a: EditCandidate | null, b: EditCandidate): EditCandidate {
  if (!a) return b;
  if (a.validation.ok !== b.validation.ok) return a.validation.ok ? a : b;
  if (a.validation.errors.length !== b.validation.errors.length) {
    return b.validation.errors.length < a.validation.errors.length ? b : a;
  }
  return b.validation.softErrors.length < a.validation.softErrors.length ? b : a;
}

function editFilesDiffer(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  if (left.size !== right.size) return true;
  for (const [path, content] of left) {
    if (right.get(path) !== content) return true;
  }
  return false;
}

/** Review the complete changed surface, not whichever file happened to be first. */
function renderEditReviewSource(files: ReadonlyMap<string, string>): string | null {
  const sourceFiles = [...files.entries()].filter(([path]) => /\.(?:tsx|ts|jsx|js)$/i.test(path));
  if (sourceFiles.length === 0) return null;
  return sourceFiles.map(([path, content]) => `// FILE: ${path}\n${content}`).join('\n\n');
}

function briefReportsUndefinedClientRpc(brief: string): boolean {
  return /(?:\/undefined|undefined\s+RPC|server-only\s+(?:env|environment)|browser\s+code\s+reads\s+server-only)/i.test(brief);
}

function briefReportsOptionalAnalyticsCrash(brief: string): boolean {
  return /(?:optional\s+AppKit\s+analytics|analytics[^.\n]{0,80}(?:uncaught|crash|page error)|(?:uncaught|crash|page error)[^.\n]{0,80}analytics)/i.test(brief);
}

function briefReportsBrokenBookCovers(brief: string): boolean {
  return /(?:broken\s+(?:#\s*)?(?:cover|image)|#\s*cover|broken\s+img\s+source)/i.test(brief);
}

function briefRequestsClampedBookProgress(brief: string): boolean {
  return /\bclamp\b[\s\S]{0,100}\b(?:currentPage|progress)|\bprogress\b[\s\S]{0,100}\bcannot exceed 100%/i.test(brief);
}

function briefPreservesBookPersistence(brief: string): boolean {
  return /\bpreserve\b[\s\S]{0,100}\blocalStorage\b|\blocalStorage persistence\b/i.test(brief);
}

function renderEditFilesForRepair(files: ReadonlyMap<string, string>): string {
  return [...files.entries()]
    .map(([path, content]) => `\`\`\`${fenceLanguage(path)} title="${path}"\n${content}\n\`\`\``)
    .join('\n\n');
}

function normalizeEditPath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Known safety repairs may recover an explicitly named workspace file even
 * when a small local coder forgot to re-emit it. Unnamed reference files never
 * enter the candidate, which keeps this deterministic lane tightly scoped to
 * the user's requested surface.
 */
function collectExplicitRepairSources(
  brief: string,
  proposedFiles: ReadonlyMap<string, string>,
  referenceFiles: readonly { path: string; content: string }[],
): Map<string, { content: string; proposed: boolean }> {
  const sources = new Map<string, { content: string; proposed: boolean }>();
  for (const [path, content] of proposedFiles) {
    sources.set(normalizeEditPath(path), { content, proposed: true });
  }

  const normalizedBrief = normalizeEditPath(brief).toLowerCase();
  for (const reference of referenceFiles) {
    const path = normalizeEditPath(reference.path);
    if (sources.has(path) || !normalizedBrief.includes(path.toLowerCase())) continue;
    sources.set(path, { content: reference.content, proposed: false });
  }
  return sources;
}

function preserveReferenceLineEndings(
  files: ReadonlyMap<string, string>,
  referenceFiles: readonly { path: string; content: string }[],
): ReadonlyMap<string, string> {
  const references = new Map(referenceFiles.map((file) => [normalizeEditPath(file.path), file.content]));
  return new Map([...files.entries()].map(([path, content]) => {
    const reference = references.get(normalizeEditPath(path));
    if (!reference) return [path, content] as const;
    const lf = content.replace(/\r\n/g, '\n');
    return [path, reference.includes('\r\n') ? lf.replace(/\n/g, '\r\n') : lf] as const;
  }));
}

/** Small, inspectable repairs for runtime signatures Vai knows how to fix safely. */
function applyDeterministicEditRepairs(
  brief: string,
  inputFiles: ReadonlyMap<string, string>,
  referenceFiles: readonly { path: string; content: string }[] = [],
): { files: ReadonlyMap<string, string>; fixes: readonly string[] } {
  const sources = collectExplicitRepairSources(brief, inputFiles, referenceFiles);
  const repairsBookCovers = briefReportsBrokenBookCovers(brief);
  const repairsBookProgress = briefRequestsClampedBookProgress(brief);
  const repairsBookPersistence = briefPreservesBookPersistence(brief);
  if (repairsBookCovers || repairsBookProgress || repairsBookPersistence) {
    for (const reference of referenceFiles) {
      const path = normalizeEditPath(reference.path);
      if (!/(?:^|\/)src\/(?:App\.tsx|styles\.css)$/i.test(path) || sources.has(path)) continue;
      sources.set(path, { content: reference.content, proposed: false });
    }
  }
  const files = new Map<string, string>();
  const fixes: string[] = [];
  for (const [path, source] of sources) {
    if (source.proposed) files.set(path, source.content);
  }

  // React 19 + automatic JSX projects do not necessarily expose the legacy
  // global `JSX` namespace. Component return types are fully inferable, so
  // remove only function/arrow return annotations that would otherwise turn
  // valid inline-SVG artwork into a deterministic compile failure. Do not
  // rewrite JSX.Element used as a property or collection type.
  let jsxReturnTypeRepairs = 0;
  for (const [path, source] of sources) {
    if (!source.proposed || !/\.[jt]sx$/i.test(path)) continue;
    const current = files.get(path) ?? source.content;
    const next = current.replace(
      /(\))\s*:\s*JSX\.Element(?:\s*\[\s*\])?(?:\s*\|\s*null)?(\s*(?:=>|\{))/g,
      (_match, closeParen: string, bodyStart: string) => {
        jsxReturnTypeRepairs += 1;
        return `${closeParen}${bodyStart}`;
      },
    );
    if (next !== current) files.set(path, next);
  }
  if (jsxReturnTypeRepairs > 0) {
    fixes.push(`removed ${jsxReturnTypeRepairs} unavailable global JSX component return annotation(s); TypeScript will infer the React return type`);
  }

  // SVG copied from HTML uses kebab-case attributes that React accepts at
  // compile time but warns about in the rendered browser. Normalize the small,
  // standard set we observe in generated cover art before visual verification.
  const reactSvgAttributeMap: Readonly<Record<string, string>> = {
    'text-anchor': 'textAnchor',
    'font-family': 'fontFamily',
    'font-size': 'fontSize',
    'stroke-width': 'strokeWidth',
    'stroke-linecap': 'strokeLinecap',
    'stroke-linejoin': 'strokeLinejoin',
    'fill-rule': 'fillRule',
    'clip-rule': 'clipRule',
  };
  let svgAttributeRepairs = 0;
  for (const [path, source] of sources) {
    if (!source.proposed || !/\.[jt]sx$/i.test(path)) continue;
    const current = files.get(path) ?? source.content;
    const next = current.replace(
      /(\s)(text-anchor|font-family|font-size|stroke-width|stroke-linecap|stroke-linejoin|fill-rule|clip-rule)(\s*=)/g,
      (_match, leading: string, attribute: string, equals: string) => {
        svgAttributeRepairs += 1;
        return `${leading}${reactSvgAttributeMap[attribute]}${equals}`;
      },
    );
    if (next !== current) files.set(path, next);
  }
  if (svgAttributeRepairs > 0) {
    fixes.push(`normalized ${svgAttributeRepairs} SVG attribute(s) to React DOM property names`);
  }

  // Small models often build illustrated covers as a fixed title -> <svg>
  // object, then index it with a wider `string`. Keep the precise literal map,
  // but guard the dynamic lookup and narrow the key only after hasOwnProperty
  // proves it exists. This fixes TS7053 without turning missing artwork into a
  // runtime exception or pretending every string is a valid title.
  let illustratedMapRepairs = 0;
  for (const [path, source] of sources) {
    if (!source.proposed || !/\.[jt]sx$/i.test(path)) continue;
    let next = files.get(path) ?? source.content;
    const artworkMapNames = [...next.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(\{[\s\S]{0,8000}?\n\s*\});/g)]
      .filter((match) => /<svg\b/i.test(match[2] ?? ''))
      .map((match) => match[1]!);
    for (const mapName of artworkMapNames) {
      const escapedMapName = mapName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const accessPattern = new RegExp(`\\b${escapedMapName}\\[([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)?)\\]`, 'g');
      next = next.replace(accessPattern, (_match, key: string) => {
        illustratedMapRepairs += 1;
        return `(Object.prototype.hasOwnProperty.call(${mapName}, ${key}) ? ${mapName}[${key} as keyof typeof ${mapName}] : null)`;
      });
    }
    if (next !== (files.get(path) ?? source.content)) files.set(path, next);
  }
  if (illustratedMapRepairs > 0) {
    fixes.push(`guarded and typed ${illustratedMapRepairs} dynamic illustrated-cover map lookup(s)`);
  }

  if (briefReportsUndefinedClientRpc(brief)) {
    let replacements = 0;
    for (const [path, source] of sources) {
      let next = files.get(path) ?? source.content;
      next = next.replace(
        /http\(\s*`https?:\/\/[^`]*\$\{\s*process\.env\.(?!NEXT_PUBLIC_)[A-Z0-9_]+\s*\}[^`]*`\s*\)/g,
        () => { replacements += 1; return 'http()'; },
      );
      next = next.replace(/process\.env\.NEXT_PUBLIC_PROJECT_ID\s+as\s+string/g, () => {
        replacements += 1;
        return "process.env.NEXT_PUBLIC_PROJECT_ID?.trim() ?? ''";
      });
      if (source.proposed || next !== source.content) files.set(path, next);
    }
    if (replacements > 0) fixes.push(`replaced ${replacements} client RPC secret interpolation(s) with chain-default public transports`);
  }

  if (briefReportsOptionalAnalyticsCrash(brief)) {
    let replacements = 0;
    for (const [path, source] of sources) {
      let next = files.get(path) ?? source.content;
      next = next.replace(/analytics\s*:\s*true\b/g, () => { replacements += 1; return 'analytics: false'; });
      next = next.replace(/process\.env\.NEXT_PUBLIC_PROJECT_ID\s+as\s+string/g, () => {
        replacements += 1;
        return "process.env.NEXT_PUBLIC_PROJECT_ID?.trim() ?? ''";
      });
      const projectIdBinding = next.match(/createAppKit\s*\(\s*\{[\s\S]*?\bprojectId\s*:\s*([A-Za-z_$][\w$]*)/)?.[1];
      if (projectIdBinding) {
        const escapedBinding = projectIdBinding.replace(/[$]/g, '\\$&');
        next = next.replace(
          /if\s*\(typeof window !== 'undefined' && !window\.__APPKIT_INITIALIZED__\)\s*\{/g,
          () => {
            replacements += 1;
            return `if (typeof window !== 'undefined' && !window.__APPKIT_INITIALIZED__ && Boolean(${projectIdBinding})) {`;
          },
        );
        next = next.replace(
          new RegExp(`projectId\\s*:\\s*${escapedBinding}\\s*\\?\\?\\s*['"]{2}`),
          () => { replacements += 1; return `projectId: ${projectIdBinding}`; },
        );
      }
      if (/createAppKit\(\{/.test(next) && !/try\s*\{\s*createAppKit\(\{/s.test(next)) {
        next = next.replace(
          /^([ \t]*)createAppKit\(\{([\s\S]*?)^[ \t]*\}\)[ \t]*\r?\n[ \t]*window\.__APPKIT_INITIALIZED__[ \t]*=[ \t]*true/m,
          (_match, indent: string, body: string) => {
            replacements += 1;
            const indentedBody = body
              .replace(/\r\n/g, '\n')
              .split('\n')
              .map((line, index) => (index === 0 || line.trim().length === 0 ? line : `  ${line}`))
              .join('\n');
            return [
              `${indent}try {`,
              `${indent}  createAppKit({${indentedBody}${indent}  })`,
              `${indent}  window.__APPKIT_INITIALIZED__ = true`,
              `${indent}} catch (error) {`,
              `${indent}  console.error('AppKit initialization failed without blocking the app shell.', error)`,
              `${indent}}`,
            ].join('\n');
          },
        );
      }
      if (source.proposed || next !== source.content) files.set(path, next);
    }
    if (replacements > 0) fixes.push(`hardened ${replacements} optional AppKit initialization/analytics path(s) implicated in uncaught fetch failures`);
  }

  if (repairsBookCovers || repairsBookProgress || repairsBookPersistence) {
    let replacements = 0;
    for (const [path, source] of sources) {
      let next = files.get(path) ?? source.content;
      if (/App\.tsx$/i.test(path)) {
        if (repairsBookCovers) {
          next = next.replace(/\bcoverImage\s*:\s*string;\s*/g, () => { replacements += 1; return ''; });
          next = next.replace(/\s*coverImage\s*:\s*["']#["']\s*,/g, () => { replacements += 1; return ''; });
          next = next.replace(
            /<img\s+src=\{([A-Za-z_$][\w$]*)\.coverImage\}\s+alt=\{\1\.title\}\s*\/>/g,
            (_match, book: string) => {
              replacements += 1;
              return `<div className="book-cover" role="img" aria-label={\`${'${'}${book}.title} cover\`}><span>{${book}.title.slice(0, 1)}</span></div>`;
            },
          );
          next = next.replace(
            /<img\s+src=\{`data:image\/svg\+xml[^`]*`\}\s+alt=\{([A-Za-z_$][\w$]*)\.title\}\s*\/>/g,
            (_match, book: string) => {
              replacements += 1;
              return `<div className="book-cover" role="img" aria-label={\`${'${'}${book}.title} cover\`}><span>{${book}.title.slice(0, 1)}</span></div>`;
            },
          );
        }
        if (repairsBookProgress) {
          next = next.replace('min="1"', () => { replacements += 1; return 'min="0"'; });
          next = next.replace(/\.map\(\(book,\s*index\)\s*=>/g, () => { replacements += 1; return '.map((book) =>'; });
          next = next.replace(
            /const newBooks = \[\.\.\.booksState\];\s*newBooks\[index\]\.currentPage = parseInt\(e\.target\.value, 10\);\s*setBooksState\(newBooks\);/g,
            () => {
              replacements += 1;
              return [
                'const parsedPage = Number.parseInt(e.target.value, 10);',
                '                  const nextPage = Math.max(0, Math.min(book.totalPages, Number.isFinite(parsedPage) ? parsedPage : 0));',
                '                  setBooksState((current) => current.map((item) => item.id === book.id ? { ...item, currentPage: nextPage } : item));',
              ].join('\n');
            },
          );
        }
        if (repairsBookPersistence) {
          next = next.replace(
            /const \[booksState, setBooksState\] = useState<Book\[]>\(books\);\s*useEffect\(\(\) => \{\s*localStorage\.setItem\('books', JSON\.stringify\(booksState\)\);\s*\}, \[booksState\]\);\s*useEffect\(\(\) => \{\s*const savedBooks = localStorage\.getItem\('books'\);\s*if \(savedBooks\) \{\s*setBooksState\(JSON\.parse\(savedBooks\)\);\s*\}\s*\}, \[\]\);/s,
            () => {
              replacements += 1;
              return [
                'const [booksState, setBooksState] = useState<Book[]>(() => {',
                "    const savedBooks = localStorage.getItem('books');",
                '    return savedBooks ? JSON.parse(savedBooks) as Book[] : books;',
                '  });',
                '',
                '  useEffect(() => {',
                "    localStorage.setItem('books', JSON.stringify(booksState));",
                '  }, [booksState]);',
              ].join('\n');
            },
          );
        }
      }
      if (repairsBookCovers && /styles\.css$/i.test(path) && !/\.book-cover\b/.test(next)) {
        replacements += 1;
        next = `${next.trimEnd()}\n\n.book-cover { aspect-ratio: 3 / 4; display: grid; place-items: center; overflow: hidden; border-radius: 0.8rem; color: white; background: linear-gradient(145deg, #334155, #7c3aed 55%, #ec4899); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 18%); }\n.book-cover span { font-size: clamp(2rem, 8vw, 4rem); font-weight: 800; text-shadow: 0 2px 14px rgb(15 23 42 / 45%); }`;
      }
      if (source.proposed || next !== source.content) files.set(path, next);
    }
    if (replacements > 0) fixes.push(`repaired ${replacements} broken-cover, bounded-progress, or persistence signature(s) from the observed Book Tracker`);
  }

  return { files: preserveReferenceLineEndings(files, referenceFiles), fixes };
}

/**
 * Turn concrete runtime evidence from the user's brief into deterministic
 * validation constraints. Reviewers can vary; a known failing signature may
 * not survive merely because a model voted "ship" on a later run.
 */
function applyEditBriefInvariants(
  brief: string,
  files: ReadonlyMap<string, string>,
  validation: AppValidationReport,
): AppValidationReport {
  const errors = [...validation.errors];
  const joined = [...files.entries()].map(([path, content]) => `FILE ${path}\n${content}`).join('\n');
  const css = [...files.entries()]
    .filter(([path]) => /\.css$/i.test(path))
    .map(([, content]) => content)
    .join('\n');

  const emptyInlineSvgs = [...joined.matchAll(/<svg\b[^>]*>([\s\S]*?)<\/svg>/gi)]
    .filter((match) => match[1].replace(/\{?\/\*[\s\S]*?\*\/\}?|<!--[\s\S]*?-->|\s+/g, '').length === 0);
  if (emptyInlineSvgs.length > 0) {
    errors.push(`Requested inline artwork still contains ${emptyInlineSvgs.length} empty SVG placeholder(s); add real paths/shapes or omit the SVG.`);
  }

  const svgBodies = [...joined.matchAll(/<svg\b[^>]*>([\s\S]*?)<\/svg>/gi)].map((match) => match[1]);
  if (/\b(?:genuinely\s+distinct|genuinely\s+different|distinct[\s\S]{0,30}compositions?|different[\s\S]{0,30}compositions?|do not reuse[\s\S]{0,30}template)\b/i.test(brief)
    && svgBodies.length >= 2) {
    const nonTextStructures = svgBodies.map((body) => body
      .replace(/<text\b[\s\S]*?<\/text>/gi, '')
      .replace(/#[0-9a-f]{3,8}/gi, '#color')
      .replace(/\s+/g, ''));
    const uniqueStructures = new Set(nonTextStructures);
    if (uniqueStructures.size < nonTextStructures.length) {
      errors.push(`Distinct cover compositions were requested, but ${nonTextStructures.length - uniqueStructures.size + 1} SVGs reuse the same non-text structure.`);
    }
    const textOnlyCount = svgBodies.filter((body) => !/<(?:path|circle|ellipse|line|polyline|polygon)\b/i.test(body)).length;
    if (textOnlyCount > 0) {
      errors.push(`${textOnlyCount} requested illustrated cover(s) are only text/background shapes; add real illustrative geometry.`);
    }
  }

  if (/\b(?:do not|don['’]?t|without)\b[\s\S]{0,40}\bpurple(?:\/pink)?(?:\s+gradient)?/i.test(brief)
    && /(?:#7c3aed|#8b5cf6|#ec4899|\bpurple\b)/i.test(css)) {
    errors.push('The explicitly rejected purple/pink gradient palette is still present in the stylesheet.');
  }

  if (/\b(?:paper|line|grain|noise)\s*(?:and\s+|\/\s*)?texture\b|\btexture\b/i.test(brief)
    && !/(?:repeating-(?:linear|radial)-gradient|radial-gradient)\s*\(/i.test(css)) {
    errors.push('The requested paper/line texture is missing from the stylesheet.');
  }
  if (/\brepeating-linear-gradient\b/i.test(brief) && !/repeating-linear-gradient\s*\(/i.test(css)) {
    errors.push('The requested repeating-linear-gradient texture is missing from the stylesheet.');
  }
  if (/\bradial-gradient\b/i.test(brief) && !/radial-gradient\s*\(/i.test(css)) {
    errors.push('The requested radial-gradient light layer is missing from the stylesheet.');
  }

  if (/\b(?:search|filter)[\s\S]{0,100}\b(?:gap|margin|spacing|space)[\s\S]{0,100}\b(?:grid|cards?|results?)\b/i.test(brief)) {
    const searchBarBlock = css.match(/\.search-bar\s*\{([^}]*)\}/i)?.[1] ?? '';
    if (!/\bgap\s*:/i.test(searchBarBlock) || !/\bmargin-bottom\s*:/i.test(searchBarBlock)) {
      errors.push('The requested search/filter spacing is incomplete: .search-bar needs both an internal gap and margin below it before the results grid.');
    }
  }
  if (/\b(?:gap|margin|spacing|space|separation)\b[\s\S]{0,80}\b(?:between|below)\b[\s\S]{0,80}\b(?:header|stats?)\b[\s\S]{0,80}\bsearch|\bsearch\b[\s\S]{0,80}\b(?:top|above)\b[\s\S]{0,80}\b(?:gap|margin|spacing|space)/i.test(brief)) {
    const searchBarBlock = css.match(/\.search-bar\s*\{([^}]*)\}/i)?.[1] ?? '';
    const topMargin = searchBarBlock.match(/\bmargin-top\s*:\s*([0-9]*\.?[0-9]+)(?:rem|em|px)/i);
    if (!topMargin || Number.parseFloat(topMargin[1] ?? '0') <= 0) {
      errors.push('The requested separation between the stats header and search panel is missing: .search-bar needs a positive margin-top.');
    }
  }

  const caseBody = (title: string): string => {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return joined.match(new RegExp(`case\\s+['"]${escaped}['"]\\s*:[\\s\\S]*?return\\s*\\(([\\s\\S]*?)\\);`, 'i'))?.[1] ?? '';
  };
  const countTag = (source: string, tag: string): number => (source.match(new RegExp(`<${tag}\\b`, 'gi')) ?? []).length;
  const countUniqueTagGeometry = (source: string, tag: string): number => {
    const openings = source.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) ?? [];
    return new Set(openings.map((opening) => opening
      .replace(/\\s(?:fill|stroke|className|role|aria-label)\\s*=\\s*(?:"[^"]*"|'[^']*'|\\{[^}]*\\})/gi, '')
      .replace(/#[0-9a-f]{3,8}/gi, '#color')
      .replace(/\\s+/g, ' ')
      .trim())).size;
  };
  const sceneChecks = [
    {
      title: 'To Kill a Mockingbird',
      requested: /\b(?:To Kill a )?Mockingbird\b[\s\S]{0,120}\b(?:moon|branch|bird|perched)\b/i,
      valid: (source: string) => countTag(source, 'circle') >= 1 && countTag(source, 'path') >= 1 && countTag(source, 'polygon') >= 1,
      detail: 'a moon circle, branch path, and perched-bird polygon',
    },
    {
      title: '1984',
      requested: /\b1984\b[\s\S]{0,100}\b(?:eye|surveillance|rays?)\b/i,
      valid: (source: string) => countTag(source, 'ellipse') >= 1 && countTag(source, 'circle') >= 1 && countUniqueTagGeometry(source, 'line') >= 3,
      detail: 'an eye ellipse, pupil circle, and at least three geometrically distinct surveillance rays',
    },
    {
      title: 'The Great Gatsby',
      requested: /\bGatsby\b[\s\S]{0,120}\b(?:skyline|beacon|art[- ]deco)\b/i,
      valid: (source: string) => (countUniqueTagGeometry(source, 'rect') + countUniqueTagGeometry(source, 'polygon')) >= 2 && countTag(source, 'circle') >= 1,
      detail: 'multiple geometrically distinct skyline/deco structures and a beacon circle',
    },
    {
      title: 'Pride and Prejudice',
      requested: /\bPride and Prejudice\b[\s\S]{0,120}\b(?:cameo|profiles?|botanical|leaves?)\b/i,
      valid: (source: string) => countTag(source, 'ellipse') >= 1 && countUniqueTagGeometry(source, 'path') >= 2,
      detail: 'a cameo ellipse plus geometrically distinct profile/botanical paths',
    },
    {
      title: 'The Catcher in the Rye',
      requested: /\bCatcher in the Rye\b[\s\S]{0,120}\b(?:wheat|horse)\b/i,
      valid: (source: string) => countUniqueTagGeometry(source, 'line') >= 3 && countTag(source, 'path') >= 1,
      detail: 'geometrically distinct wheat stems and a horse path',
    },
  ] as const;
  for (const check of sceneChecks) {
    if (check.requested.test(brief) && !check.valid(caseBody(check.title))) {
      errors.push(`${check.title} cover does not yet contain the requested recognizable scene: ${check.detail}.`);
    }
  }

  if (/\b(?:distinct|different)[\s\S]{0,30}\bpalettes?\b/i.test(brief)) {
    const paletteSignatures = ['To Kill a Mockingbird', '1984', 'The Great Gatsby', 'Pride and Prejudice', 'The Catcher in the Rye']
      .map((title) => [...new Set(caseBody(title).match(/#[0-9a-f]{3,8}/gi) ?? [])].sort().join(','))
      .filter(Boolean);
    if (paletteSignatures.length >= 2 && new Set(paletteSignatures).size < paletteSignatures.length) {
      errors.push('Distinct cover palettes were requested, but multiple title cases still reuse the same SVG color set.');
    }
  }

  const invalidReactSvgAttributes = joined.match(/\s(?:text-anchor|font-family|font-size|stroke-width|stroke-linecap|stroke-linejoin|fill-rule|clip-rule)\s*=/gi) ?? [];
  if (invalidReactSvgAttributes.length > 0) {
    errors.push(`${invalidReactSvgAttributes.length} SVG attribute(s) still use HTML kebab-case and will warn in React; use camelCase DOM property names.`);
  }

  if (/\b(?:deep[- ]ink|dark (?:page|background|theme)|atmospheric[\s\S]{0,40}background)\b/i.test(brief)) {
    const hasDarkPageBackground = /body\s*\{[^}]*background(?:-color)?\s*:[^;]*(?:#[01][0-9a-f]{2,6}|rgb\(\s*(?:[0-3]?\d)\s*,\s*(?:[0-3]?\d)\s*,\s*(?:[0-3]?\d)|oklch\([^)]*0\.[0-4])/is.test(css);
    if (!hasDarkPageBackground) {
      errors.push('Requested deep-ink/dark page atmosphere is missing: the stylesheet does not paint a dark body background.');
    }
  }

  const svgOpenings = joined.match(/<svg\b[^>]*>/gi) ?? [];
  const requestsSvgAccessibility = /\baccessible\b[\s\S]{0,80}\b(?:svg|artwork|cover)|\baria-labels?\b|\brole\s*=\s*["']?img/i.test(brief);
  if (requestsSvgAccessibility && svgOpenings.length > 0) {
    const requiresBoth = /\baria-labels?\b[\s\S]{0,80}\brole\s*=\s*["']?img|\brole\s*=\s*["']?img[\s\S]{0,80}\baria-labels?\b/i.test(brief);
    const incomplete = svgOpenings.filter((opening) => {
      const hasLabel = /\baria-label\s*=\s*(?:"[^"]+"|'[^']+'|\{[^}]+\})/i.test(opening);
      const hasRole = /\brole\s*=\s*["']img["']/i.test(opening);
      return requiresBoth ? !hasLabel || !hasRole : !hasLabel && !hasRole;
    });
    if (incomplete.length > 0) {
      errors.push(`${incomplete.length} requested SVG cover(s) are missing ${requiresBoth ? 'both a meaningful aria-label and role="img"' : 'an aria-label or role="img" description'}.`);
    }
    if (/\bunique\b[\s\S]{0,30}\baria-labels?\b/i.test(brief)) {
      const labels = svgOpenings
        .map((opening) => opening.match(/\baria-label\s*=\s*("[^"]+"|'[^']+'|\{[^}]+\})/i)?.[1]?.replace(/\s+/g, ' ').trim())
        .filter((label): label is string => Boolean(label));
      if (labels.length >= 2 && new Set(labels).size < labels.length) {
        errors.push('Unique SVG aria-labels were requested, but multiple covers reuse the same accessible name.');
      }
    }
  }

  const reportsUndefinedClientRpc = briefReportsUndefinedClientRpc(brief);
  if (reportsUndefinedClientRpc && /process\.env\.(?!(?:NEXT_PUBLIC_|NODE_ENV\b))[A-Z0-9_]+/.test(joined)) {
    errors.push('Observed runtime invariant still fails: client code still reads a server-only process.env value.');
  }
  if (reportsUndefinedClientRpc && /process\.env\.NEXT_PUBLIC_PROJECT_ID\s+as\s+string/.test(joined)) {
    errors.push('Observed runtime invariant still fails: the public AppKit project id is asserted as defined instead of handled as optional configuration.');
  }

  const reportsOptionalAnalyticsCrash = briefReportsOptionalAnalyticsCrash(brief);
  if (reportsOptionalAnalyticsCrash && /analytics\s*:\s*true\b/.test(joined)) {
    errors.push('Observed runtime invariant still fails: optional AppKit analytics remains enabled even though its fetch failure was reported as an uncaught page error.');
  }
  if (reportsOptionalAnalyticsCrash && /createAppKit\s*\(\s*\{/.test(joined)) {
    const projectIdBinding = joined.match(/createAppKit\s*\(\s*\{[\s\S]*?\bprojectId\s*:\s*([A-Za-z_$][\w$]*)/)?.[1];
    if (projectIdBinding) {
      const escapedBinding = projectIdBinding.replace(/[$]/g, '\\$&');
      const guarded = new RegExp(`Boolean\\(\\s*${escapedBinding}\\s*\\)|if\\s*\\(\\s*!\\s*${escapedBinding}\\s*\\)\\s*(?:\\{|return)`).test(joined);
      if (!guarded) {
        errors.push('Observed runtime invariant still fails: AppKit initialization is not gated on a configured public project id.');
      }
    }
    if (!/try\s*\{\s*createAppKit\s*\(\s*\{/s.test(joined)) {
      errors.push('Observed runtime invariant still fails: createAppKit initialization is not guarded against synchronous setup failures.');
    }
  }

  return errors.length === validation.errors.length
    ? validation
    : { ...validation, ok: false, errors };
}

type KnownRuntimeIssueKind = 'client-rpc' | 'appkit-init';

function classifyKnownReviewerClaim(issue: string): readonly KnownRuntimeIssueKind[] {
  const kinds: KnownRuntimeIssueKind[] = [];
  if (/(?:project\s*id|rpc|server-only|environment variable|process\.env).*(?:undefined|client|runtime|fetch)|\/undefined/i.test(issue)) {
    kinds.push('client-rpc');
  }
  if (/(?:appkit|createAppKit|analytics|network failure|uncaught page error)/i.test(issue)) {
    kinds.push('appkit-init');
  }
  return kinds;
}

function unresolvedKnownRuntimeKinds(brief: string, files: ReadonlyMap<string, string>): Set<KnownRuntimeIssueKind> {
  const joined = [...files.values()].join('\n');
  const unresolved = new Set<KnownRuntimeIssueKind>();
  if (briefReportsUndefinedClientRpc(brief) && (
    /process\.env\.(?!(?:NEXT_PUBLIC_|NODE_ENV\b))[A-Z0-9_]+/.test(joined)
    || /process\.env\.NEXT_PUBLIC_PROJECT_ID\s+as\s+string/.test(joined)
  )) {
    unresolved.add('client-rpc');
  }
  if (briefReportsOptionalAnalyticsCrash(brief)) {
    if (/analytics\s*:\s*true\b/.test(joined) || !/try\s*\{\s*createAppKit\s*\(\s*\{/s.test(joined)) {
      unresolved.add('appkit-init');
    }
    const projectIdBinding = joined.match(/createAppKit\s*\(\s*\{[\s\S]*?\bprojectId\s*:\s*([A-Za-z_$][\w$]*)/)?.[1];
    if (projectIdBinding) {
      const escapedBinding = projectIdBinding.replace(/[$]/g, '\\$&');
      if (!new RegExp(`Boolean\\(\\s*${escapedBinding}\\s*\\)|if\\s*\\(\\s*!\\s*${escapedBinding}\\s*\\)\\s*(?:\\{|return)`).test(joined)) {
        unresolved.add('appkit-init');
      }
    }
  }
  return unresolved;
}

function reconcileKnownRuntimeReviews(
  brief: string,
  candidate: EditCandidate,
  reviews: readonly CodegenReviewNote[],
): { reviews: CodegenReviewNote[]; dismissed: string[] } {
  if (candidate.safetyFixes.length === 0) return { reviews: [...reviews], dismissed: [] };
  const unresolved = unresolvedKnownRuntimeKinds(brief, candidate.files);
  const dismissed: string[] = [];
  const reconciled = reviews.map((review) => ({
    ...review,
    mustFix: review.mustFix.filter((issue) => {
      const kinds = classifyKnownReviewerClaim(issue);
      const disproven = kinds.length > 0 && kinds.every((kind) => !unresolved.has(kind));
      if (disproven) dismissed.push(issue);
      return !disproven;
    }),
  }));
  return { reviews: reconciled, dismissed };
}

/**
 * Edit-mode pipeline: patch the active project's files in place. Same
 * coder → validate → review → bounded-repair shape as a fresh build, but the
 * coder sees the CURRENT files, may only re-emit project source files, and
 * the result is the changed files verbatim — no scaffold, no new app name.
 */
async function* councilEditApp(input: CouncilCodegenInput, edit: CouncilEditContext): AsyncGenerator<CouncilCodegenEvent> {
  const rotateCoder = (input.resume?.repairsUsed ?? 0) >= 4 && input.members.length > 1;
  const coder = rotateCoder ? input.members[1] : input.members[0];
  const reviewers = input.members
    .filter((member) => member.id !== coder.id)
    .slice(0, input.maxReviewers ?? DEFAULT_MAX_REVIEWERS);
  const maxRepairs = input.maxRepairs ?? DEFAULT_MAX_REPAIRS;
  const allowedPaths = edit.files.filter((f) => !f.readonly).map((f) => f.path);
  const resumedProposal = input.resume?.schemaVersion === 1
    && input.resume.projectName === edit.projectName
    && input.resume.files.length > 0
    ? input.resume
    : undefined;
  const taskBrief = resumedProposal
    ? `${resumedProposal.brief}\n\nContinuation request: ${input.brief}`.slice(0, 12_000)
    : input.brief;
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
  const actedMemberIds: string[] = [...new Set([...(resumedProposal?.memberIds ?? []), coder.id])];

  const spec: CouncilAppSpec = {
    title: edit.projectName,
    packageName: edit.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'active-project',
    summary: taskBrief.trim().slice(0, 200),
    features: [taskBrief.trim().slice(0, 300)],
    fromArchitect: false,
  };

  const editValidationOptions = {
    external: edit.external,
    referenceFiles: edit.files,
    brief: taskBrief,
    allowConfigKeyRemoval: /\b(?:remove|delete|drop)\b/i.test(taskBrief),
    allowNewFiles: /\b(?:add|create|set\s*up|setup|scaffold|introduce|generate|establish|configure)\b[\s\S]{0,180}\b(?:hardhat|local\s+chain|deployment|tooling|config(?:uration)?|tests?|scripts?|contracts?|files?)\b/i.test(taskBrief),
  };
  const readOnlyReferenceCount = edit.files.filter((file) => file.readonly).length;
  yield {
    type: 'stage',
    stage: 'architect',
    label: `Planned a targeted edit for ${edit.projectName}`,
    detail: `${allowedPaths.length} existing file(s) may change · ${readOnlyReferenceCount} reference file(s) remain read-only · safe new project files ${editValidationOptions.allowNewFiles ? 'allowed by this request' : 'blocked'}`,
    status: 'done',
  };
  let candidate: EditCandidate;
  if (resumedProposal) {
    const resumedFiles = new Map(resumedProposal.files.map((file) => [file.path, file.content]));
    const deterministicRepair = applyDeterministicEditRepairs(taskBrief, resumedFiles, edit.files);
    const files = deterministicRepair.files;
    const validation = applyEditBriefInvariants(
      taskBrief,
      files,
      await validateEditedFiles(files, allowedPaths, editValidationOptions),
    );
    candidate = {
      files,
      validation,
      rawOutput: renderEditFilesForRepair(files),
      safetyFixes: deterministicRepair.fixes,
    };
    const unresolvedCount = resumedProposal.validation.errors.length
      + resumedProposal.validation.softErrors.length
      + resumedProposal.reviews.reduce((total, review) => total + review.mustFix.length, 0);
    yield {
      type: 'stage',
      stage: 'code',
      label: `Resumed a ${files.size}-file withheld proposal from shared task context`,
      detail: rotateCoder
        ? `${unresolvedCount} recorded issue(s) carried forward · handed to ${coder.displayName ?? coder.id} after ${resumedProposal.repairsUsed} unsuccessful repair(s)`
        : `${unresolvedCount} recorded issue(s) carried forward · another Council member can continue without rebuilding context`,
      memberId: coder.id,
      status: 'done',
    };
  } else {
    yield { type: 'stage', stage: 'code', label: `${coder.displayName ?? coder.id} is editing ${edit.projectName} (targeted change, not a rebuild)`, memberId: coder.id, status: 'running' };
    try {
      const reply = await coder.complete(buildEditMessages(taskBrief, edit), { maxTokens: CODER_MAX_TOKENS, temperature: 0.3 });
      usage = addUsage(usage, reply.usage);
      const extractedFiles = extractTitledFiles(reply.text);
      const deterministicRepair = applyDeterministicEditRepairs(taskBrief, extractedFiles, edit.files);
      const files = deterministicRepair.files;
      const validation = applyEditBriefInvariants(
        taskBrief,
        files,
        await validateEditedFiles(files, allowedPaths, editValidationOptions),
      );
      candidate = {
        files,
        validation,
        rawOutput: deterministicRepair.fixes.length > 0 ? renderEditFilesForRepair(files) : reply.text,
        safetyFixes: deterministicRepair.fixes,
      };
      if (deterministicRepair.fixes.length > 0) {
        yield {
          type: 'stage',
          stage: 'repair',
          label: `Vai applied ${deterministicRepair.fixes.length} deterministic runtime-safety repair(s)`,
          detail: deterministicRepair.fixes.join(' | '),
          status: 'done',
        };
      }
    } catch {
      yield { type: 'stage', stage: 'code', label: 'Edit call failed', memberId: coder.id, status: 'done' };
      yield { type: 'result', result: null };
      return;
    }
  }
  {
    const issueCount = candidate.validation.errors.length + candidate.validation.softErrors.length;
    yield {
      type: 'stage',
      stage: 'validate',
      label: issueCount === 0
        ? `Edit touches ${candidate.files.size} file(s) — static checks passed (${candidate.validation.checker})`
        : `Static checks found ${issueCount} issue(s)`,
      detail: [...candidate.validation.errors, ...candidate.validation.softErrors].slice(0, 3).join(' | ') || [...candidate.files.keys()].join(', '),
      status: 'done',
    };
  }

  const reviews: CodegenReviewNote[] = resumedProposal ? [...resumedProposal.reviews] : [];
  // Reviewers look at the main changed source file — App.tsx for generated
  // sandbox apps, otherwise the first changed code file of a real project.
  const changedSource = renderEditReviewSource(candidate.files);
  if (!resumedProposal && candidate.validation.ok && changedSource) {
    for (const reviewer of reviewers) {
      yield { type: 'stage', stage: 'review', label: `${reviewer.displayName ?? reviewer.id} is reviewing the edit`, memberId: reviewer.id, status: 'running' };
      try {
        const reply = await reviewer.complete(
          buildReviewerMessages(taskBrief, spec, changedSource),
          { maxTokens: REVIEWER_MAX_TOKENS, temperature: 0.2 },
        );
        usage = addUsage(usage, reply.usage);
        reviews.push(parseReview(reviewer.id, reply.text));
      } catch (error) {
        reviews.push({
          memberId: reviewer.id,
          verdict: 'ship',
          mustFix: [],
          notes: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
      actedMemberIds.push(reviewer.id);
      const note = reviews[reviews.length - 1];
      yield {
        type: 'stage',
        stage: 'review',
        label: note.error
          ? `${reviewer.displayName ?? reviewer.id} could not review (non-blocking)`
          : `${reviewer.displayName ?? reviewer.id}: ${note.verdict === 'ship' ? 'ship it' : `needs work (${note.mustFix.length} must-fix)`}`,
        detail: note.mustFix.slice(0, 2).join(' | ') || undefined,
        memberId: reviewer.id,
        status: 'done',
      };
    }
  }

  {
    const reconciliation = reconcileKnownRuntimeReviews(taskBrief, candidate, reviews);
    if (reconciliation.dismissed.length > 0) {
      reviews.splice(0, reviews.length, ...reconciliation.reviews);
      yield {
        type: 'stage',
        stage: 'validate',
        label: `Vai dismissed ${reconciliation.dismissed.length} stale reviewer claim(s) using deterministic runtime evidence`,
        detail: reconciliation.dismissed.slice(0, 2).join(' | '),
        status: 'done',
      };
    }
  }

  let repairsUsed = 0;
  while (repairsUsed < maxRepairs) {
    const reviewDriven = candidate.validation.ok && reviews.some((r) => r.mustFix.length > 0);
    const issues = [
      ...candidate.validation.errors,
      ...candidate.validation.softErrors,
      ...(candidate.validation.ok ? reviews.flatMap((r) => r.mustFix) : []),
    ].slice(0, 6);
    if (issues.length === 0) break;

    repairsUsed += 1;
    yield {
      type: 'stage',
      stage: 'repair',
      label: `Edit repair pass ${repairsUsed}/${maxRepairs} (${issues.length} issue(s))`,
      detail: issues.slice(0, 2).join(' | '),
      memberId: coder.id,
      status: 'running',
    };
    try {
      const reply = await coder.complete(
        buildEditRepairMessages(taskBrief, edit, candidate.rawOutput, issues),
        { maxTokens: CODER_MAX_TOKENS, temperature: 0.3 },
      );
      usage = addUsage(usage, reply.usage);
      const extractedFiles = extractTitledFiles(reply.text);
      const deterministicRepair = applyDeterministicEditRepairs(taskBrief, extractedFiles, edit.files);
      const files = deterministicRepair.files;
      const validation = applyEditBriefInvariants(
        taskBrief,
        files,
        await validateEditedFiles(files, allowedPaths, editValidationOptions),
      );
      const repaired: EditCandidate = {
        files,
        validation,
        rawOutput: deterministicRepair.fixes.length > 0 ? renderEditFilesForRepair(files) : reply.text,
        safetyFixes: deterministicRepair.fixes,
      };
      const best = betterEditCandidate(candidate, repaired);
      // A reviewer-driven repair often has identical static-check counts before
      // and after. In that case betterEditCandidate cannot measure the semantic
      // improvement, so accept a distinct, statically valid repair provisionally
      // and require the reviewers to verify it again below.
      const improved = reviewDriven
        ? repaired.validation.ok && repaired.files.size > 0 && editFilesDiffer(candidate.files, repaired.files)
        : best === repaired;
      candidate = improved ? repaired : best;
      yield {
        type: 'stage',
        stage: 'repair',
        label: improved
          ? (candidate.validation.ok ? 'Repair fixed the blocking issues' : `Repair improved the edit (${candidate.validation.errors.length} issue(s) left)`)
          : 'Repair did not improve the edit — keeping the previous version',
        status: 'done',
      };
      if (reviewDriven && improved) {
        // Never erase a known must-fix merely because the coder emitted different
        // compilable text. Re-review the repaired multi-file surface; only an
        // explicit clean verdict clears the blocker.
        reviews.length = 0;
        const repairedSource = renderEditReviewSource(candidate.files);
        if (repairedSource) {
          for (const reviewer of reviewers) {
            yield { type: 'stage', stage: 'review', label: `${reviewer.displayName ?? reviewer.id} is verifying the repaired edit`, memberId: reviewer.id, status: 'running' };
            try {
              const reply = await reviewer.complete(
                buildReviewerMessages(taskBrief, spec, repairedSource),
                { maxTokens: REVIEWER_MAX_TOKENS, temperature: 0.2 },
              );
              usage = addUsage(usage, reply.usage);
              reviews.push(parseReview(reviewer.id, reply.text));
            } catch (error) {
              reviews.push({
                memberId: reviewer.id,
                verdict: 'ship',
                mustFix: [],
                notes: [],
                error: error instanceof Error ? error.message : String(error),
              });
            }
            actedMemberIds.push(reviewer.id);
            const note = reviews[reviews.length - 1];
            yield {
              type: 'stage',
              stage: 'review',
              label: note.error
                ? `${reviewer.displayName ?? reviewer.id} could not re-review (non-blocking)`
                : `${reviewer.displayName ?? reviewer.id}: ${note.verdict === 'ship' ? 'repaired edit clears review' : `still needs work (${note.mustFix.length} must-fix)`}`,
              detail: note.mustFix.slice(0, 2).join(' | ') || undefined,
              memberId: reviewer.id,
              status: 'done',
            };
          }
        }
        const reconciliation = reconcileKnownRuntimeReviews(taskBrief, candidate, reviews);
        if (reconciliation.dismissed.length > 0) {
          reviews.splice(0, reviews.length, ...reconciliation.reviews);
          yield {
            type: 'stage',
            stage: 'validate',
            label: `Vai dismissed ${reconciliation.dismissed.length} stale re-review claim(s) using deterministic runtime evidence`,
            detail: reconciliation.dismissed.slice(0, 2).join(' | '),
            status: 'done',
          };
        }
      }
    } catch {
      yield { type: 'stage', stage: 'repair', label: 'Repair call failed — keeping the previous version', status: 'done' };
      break;
    }
  }

  // A resumed proposal may have been withheld before it ever reached review
  // (for example, because it also emitted a scaffold-owned file). Once repair
  // clears static validation, it still needs an independent Council challenge;
  // "fixed the compiler error" is not equivalent to "satisfies the request".
  if (resumedProposal
    && candidate.validation.ok
    && reviewers.length > 0
    && (reviews.length === 0 || reviews.every((review) => Boolean(review.error)))) {
    reviews.length = 0;
    const resumedSource = renderEditReviewSource(candidate.files);
    if (resumedSource) {
      for (const reviewer of reviewers) {
        yield {
          type: 'stage',
          stage: 'review',
          label: `${reviewer.displayName ?? reviewer.id} is reviewing the repaired shared proposal`,
          memberId: reviewer.id,
          status: 'running',
        };
        try {
          const reply = await reviewer.complete(
            buildReviewerMessages(taskBrief, spec, resumedSource),
            { maxTokens: REVIEWER_MAX_TOKENS, temperature: 0.2 },
          );
          usage = addUsage(usage, reply.usage);
          reviews.push(parseReview(reviewer.id, reply.text));
        } catch (error) {
          reviews.push({
            memberId: reviewer.id,
            verdict: 'ship',
            mustFix: [],
            notes: [],
            error: error instanceof Error ? error.message : String(error),
          });
        }
        actedMemberIds.push(reviewer.id);
        const note = reviews[reviews.length - 1];
        yield {
          type: 'stage',
          stage: 'review',
          label: note.error
            ? `${reviewer.displayName ?? reviewer.id} could not review (non-blocking)`
            : `${reviewer.displayName ?? reviewer.id}: ${note.verdict === 'ship' ? 'shared proposal clears review' : `still needs work (${note.mustFix.length} must-fix)`}`,
          detail: note.mustFix.slice(0, 2).join(' | ') || undefined,
          memberId: reviewer.id,
          status: 'done',
        };
      }
    }
  }

  const unresolvedMustFix = reviews.flatMap((review) => review.mustFix);
  if (!candidate.validation.ok || candidate.files.size === 0 || unresolvedMustFix.length > 0) {
    if (!candidate.validation.ok) {
      yield {
        type: 'stage',
        stage: 'validate',
        label: `Edit withheld — ${candidate.validation.errors.length} validation issue(s) remain`,
        detail: candidate.validation.errors.slice(0, 3).join(' | '),
        status: 'done',
      };
    }
    if (unresolvedMustFix.length > 0) {
      yield {
        type: 'stage',
        stage: 'validate',
        label: `Edit refused â€” ${unresolvedMustFix.length} reviewer must-fix issue(s) remain`,
        detail: unresolvedMustFix.slice(0, 3).join(' | '),
        status: 'done',
      };
    }
    const withheld: CouncilWithheldProposal = {
      schemaVersion: 1,
      projectName: edit.projectName,
      brief: taskBrief,
      files: [...candidate.files].map(([path, content]) => ({ path, content })),
      validation: candidate.validation,
      reviews,
      repairsUsed: (resumedProposal?.repairsUsed ?? 0) + repairsUsed,
      memberIds: [...new Set(actedMemberIds)],
    };
    yield { type: 'result', result: null, withheld };
    return;
  }

  yield { type: 'stage', stage: 'assemble', label: `Applying targeted edit to ${edit.projectName} (${[...candidate.files.keys()].join(', ')})`, status: 'done' };
  const result: CouncilCodegenResult = {
    output: renderEditOutput(edit.projectName, taskBrief, candidate.files, actedMemberIds),
    spec,
    validation: candidate.validation,
    reviews,
    repairsUsed: (resumedProposal?.repairsUsed ?? 0) + repairsUsed,
    usage,
    memberIds: actedMemberIds,
  };
  yield { type: 'result', result };
}
