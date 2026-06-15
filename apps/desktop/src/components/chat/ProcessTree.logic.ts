import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
import type { AdvisorTrace } from '@vai/api-types/chat-ws';
import { enrichProgressStepsWithCouncil } from './process-step-enrich.js';
import { stripAnsi } from '../../lib/strip-ansi.js';

/**
 * Tree model for ProcessTree. The backend streams a FLAT list of progress steps
 * plus structured payloads (`processLog`, `toolRuns`, `councilMembers`). This
 * module folds them into an expandable tree: step → sub-work → deeper detail.
 */

export type ProcessTone = 'default' | 'search' | 'council' | 'image' | 'verify' | 'build' | 'compose' | 'tool';

export interface ProcessNode {
  id: string;
  label: string;
  shortLabel?: string;
  detail?: string;
  note?: string;
  status: 'running' | 'done' | 'bad';
  tone?: ProcessTone;
  children: ProcessNode[];
}

export function isExpandable(node: ProcessNode): boolean {
  return node.children.length > 0 || Boolean(node.note && node.note.trim());
}

function toneForStage(stage: string): ProcessTone {
  if (stage.startsWith('tool-batch')) return 'tool';
  if (stage.startsWith('council')) return 'council';
  if (stage === 'vai-draft' || stage === 'vai-redraft') return 'compose';
  if (stage === 'search' || stage === 'escalate' || stage === 'research') return 'search';
  if (stage === 'quality-check' || stage === 'verify') return 'verify';
  if (stage.startsWith('build') || stage === 'apply' || stage === 'preview') return 'build';
  if (stage === 'image' || stage.startsWith('image')) return 'image';
  return 'default';
}

function toneForProcessLog(kind: string): ProcessTone {
  if (kind === 'artifact') return 'compose';
  if (kind === 'feedback' || kind === 'verdict') return 'council';
  if (kind === 'action') return 'tool';
  return 'default';
}

function shortLabelForStage(stage: string, label: string): string {
  if (stage.startsWith('tool-batch')) return 'Tools';
  if (stage === 'council-vai-round-1' || stage === 'council-fallback-round-1') return 'Council R1';
  if (stage === 'council-vai-round-2' || stage === 'council-fallback-round-2') return 'Council R2';
  if (stage === 'vai-redraft') return 'Vai revised';
  if (stage.startsWith('council')) return stage === 'council-vai' ? 'Council (Vai)' : 'Council';
  if (stage === 'vai-draft') return 'Vai proposed';
  if (stage === 'search' || stage === 'research') return 'Searched';
  if (stage === 'quality-check' || stage === 'verify') return 'Verified';
  if (stage.startsWith('build') || stage === 'apply') return 'Built';
  if (stage === 'escalate') return 'Escalated';
  return label.split(/\s+/).slice(0, 2).join(' ');
}

/** One-line label for the composer activity queue (not the full in-message tree). */
export function compactStepLabel(step: ChatProgressStep): string {
  return shortLabelForStage(step.stage, step.label);
}

/** Current sub-work under the active step — shown in the composer headline only. */
export function deriveActiveSubActivity(step: ChatProgressStep | undefined): string | undefined {
  if (!step) return undefined;
  if (step.status === 'running' && step.stage.startsWith('council')) {
    if (step.councilMembers?.length) {
      const pending = step.councilMembers.find((m) => m.pending);
      if (pending) return `${pending.name} reviewing`;
      const member = step.councilMembers[step.councilMembers.length - 1];
      if (member?.failed) return `${member.name} did not respond`;
      if (member) return `${member.name} · ${member.suggestedAction || member.verdict}`;
    }
    return 'Council members deliberating';
  }
  const runningTool = step.toolRuns?.find((t) => t.status === 'running');
  if (runningTool) return runningTool.name;
  if (step.status === 'running' && step.toolRuns?.length) {
    return step.toolRuns[step.toolRuns.length - 1]?.name;
  }
  if (step.councilMembers?.length) {
    const member = step.councilMembers[step.councilMembers.length - 1];
    if (member) return member.name;
  }
  const lastLog = step.processLog?.[step.processLog.length - 1];
  if (lastLog) return lastLog.label;
  if (step.detail && step.detail.length <= 48 && !/[.!?]\s/.test(step.detail)) return step.detail;
  return undefined;
}

