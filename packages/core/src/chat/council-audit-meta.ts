import type { AuditMeta, AuditOutcomeKind } from '../models/adapter.js';
import type { CouncilThinking } from '../consensus/types.js';

export interface CouncilAuditDraftSnapshot {
  readonly draftText: string;
  readonly modelId: string;
}

export interface BuildCouncilAuditMetaArgs {
  readonly outcomeKind: AuditOutcomeKind;
  readonly draft: CouncilAuditDraftSnapshot;
  readonly council?: CouncilThinking;
  readonly convened?: boolean;
  readonly revised: boolean;
  readonly resetFired?: boolean;
  readonly visibleTextChanged?: boolean;
  readonly draftStrategy?: string;
  readonly priorTextExcerpt?: string;
}

export function normalizeAuditVisibleText(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function auditVisibleTextChanged(beforeText: string | undefined, afterText: string | undefined): boolean {
  return normalizeAuditVisibleText(beforeText) !== normalizeAuditVisibleText(afterText);
}

export function boundedAuditExcerpt(text: string | undefined, maxLength = 600): string | undefined {
  const normalized = normalizeAuditVisibleText(text);
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function firstCouncilMethodLesson(council: CouncilThinking | undefined): string | undefined {
  return council?.methodLessons?.find((lesson) => lesson.trim().length > 0)?.trim();
}

export function buildCouncilAuditMeta(args: BuildCouncilAuditMetaArgs): AuditMeta {
  const visibleTextChanged = args.visibleTextChanged ?? args.revised;
  const realIntent = args.council?.realIntent?.trim() || undefined;
  const methodLesson = firstCouncilMethodLesson(args.council);
  const priorTextExcerpt = visibleTextChanged ? args.priorTextExcerpt : undefined;

  return {
    outcomeKind: args.outcomeKind,
    convened: args.convened ?? Boolean(args.council),
    revised: args.revised,
    resetFired: args.resetFired ?? false,
    draftStrategy: args.draftStrategy ?? args.draft.modelId,
    visibleTextChanged,
    ...(realIntent ? { realIntent } : {}),
    ...(methodLesson ? { methodLesson } : {}),
    ...(args.council?.outcome ? { councilOutcome: args.council.outcome } : {}),
    ...(priorTextExcerpt ? { priorTextExcerpt } : {}),
  };
}

export function withCouncilAuditVisibility(
  meta: AuditMeta,
  args: {
    readonly beforeText: string;
    readonly afterText: string;
    readonly resetFired: boolean;
    readonly outcomeKind?: AuditOutcomeKind;
    readonly revised?: boolean;
  },
): AuditMeta {
  const visibleTextChanged = auditVisibleTextChanged(args.beforeText, args.afterText);
  const priorTextExcerpt = visibleTextChanged ? boundedAuditExcerpt(args.beforeText) : undefined;
  return {
    outcomeKind: args.outcomeKind ?? meta.outcomeKind,
    convened: meta.convened,
    revised: args.revised ?? meta.revised,
    resetFired: args.resetFired,
    ...(meta.draftStrategy ? { draftStrategy: meta.draftStrategy } : {}),
    visibleTextChanged,
    ...(meta.realIntent ? { realIntent: meta.realIntent } : {}),
    ...(meta.methodLesson ? { methodLesson: meta.methodLesson } : {}),
    ...(meta.councilOutcome ? { councilOutcome: meta.councilOutcome } : {}),
    ...(priorTextExcerpt ? { priorTextExcerpt } : {}),
  };
}
