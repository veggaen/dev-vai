/**
 * Structured process-log entries streamed on progress steps so ProcessTree can
 * render a full history of Vai ↔ council work (thoughts, actions, artifacts).
 */

import { buildCouncilReviewPacket, type CouncilReviewPacketDraft } from '../consensus/review-packet.js';
import type { CouncilConsensus, CouncilMemberNote } from '../consensus/types.js';

export type ProcessLogKind = 'thought' | 'read' | 'action' | 'event' | 'show' | 'artifact' | 'tool' | 'tool-response' | 'feedback' | 'verdict';

export interface ProcessLogEntry {
  readonly kind: ProcessLogKind;
  readonly label: string;
  readonly body?: string;
}

export interface CouncilFeedbackSnapshot {
  readonly realIntent: string;
  readonly methodLessons: readonly string[];
  readonly missingCapabilities: readonly string[];
  readonly concerns: readonly string[];
  readonly recommendedAction: string;
}

export interface CouncilProgressMember {
  readonly memberId?: string;
  readonly name: string;
  readonly topic?: string;
  readonly verdict: 'good' | 'needs-work' | 'bad';
  readonly confidence: number;
  readonly durationMs?: number;
  readonly note?: string;
  readonly pending?: boolean;
  readonly failed?: boolean;
  readonly realIntent?: string;
  readonly hiddenMeaning?: string;
  readonly missingCapability?: string;
  readonly methodLesson?: string;
  readonly suggestedAction?: string;
  readonly concerns?: readonly string[];
}

function trimProcessBody(text: string, max = 8_000): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function formatMemberProcessBody(member: CouncilProgressMember): string {
  if (member.failed) return member.note?.trim() || 'Member did not respond.';
  const lines: string[] = [];
  if (member.realIntent?.trim()) lines.push(`Real intent: ${member.realIntent.trim()}`);
  if (member.hiddenMeaning?.trim()) lines.push(`Hidden meaning: ${member.hiddenMeaning.trim()}`);
  if (member.missingCapability?.trim()) lines.push(`Missing capability: ${member.missingCapability.trim()}`);
  if (member.suggestedAction?.trim()) lines.push(`Suggested action: ${member.suggestedAction.trim()}`);
  if (member.methodLesson?.trim()) lines.push(`Method lesson: ${member.methodLesson.trim()}`);
  if (member.concerns?.length) lines.push(`Concerns:\n- ${member.concerns.join('\n- ')}`);
  return lines.join('\n\n') || member.note?.trim() || '—';
}

export function councilMembersFromNotes(notes: readonly CouncilMemberNote[]): CouncilProgressMember[] {
  return notes.map((note) => ({
    memberId: note.memberId,
    name: note.memberName,
    topic: note.topic,
    verdict: note.verdict,
    confidence: note.confidence,
    durationMs: note.durationMs,
    failed: Boolean(note.error),
    note: note.error
      ? `did not respond (${note.error})`
      : note.realIntent || note.missingCapability || note.methodLesson || '—',
    realIntent: note.realIntent || undefined,
    hiddenMeaning: note.hiddenMeaning || undefined,
    missingCapability: note.missingCapability || undefined,
    methodLesson: note.methodLesson || undefined,
    suggestedAction: note.suggestedAction || undefined,
    concerns: note.concerns.length ? note.concerns : undefined,
  }));
}

export function pendingCouncilProgressMember(name: string): CouncilProgressMember {
  return {
    name,
    verdict: 'needs-work',
    confidence: 0,
    pending: true,
  };
}

export function buildCouncilFeedbackBody(feedback: CouncilFeedbackSnapshot): string {
  const lines: string[] = [];
  if (feedback.realIntent) lines.push(`What the user actually wants: ${feedback.realIntent}`);
  if (feedback.recommendedAction) lines.push(`Recommended action: ${feedback.recommendedAction}`);
  if (feedback.missingCapabilities.length) {
    lines.push(`Missing capabilities:\n- ${feedback.missingCapabilities.join('\n- ')}`);
  }
  if (feedback.methodLessons.length) {
    lines.push(`Method lessons:\n- ${feedback.methodLessons.join('\n- ')}`);
  }
  if (feedback.concerns.length) {
    lines.push(`Concerns:\n- ${feedback.concerns.join('\n- ')}`);
  }
  return lines.join('\n\n');
}

