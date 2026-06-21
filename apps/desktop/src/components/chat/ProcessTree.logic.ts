import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
import type { AdvisorTrace } from '@vai/api-types/chat-ws';
import { enrichProgressStepsWithCouncil } from './process-step-enrich.js';
import { stripAnsi } from '../../lib/strip-ansi.js';
import {
  humanizeMemberWaiting,
  humanizeMemberReturned,
  humanizeMemberBody,
  humanizeAdvisorState,
  cleanModelName,
} from './process-humanize.js';

/**
 * Tree model for ProcessTree. The backend streams a FLAT list of progress steps
 * plus structured payloads (`processLog`, `toolRuns`, `councilMembers`). This
 * module folds them into an expandable tree: step → sub-work → deeper detail.
 */

export type ProcessTone = 'default' | 'search' | 'council' | 'image' | 'verify' | 'build' | 'compose' | 'tool';

export interface ProcessNode {
  id: string;
  label: string;
  kind?: string;
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

/**
 * Auto-expand policy for a process step/child while the turn is LIVE.
 *
 * The user complaint this encodes: previously only council rows auto-expanded, so every
 * other active step (search, build, verify, the proposed-answer) stayed collapsed and had
 * to be clicked to watch. Now ANY running, expandable step streams open so the latest
 * detail is visible without drilling in — and collapses itself once done, keeping the
 * settled trace quiet. A user toggle always wins over this. Pure so it can be unit-tested
 * without a DOM (desktop tests run in node).
 */
export function shouldAutoExpand(params: {
  live: boolean;
  expandable: boolean;
  status: ProcessNode['status'];
  expandAll?: boolean;
  userToggled?: boolean;
}): boolean | null {
  const { live, expandable, status, expandAll = false, userToggled = false } = params;
  if (expandAll && expandable) return true;
  if (userToggled) return null; // user decided — don't override
  if (live && status === 'running' && expandable) return true; // stream the active step open
  if (status === 'done') return false; // a finished step folds away
  return null; // no change
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
  if (kind === 'read') return 'search';
  if (kind === 'show') return 'compose';
  if (kind === 'artifact') return 'compose';
  if (kind === 'feedback' || kind === 'verdict') return 'council';
  if (kind === 'action' || kind === 'tool' || kind === 'tool-response') return 'tool';
  if (kind === 'event') return 'verify';
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
  if (member.failed) return stripAnsi(member.note?.trim() || `${cleanModelName(member.name)} didn't respond in time.`);
  const body = humanizeMemberBody({
    name: member.name,
    realIntent: member.realIntent?.trim() ? stripAnsi(member.realIntent.trim()) : undefined,
    hiddenMeaning: member.hiddenMeaning?.trim() ? stripAnsi(member.hiddenMeaning.trim()) : undefined,
    missingCapability: member.missingCapability?.trim() ? stripAnsi(member.missingCapability.trim()) : undefined,
    suggestedAction: member.suggestedAction?.trim() ? stripAnsi(member.suggestedAction.trim()) : undefined,
    methodLesson: member.methodLesson?.trim() ? stripAnsi(member.methodLesson.trim()) : undefined,
    concerns: member.concerns?.length ? member.concerns.map(stripAnsi) : undefined,
  });
  return stripAnsi(body || member.note?.trim() || '—');
}

export function panelLabelForLogKind(kind: string): string {
  switch (kind) {
    case 'thought': return 'Thought';
    case 'read': return 'Read';
    case 'action': return 'Action';
    case 'event': return 'Event';
    case 'show': return 'Show';
    case 'artifact': return 'Artifact';
    case 'tool': return 'Tool call';
    case 'tool-response': return 'Tool response';
    case 'feedback': return 'Feedback';
    case 'verdict': return 'Verdict';
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
          kind: entry.kind,
          note: body,
          status: 'done' as const,
          tone: toneForProcessLog(entry.kind),
          children: [],
        }]
      : [];
    return {
      id: `${prefix}-log-${index}-${entry.kind}`,
      label: entry.label,
      kind: entry.kind,
      detail: panelLabelForLogKind(entry.kind).toLowerCase(),
      status: 'done' as const,
      tone: toneForProcessLog(entry.kind),
      children,
    };
  });
}