function verdictTone(verdict: string, failed?: boolean): ProcessNode['status'] {
  if (failed) return 'bad';
  if (verdict === 'bad') return 'bad';
  return 'done';
}

function formatMemberProcessBody(
  member: NonNullable<ChatProgressStep['councilMembers']>[number],
): string {
  if (member.failed) return stripAnsi(member.note?.trim() || 'Member did not respond.');
  const lines: string[] = [];
  if (member.realIntent?.trim()) lines.push(`Real intent: ${stripAnsi(member.realIntent.trim())}`);
  if (member.hiddenMeaning?.trim()) lines.push(`Hidden meaning: ${stripAnsi(member.hiddenMeaning.trim())}`);
  if (member.missingCapability?.trim()) lines.push(`Missing capability: ${stripAnsi(member.missingCapability.trim())}`);
  if (member.suggestedAction?.trim()) lines.push(`Suggested action: ${stripAnsi(member.suggestedAction.trim())}`);
  if (member.methodLesson?.trim()) lines.push(`Method lesson: ${stripAnsi(member.methodLesson.trim())}`);
  if (member.concerns?.length) lines.push(`Concerns:\n- ${member.concerns.map(stripAnsi).join('\n- ')}`);
  return stripAnsi(lines.join('\n\n') || member.note?.trim() || '—');
}

function panelLabelForLogKind(kind: string): string {
  switch (kind) {
    case 'action': return 'In';
    case 'artifact': return 'Out';
    case 'feedback': return 'Response';
    case 'verdict': return 'Result';
    default: return 'Details';
  }
}

function mapProcessLog(
  entries: NonNullable<ChatProgressStep['processLog']>,
  prefix: string,
): ProcessNode[] {
  return entries.map((entry, index) => {
    const body = entry.body?.trim();
    const children: ProcessNode[] = body
      ? [{
          id: `${prefix}-log-${index}-body`,
          label: panelLabelForLogKind(entry.kind),
          note: body,
          status: 'done' as const,
          tone: toneForProcessLog(entry.kind),
          children: [],
        }]
      : [];
    return {
      id: `${prefix}-log-${index}-${entry.kind}`,
      label: entry.label,
      status: 'done' as const,
      tone: toneForProcessLog(entry.kind),
      children,
    };
  });
}

function mapAdvisorTrace(advisor: AdvisorTrace, prefix: string): ProcessNode[] {
  const nodes: ProcessNode[] = [];
  if (advisor.taskShape?.trim()) {
    nodes.push({
      id: `${prefix}-task`,
      label: 'Task shape',
      note: advisor.taskShape.trim(),
      status: 'done',
      tone: 'default',
      children: [],
    });
  }
  if (advisor.routeGuidance.length > 0) {
    nodes.push({
      id: `${prefix}-routes`,
      label: `Route hints (${advisor.routeGuidance.length})`,
      note: advisor.routeGuidance
        .map((route) => `${route.signal.toUpperCase()} · ${route.handler}\n${route.reason}`)
        .join('\n\n'),
      status: 'done',
      tone: 'route' as ProcessTone,
      children: [],
    });
  }
  if (advisor.riskFlags.length > 0) {
    nodes.push({
      id: `${prefix}-risks`,
      label: `Risk flags (${advisor.riskFlags.length})`,
      note: advisor.riskFlags.map((flag) => `- ${flag}`).join('\n'),
      status: 'done',
      tone: 'verify',
      children: [],
    });
  }
  if (advisor.retrievalHints.length > 0) {
    nodes.push({
      id: `${prefix}-retrieval`,
      label: `Retrieval hints (${advisor.retrievalHints.length})`,
      note: advisor.retrievalHints.join('\n'),
      status: 'done',
      tone: 'search',
      children: [],
    });
  }
  if (advisor.qualityContract) {
    const qc = advisor.qualityContract;
    nodes.push({
      id: `${prefix}-quality`,
      label: 'Quality contract',
      note: [
        `Answer length: ${qc.answerLength}`,
        qc.mustBeGuiding ? 'Must be guiding' : null,
        qc.mustBeCurrent ? 'Must be current' : null,
        qc.mustUseJson ? 'Must use JSON' : null,
        qc.shouldAskClarifyingQuestion ? 'Should ask clarifying question' : null,
      ].filter(Boolean).join('\n'),
      status: 'done',
      tone: 'default',
      children: [],
    });
  }
  if (advisor.error?.trim()) {
    nodes.push({
      id: `${prefix}-error`,
      label: 'Error',
      note: stripAnsi(advisor.error.trim()),
      status: 'bad',
      tone: 'verify',
      children: [],
    });
  }
  if (advisor.confidence !== undefined) {
    nodes.push({
      id: `${prefix}-confidence`,
      label: 'Advisor confidence',
      note: `${Math.round(advisor.confidence * 100)}%${advisor.durationMs !== undefined ? ` · ${advisor.durationMs}ms` : ''}`,
      status: 'done',
      tone: 'default',
      children: [],
    });
  }
  return nodes;
}

