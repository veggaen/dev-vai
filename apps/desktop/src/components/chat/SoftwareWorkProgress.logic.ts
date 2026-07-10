import type { ChatProgressStep } from '../../stores/chatStore.js';

export type SoftwarePhaseId = 'understand' | 'investigate' | 'plan' | 'build' | 'review' | 'validate';
export type SoftwarePhaseStatus = 'pending' | 'running' | 'done' | 'attention';
export type WorkJournalKind = 'intent' | 'evidence' | 'decision' | 'build' | 'review' | 'check' | 'repair' | 'tool' | 'artifact';

export interface SoftwarePhaseView {
  readonly id: SoftwarePhaseId;
  readonly label: string;
  readonly purpose: string;
  readonly status: SoftwarePhaseStatus;
  readonly detail: string;
}

export interface WorkJournalNote {
  readonly kind: WorkJournalKind;
  readonly label: string;
  readonly body?: string;
  readonly status?: 'running' | 'done' | 'failed';
  readonly durationMs?: number;
}

export interface WorkJournalItem {
  readonly id: string;
  readonly phaseId: SoftwarePhaseId;
  readonly phaseLabel: string;
  readonly kind: WorkJournalKind;
  readonly label: string;
  readonly detail?: string;
  readonly status: 'running' | 'done';
  readonly durationMs?: number;
  readonly notes: readonly WorkJournalNote[];
}

export interface SoftwareWorkView {
  readonly phases: readonly SoftwarePhaseView[];
  readonly journal: readonly WorkJournalItem[];
  readonly activeTitle: string;
  readonly activeDetail: string;
  readonly activePurpose: string;
  readonly completedCount: number;
  readonly issueCount: number;
  readonly remainingIssueCount: number;
  readonly repairPass: number;
  readonly repairLimit: number;
  readonly outputFileCount: number;
  readonly observableActionCount: number;
  readonly withheld: boolean;
  readonly summary: string;
}

const PHASES: ReadonlyArray<{ id: SoftwarePhaseId; label: string; purpose: string; idleDetail: string }> = [
  {
    id: 'understand',
    label: 'Understand',
    purpose: 'Turn the request into an explicit scope, constraints, and success conditions.',
    idleDetail: 'Confirming scope and constraints',
  },
  {
    id: 'investigate',
    label: 'Investigate',
    purpose: 'Inspect the project and gather the evidence needed before changing it.',
    idleDetail: 'Inspecting the relevant project context',
  },
  {
    id: 'plan',
    label: 'Plan',
    purpose: 'Choose the smallest coherent approach and identify what will be changed.',
    idleDetail: 'Planning the implementation',
  },
  {
    id: 'build',
    label: 'Build',
    purpose: 'Create or edit the requested project files while preserving the agreed scope.',
    idleDetail: 'Writing the requested changes',
  },
  {
    id: 'review',
    label: 'Review',
    purpose: 'Challenge the implementation for mistakes, regressions, and weak decisions.',
    idleDetail: 'Auditing the implementation',
  },
  {
    id: 'validate',
    label: 'Validate',
    purpose: 'Run deterministic checks and report only the proof that actually exists.',
    idleDetail: 'Running project checks',
  },
];

export function phaseForSoftwareStage(stage: string): SoftwarePhaseId {
  const value = stage.toLowerCase();
  if (/validate|verify|typecheck|lint|test|preview|quality-check|gate|compile/.test(value)) return 'validate';
  if (/review|audit|critique|verdict/.test(value)) return 'review';
  if (/repair|redraft|council-code|\bcode\b|build|write|edit|apply|assemble|style|artifact/.test(value)) return 'build';
  if (/architect|spec|\bplan\b|approach|design/.test(value)) return 'plan';
  if (/workspace|context|\bread\b|files?|search|research|evidence|inspect|fetch|source/.test(value)) return 'investigate';
  return 'understand';
}