function mapAdvisorTrace(advisor: AdvisorTrace, prefix: string): ProcessNode[] {
  const nodes: ProcessNode[] = [];
  nodes.push({
    id: `${prefix}-model`,
    label: cleanModelName(advisor.modelId),
    kind: 'submodel',
    detail: `${advisor.state}${advisor.durationMs !== undefined ? ` · ${formatCompactMs(advisor.durationMs)}` : ''}`,
    note: humanizeAdvisorState(advisor.modelId, advisor.state, {
      durationMs: advisor.durationMs,
      confidencePct: advisor.confidence !== undefined ? Math.round(advisor.confidence * 100) : undefined,
    }),
    status: advisor.state === 'invalid' || advisor.state === 'unavailable'
      ? 'bad'
      : advisor.state === 'running' || advisor.state === 'background'
        ? 'running'
        : 'done',
    tone: advisor.state === 'invalid' || advisor.state === 'unavailable' ? 'verify' : 'council',
    children: [],
  });
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
    const memberKey = member.memberId || member.name;
    if (member.pending) {
      return {
        id: `${prefix}-council-pending-${memberKey}`,
        label: cleanModelName(member.name),
        kind: 'submodel',
        detail: 'thinking…',
        status: 'running' as const,
        tone: 'council',
        children: [{
          id: `${prefix}-council-pending-${memberKey}-event`,
          label: 'Status',
          kind: 'event',
          note: humanizeMemberWaiting(member.name, member.topic),
          status: 'running' as const,
          tone: 'council',
          children: [],
        }],
      };
    }
    const body = formatMemberProcessBody(member);
    const children = buildCouncilMemberTimeline(member);
    return {
      id: `${prefix}-council-${memberKey}`,
      label: cleanModelName(member.name),
      kind: 'submodel',
      detail: member.failed
        ? 'no response'
        : `${member.verdict} · ${Math.round(member.confidence * 100)}%${member.durationMs !== undefined ? ` · ${formatCompactMs(member.durationMs)}` : ''}`,
      note: body,
      status: verdictTone(member.verdict, member.failed),
      tone: 'council',
      children,
    };
  });
}

function buildCouncilMemberTimeline(
  member: NonNullable<ChatProgressStep['councilMembers']>[number],
): ProcessNode[] {
  const memberKey = member.memberId || member.name;
  const confidencePct = Math.round(member.confidence * 100);
  const nodes: ProcessNode[] = [{
    id: `${memberKey}-submodel-call`,
    label: 'What happened',
    kind: 'event',
    note: humanizeMemberReturned(member.name, member.topic, member.verdict, confidencePct, member.failed)
      + (member.durationMs !== undefined ? ` (took ${formatCompactMs(member.durationMs)})` : ''),
    status: member.failed ? 'bad' : 'done',
    tone: 'council',
    children: [],
  }, {
    id: `${memberKey}-verdict`,
    label: 'Verdict',
    kind: 'verdict',
    note: humanizeMemberReturned(member.name, member.topic, member.verdict, confidencePct, member.failed),
    status: verdictTone(member.verdict, member.failed),
    tone: 'council',
    children: [],
  }];

  if (member.realIntent?.trim()) nodes.push(memberTimelineNode(memberKey, 'Intent read', 'read', member.realIntent, 'default'));
  if (member.hiddenMeaning?.trim()) nodes.push(memberTimelineNode(memberKey, 'Hidden meaning', 'thought', member.hiddenMeaning, 'default'));
  if (member.missingCapability?.trim()) nodes.push(memberTimelineNode(memberKey, 'Missing capability', 'event', member.missingCapability, 'verify'));
  if (member.methodLesson?.trim()) nodes.push(memberTimelineNode(memberKey, 'Method lesson', 'feedback', member.methodLesson, 'council'));
  if (member.concerns?.length) nodes.push(memberTimelineNode(memberKey, 'Concerns', 'feedback', member.concerns.map((item) => `- ${item}`).join('\n'), 'verify'));
  if (member.note?.trim()) nodes.push(memberTimelineNode(memberKey, 'Raw note', 'artifact', stripAnsi(member.note.trim()), member.failed ? 'verify' : 'compose', member.failed ? 'bad' : 'done'));

  nodes.push({
    id: `${memberKey}-fact-quarantine`,
    label: 'Fact quarantine',
    kind: 'event',
    note: 'Council members supply intent, method, and routing guidance only. Vai still owns every user-facing fact and verification step.',
    status: 'done',
    tone: 'verify',
    children: [],
  });

  return nodes;
}