function mapCouncilMembers(
  members: NonNullable<ChatProgressStep['councilMembers']>,
  prefix: string,
): ProcessNode[] {
  return members.map((member) => {
    if (member.pending) {
      return {
        id: `${prefix}-council-pending-${member.name}`,
        label: member.name,
        status: 'running' as const,
        tone: 'council',
        children: [],
      };
    }
    const body = formatMemberProcessBody(member);
    return {
      id: `${prefix}-council-${member.name}`,
      label: member.name,
      detail: member.failed
        ? 'no response'
        : `${member.verdict} @ ${Math.round(member.confidence * 100)}%`,
      note: body,
      status: verdictTone(member.verdict, member.failed),
      tone: 'council',
      children: [],
    };
  });
}

function mapToolRuns(
  runs: NonNullable<ChatProgressStep['toolRuns']>,
  prefix: string,
): ProcessNode[] {
  return runs.map((run, index) => {
    const children: ProcessNode[] = [];
    if (run.input?.trim()) {
      children.push({
        id: `${prefix}-tool-${run.id}-in`,
        label: 'Input',
        note: run.input.trim(),
        status: 'done',
        tone: 'tool',
        children: [],
      });
    }
    if (run.output?.trim()) {
      children.push({
        id: `${prefix}-tool-${run.id}-out`,
        label: 'Output',
        note: run.output.trim(),
        status: run.success === false ? 'bad' : 'done',
        tone: 'tool',
        children: [],
      });
    }
    return {
      id: `${prefix}-tool-${run.id || index}`,
      label: run.name,
      detail: run.status === 'running'
        ? 'running…'
        : run.durationMs !== undefined
          ? `${run.success === false ? 'failed' : 'ok'} · ${run.durationMs}ms`
          : run.status,
      status: run.status === 'running' ? 'running' : run.success === false ? 'bad' : 'done',
      tone: 'tool',
      children,
    };
  });
}

function isCouncilReviewStage(stage: string): boolean {
  return stage.startsWith('council');
}

function shouldAttachLegacyCouncil(
  step: ChatProgressStep,
  steps: readonly ChatProgressStep[],
): boolean {
  if (step.councilMembers?.length) return false;
  if (step.stage.startsWith('council-vai-round')) return true;
  if (step.stage.startsWith('council-fallback-round')) return true;
  if (step.stage === 'council-vai') return true;
  if (step.stage === 'council' && !steps.some((item) => item.stage.startsWith('council-vai'))) return true;
  return false;
}