function normalize(value: string | undefined, limit = 900): string | undefined {
  const clean = value?.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length <= limit ? clean : `${clean.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function issueCountFrom(steps: readonly ChatProgressStep[]): number {
  let count = 0;
  for (const step of steps) {
    const text = `${step.label} ${step.detail ?? ''}`;
    const match = text.match(/(\d+)\s+issue(?:\(s\)|s)?/i);
    if (match) count = Math.max(count, Number(match[1]));
  }
  return count;
}

function remainingIssueCountFrom(steps: readonly ChatProgressStep[]): number {
  let remaining = 0;
  for (const step of steps) {
    const text = `${step.label} ${step.detail ?? ''}`;
    const match = text.match(/(\d+)\s+(?:validation\s+)?issue(?:\(s\)|s)?\s+(?:left|remain(?:s|ing)?)/i);
    if (match) remaining = Number(match[1]);
  }
  return remaining;
}

function friendlyAdvisorDetail(value: string | undefined): string | undefined {
  const clean = normalize(value);
  if (!clean || !/\bbuild-action\b/i.test(clean)) return clean;
  const confidence = clean.match(/confidence\s+(\d+)%/i)?.[1];
  return `The advisor classified this as a software-change task, flagged the strict file-output contract as the main risk${confidence ? `, and reported ${confidence}% confidence` : ''}.`;
}

function displayLabelForStep(step: ChatProgressStep): string {
  const label = normalize(step.label, 300) ?? 'Working on the implementation';
  if (/^Asking local model friend$/i.test(label)) return 'Starting a background route and risk check';
  if (/^Local model friend returned advice$/i.test(label)) return 'Background route and risk check completed';
  if (/^Working through it — checking what I know$/i.test(label)) return 'Classifying the request and choosing the safe work path';
  const assigned = label.match(/^Handing this to (.+?) — my generative arm$/i);
  if (assigned) return `Assigned the first implementation draft to ${assigned[1]}`;
  const drafting = label.match(/^(.+?) is writing the answer$/i);
  if (drafting) return `${drafting[1]} is drafting the requested project changes`;
  return label;
}

function repairStateFrom(steps: readonly ChatProgressStep[]): { pass: number; limit: number } {
  let pass = 0;
  let limit = 0;
  for (const step of steps) {
    const text = `${step.label} ${step.detail ?? ''}`;
    const match = text.match(/repair\s+pass\s+(\d+)\s*\/\s*(\d+)/i);
    if (match) {
      pass = Math.max(pass, Number(match[1]));
      limit = Math.max(limit, Number(match[2]));
    }
  }
  return { pass, limit };
}

function kindForStep(step: ChatProgressStep, phaseId: SoftwarePhaseId): WorkJournalKind {
  const value = `${step.stage} ${step.label}`.toLowerCase();
  if (/repair|fix|redraft/.test(value)) return 'repair';
  if (phaseId === 'investigate') return 'evidence';
  if (phaseId === 'plan') return 'decision';
  if (phaseId === 'build') return /assembl|artifact/.test(value) ? 'artifact' : 'build';
  if (phaseId === 'review') return 'review';
  if (phaseId === 'validate') return 'check';
  return 'intent';
}

function kindForProcessLog(kind: NonNullable<ChatProgressStep['processLog']>[number]['kind']): WorkJournalKind {
  if (kind === 'read') return 'evidence';
  if (kind === 'artifact' || kind === 'show') return 'artifact';
  if (kind === 'tool' || kind === 'tool-response') return 'tool';
  if (kind === 'feedback' || kind === 'verdict') return 'review';
  if (kind === 'action' || kind === 'event') return 'build';
  return 'decision';
}

function notesForStep(step: ChatProgressStep): WorkJournalNote[] {
  const notes: WorkJournalNote[] = [];
  for (const entry of step.processLog ?? []) {
    const repeatedTaskBody = /advisor input/i.test(entry.label)
      ? 'The same task contract was passed to a lightweight background advisor. It may flag route or format risks, but it cannot edit files or approve the result.'
      : /turn focus/i.test(entry.label)
        ? 'The original task contract remains the active scope.'
        : undefined;
    const advisorPacket = /advisor steering packet/i.test(entry.label);
    notes.push({
      kind: kindForProcessLog(entry.kind),
      label: /advisor input/i.test(entry.label)
        ? 'Scope sent to the background advisor'
        : advisorPacket
          ? 'Background advisor finding'
          : normalize(entry.label, 240) ?? 'Recorded observation',
      body: repeatedTaskBody ?? (advisorPacket ? friendlyAdvisorDetail(entry.body) : normalize(entry.body)),
    });
  }
  for (const run of step.toolRuns ?? []) {
    const input = normalize(run.input, 500);
    const output = normalize(run.output, 700);
    notes.push({
      kind: 'tool',
      label: `${run.name} — ${run.status === 'done' ? 'completed' : run.status}`,
      body: [input ? `Input: ${input}` : '', output ? `Output: ${output}` : ''].filter(Boolean).join(' · ') || undefined,
      status: run.status,
      durationMs: run.durationMs,
    });
  }
  for (const member of step.councilMembers ?? []) {
    const concerns = member.concerns?.map((concern) => normalize(concern, 240)).filter(Boolean).join(' · ');
    notes.push({
      kind: 'review',
      label: `${member.name}: ${member.verdict === 'good' ? 'cleared this step' : member.verdict === 'bad' ? 'blocked this step' : 'requested improvement'}`,
      body: normalize([member.note, concerns].filter(Boolean).join(' · ')),
      status: member.failed ? 'failed' : member.pending ? 'running' : 'done',
      durationMs: member.durationMs,
    });
  }
  return notes;
}

function buildJournal(steps: readonly ChatProgressStep[]): WorkJournalItem[] {
  return steps.map((step, index) => {
    const phaseId = phaseForSoftwareStage(step.stage);
    return {
      id: `${step.stage}-${index}`,
      phaseId,
      phaseLabel: PHASES.find((phase) => phase.id === phaseId)?.label ?? 'Work',
      kind: kindForStep(step, phaseId),
      label: displayLabelForStep(step),
      detail: friendlyAdvisorDetail(step.detail),
      status: step.status,
      durationMs: step.durationMs,
      notes: notesForStep(step),
    };
  });
}

function conciseDetail(
  id: SoftwarePhaseId,
  step: ChatProgressStep | undefined,
  issueCount: number,
  remainingIssueCount: number,
  repairPass: number,
  repairLimit: number,
): string {
  if (!step) return PHASES.find((phase) => phase.id === id)?.idleDetail ?? '';
  if (id === 'build' && /repair/i.test(step.stage + step.label)) {
    const visibleIssueCount = remainingIssueCount || issueCount;
    const issueText = visibleIssueCount > 0
      ? `${visibleIssueCount}${remainingIssueCount > 0 ? ' remaining' : ''} validation issue${visibleIssueCount === 1 ? '' : 's'}`
      : 'validation feedback';
    const passText = repairPass > 0 ? ` · pass ${repairPass}${repairLimit > 0 ? ` of ${repairLimit}` : ''}` : '';
    return `Fixing ${issueText}${passText}`;
  }
  return normalize(step.label, 180) ?? PHASES.find((phase) => phase.id === id)?.idleDetail ?? '';
}

export function buildSoftwareWorkView(input: {
  readonly steps: readonly ChatProgressStep[];
  readonly live: boolean;
  readonly durationMs?: number;
  readonly outputFileCount?: number;
}): SoftwareWorkView {
  const { steps, live } = input;
  const buckets = new Map<SoftwarePhaseId, ChatProgressStep[]>();
  for (const step of steps) {
    const id = phaseForSoftwareStage(step.stage);
    const bucket = buckets.get(id) ?? [];
    bucket.push(step);
    buckets.set(id, bucket);
  }

  const activeStep = live
    ? [...steps].reverse().find((step) => step.status === 'running') ?? steps.at(-1)
    : undefined;
  const activeId = activeStep ? phaseForSoftwareStage(activeStep.stage) : undefined;
  const issueCount = issueCountFrom(steps);
  const remainingIssueCount = remainingIssueCountFrom(steps);
  const repair = repairStateFrom(steps);
  const withheld = steps.some((step) => /\b(?:withheld|blocked|refused)\b/i.test(`${st