function memberTimelineNode(
  memberKey: string,
  label: string,
  kind: string,
  note: string,
  tone: ProcessTone,
  status: ProcessNode['status'] = 'done',
): ProcessNode {
  return {
    id: `${memberKey}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label,
    kind,
    note: stripAnsi(note.trim()),
    status,
    tone,
    children: [],
  };
}

function mapToolRuns(
  runs: NonNullable<ChatProgressStep['toolRuns']>,
  prefix: string,
): ProcessNode[] {
  return runs.map((run, index) => {
    const children: ProcessNode[] = [];
    const operation = classifyToolRun(run.name);
    if (run.input?.trim()) {
      children.push({
        id: `${prefix}-tool-${run.id}-request`,
        label: 'Tool request',
        kind: 'tool-request',
        note: [`Tool: ${run.name}`, `Kind: ${operation}`, '', run.input.trim()].join('\n'),
        status: 'done',
        tone: 'tool',
        children: [],
      });
    }
    children.push({
      id: `${prefix}-tool-${run.id}-event`,
      label: 'Tool event',
      kind: 'tool-event',
      note: formatToolEvent(run, operation),
      status: run.status === 'failed' || run.success === false ? 'bad' : run.status === 'running' ? 'running' : 'done',
      tone: 'tool',
      children: [],
    });
    if (run.output?.trim()) {
      children.push({
        id: `${prefix}-tool-${run.id}-response`,
        label: 'Tool response',
        kind: 'tool-response',
        note: run.output.trim(),
        status: run.success === false ? 'bad' : 'done',
        tone: 'tool',
        children: [],
      });
    }
    return {
      id: `${prefix}-tool-${run.id || index}`,
      label: run.name,
      kind: 'tool',
      detail: run.status === 'running'
        ? `${operation} · running…`
        : run.durationMs !== undefined
          ? `${operation} · ${run.success === false ? 'failed' : 'ok'} · ${run.durationMs}ms`
          : `${operation} · ${run.status}`,
      status: run.status === 'running' ? 'running' : run.success === false ? 'bad' : 'done',
      tone: 'tool',
      children,
    };
  });
}

function classifyToolRun(name: string): string {
  const normalized = name.toLowerCase();
  if (['read', 'fetch', 'get', 'list', 'view', 'cat', 'open'].some((token) => normalized.includes(token))) return 'read';
  if (['search', 'grep', 'rg', 'find', 'query', 'semantic'].some((token) => normalized.includes(token))) return 'search';
  if (['apply', 'patch', 'edit', 'write', 'create', 'delete', 'rename', 'move'].some((token) => normalized.includes(token))) return 'write';
  if (['run', 'terminal', 'shell', 'exec', 'command'].some((token) => normalized.includes(token))) return 'command';
  if (['show', 'render', 'preview', 'image', 'screenshot'].some((token) => normalized.includes(token))) return 'show';
  return 'tool';
}

function formatToolEvent(
  run: NonNullable<ChatProgressStep['toolRuns']>[number],
  operation: string,
): string {
  return [
    `Tool: ${run.name}`,
    `Kind: ${operation}`,
    `Status: ${run.status}`,
    run.success !== undefined ? `Success: ${run.success ? 'yes' : 'no'}` : undefined,
    run.durationMs !== undefined ? `Duration: ${run.durationMs}ms` : undefined,
  ].filter(Boolean).join('\n');
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
  includeActivityMap = false,
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

  if (includeActivityMap) {
    const map = buildActivityMap(enrichedSteps);
    if (map) nodes.unshift(map);
  }

  return nodes;
}

function buildActivityMap(steps: readonly ChatProgressStep[]): ProcessNode | null {
  if (steps.length === 0) return null;
  const processKinds = new Map<string, number>();
  const submodels = new Set<string>();
  const toolLines: string[] = [];
  let toolRuns = 0;
  let toolResponses = 0;
  let councilRounds = 0;
  let councilMembers = 0;

  for (const step of steps) {
    if (step.stage.startsWith('council')) councilRounds += 1;
    if (step.advisor) submodels.add(step.advisor.actorId || step.advisor.modelId);
    for (const entry of step.processLog ?? []) {
      processKinds.set(entry.kind, (processKinds.get(entry.kind) ?? 0) + 1);
    }
    for (const member of step.councilMembers ?? []) {
      councilMembers += 1;
      submodels.add(member.name);
    }
    for (const tool of step.toolRuns ?? []) {
      toolRuns += 1;
      if (tool.output?.trim()) toolResponses += 1;
      toolLines.push(`${tool.name}: ${tool.status}${tool.success === false ? ' (failed)' : ''}${tool.durationMs !== undefined ? ` · ${tool.durationMs}ms` : ''}`);
    }
  }

  const kindLines = [...processKinds.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${panelLabelForLogKind(kind)}: ${count}`);
  const summaryBits = [
    `${steps.length} stages`,
    processKinds.size ? `${[...processKinds.values()].reduce((sum, count) => sum + count, 0)} events` : undefined,
    toolRuns ? `${toolRuns} tools` : undefined,
    councilMembers ? `${councilMembers} member notes` : undefined,
  ].filter(Boolean);

  const children: ProcessNode[] = [{
    id: 'activity-map-inventory',
    label: 'Timeline inventory',
    kind: 'event',
    note: [
      `Stages: ${steps.length}`,
      `Council rounds: ${councilRounds}`,
      `Council/submodel notes: ${councilMembers}`,
      `Tool calls: ${toolRuns}`,
      `Tool responses: ${toolResponses}`,
    ].join('\n'),
    status: 'done',
    tone: 'default',
    children: [],
  }];

  if (submodels.size) {
    children.push({
      id: 'activity-map-submodels',
      label: `Submodels (${submodels.size})`,
      kind: 'submodel',
      note: [...submodels].sort().join('\n'),
      status: 'done',
      tone: 'council',
      children: [],
    });
  }
  if (kindLines.length) {
    children.push({
      id: 'activity-map-process-events',
      label: 'Process event kinds',
      kind: 'event',
      note: kindLines.join('\n'),
      status: 'done',
      tone: 'verify',
      children: [],
    });
  }
  if (toolLines.length) {
    children.push({
      id: 'activity-map-tools',
      label: 'Tool usage',
      kind: 'tool',
      note: toolLines.join('\n'),
      status: toolLines.some((line) => line.includes('(failed)')) ? 'bad' : 'done',
      tone: 'tool',
      children: [],
    });
  }

  return {
    id: 'turn-activity-map',
    label: 'Turn activity map',
    kind: 'activity-map',
    shortLabel: 'Activity',
    detail: summaryBits.join(' · '),
    status: 'done',
    tone: 'default',
    children,
  };
}

function formatCompactMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}