export function buildProcessTree(
  steps: readonly ChatProgressStep[],
  council?: CouncilThinkingUI,
  imageSteps?: readonly { phase: string; label: string; flaws?: string[] }[],
  vaiProposedDraft?: string,
  compactLive = false,
): ProcessNode[] {
  const enrichedSteps = enrichProgressStepsWithCouncil(steps, council);
  const nodes: ProcessNode[] = [];
  const hasVaiDraftStep = enrichedSteps.some((step) => step.stage === 'vai-draft');

  for (const step of enrichedSteps) {
    const tone = toneForStage(step.stage);
    const prefix = `step-${step.stage}`;
    const detail = step.detail?.trim();
    const isShortDetail = !!detail && detail.length <= 48 && !/[.!?]\s/.test(detail);
    const node: ProcessNode = {
      id: prefix,
      label: step.label,
      shortLabel: shortLabelForStage(step.stage, step.label),
      detail: isShortDetail ? detail : undefined,
      note: !isShortDetail && !step.processLog?.length && !step.toolRuns?.length ? detail : undefined,
      status: step.status === 'running' ? 'running' : 'done',
      tone,
      children: [],
    };

    // Inline summary while live; full text available under expandable children.
    if (compactLive && detail && !isShortDetail && !step.processLog?.length && !step.toolRuns?.length) {
      node.detail = detail.length > 80 ? `${detail.slice(0, 77)}…` : detail;
      node.note = undefined;
    }

    const children: ProcessNode[] = [];
    if (detail && !isShortDetail && (step.processLog?.length || step.toolRuns?.length || step.advisor || step.councilMembers?.length)) {
      children.push({
        id: `${prefix}-context`,
        label: 'Step context',
        note: detail,
        status: 'done',
        tone,
        children: [],
      });
    } else if (detail && !isShortDetail) {
      node.note = detail;
      if (compactLive) {
        node.detail = detail.length > 80 ? `${detail.slice(0, 77)}…` : detail;
        node.note = detail;
      }
    }
    if (step.advisor) children.push(...mapAdvisorTrace(step.advisor, `${prefix}-advisor`));
    if (step.processLog?.length) children.push(...mapProcessLog(step.processLog, prefix));
    if (step.toolRuns?.length) children.push(...mapToolRuns(step.toolRuns, prefix));
    if (step.councilMembers?.length) {
      children.push(...mapCouncilMembers(step.councilMembers, prefix));
    } else if (isCouncilReviewStage(step.stage) && council && council.members.length > 0) {
      if (shouldAttachLegacyCouncil(step, enrichedSteps) && step.stage !== 'council-fallback') {
        children.push(...council.members.map((member, memberIndex) => ({
          id: `${prefix}-legacy-council-${memberIndex}-${member.name}`,
          label: member.name,
          detail: member.failed
            ? 'no response'
            : `${member.verdict} @ ${Math.round(member.confidence * 100)}%`,
          note: member.failed ? undefined : (member.note?.trim() || undefined),
          status: verdictTone(member.verdict, member.failed),
          tone: 'council' as const,
          children: [],
        })));
      }
    } else if (isCouncilReviewStage(step.stage) && step.status === 'running' && !step.councilMembers?.length) {
      children.push({
        id: `${prefix}-council-wait`,
        label: 'Council members deliberating',
        status: 'running',
        tone: 'council',
        children: [],
      });
    }
    node.children = children;

    nodes.push(node);
  }

  if (vaiProposedDraft?.trim() && !hasVaiDraftStep) {
    nodes.unshift({
      id: 'vai-draft-thinking',
      label: 'Vai proposed an answer',
      shortLabel: 'Vai proposed',
      note: vaiProposedDraft.trim(),
      status: 'done',
      tone: 'compose',
      children: [],
    });
  }

  if (imageSteps && imageSteps.length > 0 && !nodes.some((n) => n.tone === 'image')) {
    nodes.push({
      id: 'image-root',
      label: 'Generating image',
      shortLabel: 'Image',
      status: imageSteps.some((s) => s.phase === 'final') ? 'done' : 'running',
      tone: 'image',
      children: imageSteps.map((s, si) => ({
        id: `image-${si}`,
        label: s.label,
        detail: s.flaws && s.flaws.length > 0 ? `fixing: ${s.flaws.join(', ')}` : undefined,
        status: s.phase === 'final' ? 'done' : s.phase === 'declined' ? 'bad' : 'running',
        tone: 'image',
        children: [],
      })),
    });
  }

  return nodes;
}