export function buildMemberDeliberationLog(note: CouncilMemberNote): ProcessLogEntry {
  const member = councilMembersFromNotes([note])[0];
  const body = member ? formatMemberProcessBody(member) : note.error || '—';
  return {
    kind: note.error ? 'feedback' : 'verdict',
    label: note.error ? `${note.memberName} did not respond` : `${note.memberName} view`,
    body,
  };
}

export function buildVaiDraftProcessLog(draftText: string): ProcessLogEntry[] {
  if (!draftText.trim()) return [];
  return [{
    kind: 'artifact',
    label: 'Vai draft (before council)',
    body: trimProcessBody(draftText),
  }];
}

export function buildCouncilRoundProcessLog(
  draft: CouncilReviewPacketDraft,
  consensus: CouncilConsensus,
): ProcessLogEntry[] {
  const packet = buildCouncilReviewPacket(draft);
  const log: ProcessLogEntry[] = [];

  if (packet.contextSummary) {
    log.push({
      kind: 'thought',
      label: 'What Vai considered important',
      body: packet.contextSummary,
    });
  }
  if (packet.relevantHistory?.length) {
    log.push({
      kind: 'artifact',
      label: 'Relevant chat context sent to council',
      body: trimProcessBody(
        packet.relevantHistory.map((message) => `${message.role}: ${message.content}`).join('\n\n'),
        4_000,
      ),
    });
  }
  if (packet.retrievedSnippets?.length) {
    log.push({
      kind: 'artifact',
      label: 'Retrieval Vai used',
      body: trimProcessBody(
        packet.retrievedSnippets.map((snippet) => {
          const title = snippet.title ? `[${snippet.title}] ` : '';
          const url = snippet.url ? `(${snippet.url}) ` : '';
          return `${title}${url}${snippet.snippet ?? ''}`.trim();
        }).join('\n\n'),
        4_000,
      ),
    });
  }

  log.push({
    kind: 'artifact',
    label: 'Draft under review',
    body: trimProcessBody(draft.draftText),
  });

  const consensusLines: string[] = [consensus.summary];
  if (consensus.realIntent) consensusLines.push(`Real intent: ${consensus.realIntent}`);
  if (consensus.missingCapabilities.length) {
    consensusLines.push(`Missing capabilities:\n- ${consensus.missingCapabilities.join('\n- ')}`);
  }
  if (consensus.methodLessons.length) {
    consensusLines.push(`Method lessons:\n- ${consensus.methodLessons.join('\n- ')}`);
  }
  consensusLines.push(`Outcome: ${consensus.outcome} · agreement ${Math.round(consensus.agreement * 100)}%`);
  log.push({
    kind: 'verdict',
    label: 'Council consensus',
    body: consensusLines.join('\n\n'),
  });

  return log;
}

export function buildVaiRedraftProcessLog(
  feedback: CouncilFeedbackSnapshot,
  originalDraft: string,
  revisedDraft: string,
): ProcessLogEntry[] {
  const log: ProcessLogEntry[] = [{
    kind: 'action',
    label: 'Vai acted on council feedback',
    body: 'Regenerated the answer using council intent + method guidance (facts still supplied by Vai only).',
  }];

  const feedbackBody = buildCouncilFeedbackBody(feedback);
  if (feedbackBody) {
    log.push({ kind: 'feedback', label: 'Council feedback to Vai', body: feedbackBody });
  }
  if (originalDraft.trim()) {
    log.push({ kind: 'artifact', label: 'Original draft', body: trimProcessBody(originalDraft) });
  }
  if (revisedDraft.trim()) {
    log.push({ kind: 'artifact', label: 'Revised draft', body: trimProcessBody(revisedDraft) });
  }
  return log;
}
