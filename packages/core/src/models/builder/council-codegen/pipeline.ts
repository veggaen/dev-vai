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
      const improved = repairedApp !== null && (
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
      if (reviewDriven) reviews.length = 0;
    } catch {
      yield { type: 'stage', stage: 'repair', label: 'Repair call failed — keeping the previous version', status: 'done' };
      break;
    }
  }

  if (!appValidation.ok || !appTsx) {
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

function renderEditOutput(projectName: string, brief: string, files: ReadonlyMap<string, string>, memberIds: readonly string[]): string {
  const blocks: string[] = [];
  for (const [path, body] of files) {
    blocks.push(`\`\`\`${fenceLanguage(path)} title="${path}"\n${body}\n\`\`\``);
  }
  const changed = [...files.keys()].join(', ');
  return [
    `Updated **${projectName}** (${changed}) — ${brief.trim()}. Reviewed by Vai's council (${memberIds.join(', ')}).`,
    '',
    ...blocks,
  ].join('\n');
}

interface EditCandidate {
  readonly files: ReadonlyMap<string, string>;
  readonly validation: AppValidationReport;
  readonly rawOutput: string;
}

function betterEditCandidate(a: EditCandidate | null, b: EditCandidate): EditCandidate {
  if (!a) return b;
  if (a.validation.ok !== b.validation.ok) return a.validation.ok ? a : b;
  if (a.validation.errors.length !== b.validation.errors.length) {
    return b.validation.errors.length < a.validation.errors.length ? b : a;
  }
  return b.validation.softErrors.length < a.validation.softErrors.length ? b : a;
}

/**
 * Edit-mode pipeline: patch the active project's files in place. Same
 * coder → validate → review → bounded-repair shape as a fresh build, but the
 * coder sees the CURRENT files, may only re-emit project source files, and
 * the result is the changed files verbatim — no scaffold, no new app name.
 */
async function* councilEditApp(input: CouncilCodegenInput, edit: CouncilEditContext): AsyncGenerator<CouncilCodegenEvent> {
  const coder = input.members[0];
  const reviewers = input.members.slice(1, 1 + (input.maxReviewers ?? DEFAULT_MAX_REVIEWERS));
  const maxRepairs = input.maxRepairs ?? DEFAULT_MAX_REPAIRS;
  const allowedPaths = edit.files.map((f) => f.path);
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
  const actedMemberIds: string[] = [coder.id];

  const spec: CouncilAppSpec = {
    title: edit.projectName,
    packageName: edit.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'active-project',
    summary: input.brief.trim().slice(0, 200),
    features: [input.brief.trim().slice(0, 300)],
    fromArchitect: false,
  };

  yield { type: 'stage', stage: 'code', label: `${coder.displayName ?? coder.id} is editing ${edit.projectName} (targeted change, not a rebuild)`, memberId: coder.id, status: 'running' };
  let candidate: EditCandidate;
  try {
    const reply = await coder.complete(buildEditMessages(input.brief, edit), { maxTokens: CODER_MAX_TOKENS, temperature: 0.3 });
    usage = addUsage(usage, reply.usage);
    const files = extractTitledFiles(reply.text);
    candidate = { files, validation: await validateEditedFiles(files, allowedPaths), rawOutput: reply.text };
  } catch {
    yield { type: 'stage', stage: 'code', label: 'Edit call failed', memberId: coder.id, status: 'done' };
    yield { type: 'result', result: null };
    return;
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

  const reviews: CodegenReviewNote[] = [];
  const changedApp = candidate.files.get('src/App.tsx');
  if (candidate.validation.ok && changedApp) {
    for (const reviewer of reviewers) {
      yield { type: 'stage', stage: 'review', label: `${reviewer.displayName ?? reviewer.id} is reviewing the edit`, memberId: reviewer.id, status: 'running' };
      try {
        const reply = await reviewer.complete(
          buildReviewerMessages(input.brief, spec, changedApp),
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
        buildEditRepairMessages(input.brief, edit, candidate.rawOutput, issues),
        { maxTokens: CODER_MAX_TOKENS, temperature: 0.3 },
      );
      usage = addUsage(usage, reply.usage);
      const files = extractTitledFiles(reply.text);
      const repaired: EditCandidate = { files, validation: await validateEditedFiles(files, allowedPaths), rawOutput: reply.text };
      const best = betterEditCandidate(candidate, repaired);
      const improved = best === repaired;
      candidate = best;
      yield {
        type: 'stage',
        stage: 'repair',
        label: improved
          ? (candidate.validation.ok ? 'Repair fixed the blocking issues' : `Repair improved the edit (${candidate.validation.errors.length} issue(s) left)`)
          : 'Repair did not improve the edit — keeping the previous version',
        status: 'done',
      };
      if (reviewDriven) reviews.length = 0;
    } catch {
      yield { type: 'stage', stage: 'repair', label: 'Repair call failed — keeping the previous version', status: 'done' };
      break;
    }
  }

  if (!candidate.validation.ok || candidate.files.size === 0) {
    yield { type: 'result', result: null };
    return;
  }

  yield { type: 'stage', stage: 'assemble', label: `Applying targeted edit to ${edit.projectName} (${[...candidate.files.keys()].join(', ')})`, status: 'done' };
  const result: CouncilCodegenResult = {
    output: renderEditOutput(edit.projectName, input.brief, candidate.files, actedMemberIds),
    spec,
    validation: candidate.validation,
    reviews,
    repairsUsed,
    usage,
    memberIds: actedMemberIds,
  };
  yield { type: 'result', result };
}
