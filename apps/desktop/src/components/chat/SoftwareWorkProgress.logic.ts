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
  readonly outcome?: ChatProgressStep['outcome'];
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

function hasAdverseOutcome(outcome: ChatProgressStep['outcome']): boolean {
  return outcome === 'failed'
    || outcome === 'interrupted'
    || outcome === 'withheld'
    || outcome === 'not-run';
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
  if (!clean || !/\b(?:build-action|debugging)\b/i.test(clean) || !/\b(?:risks?|confidence)\b/i.test(clean)) return clean;
  const confidence = clean.match(/confidence\s+(\d+)%/i)?.[1];
  const task = /\bdebugging\b/i.test(clean) ? 'a debugging and repair task' : 'a software-change task';
  const risks: string[] = [];
  if (/format-contract-risk/i.test(clean)) risks.push('the strict file-output contract');
  if (/workspace|project|path/i.test(clean)) risks.push('editing the correct project and files');
  const riskText = risks.length > 0 ? `, with ${risks.join(' and ')} as the main risk` : '';
  return `The advisor classified this as ${task}${riskText}${confidence ? `, and reported ${confidence}% confidence` : ''}.`;
}

function isWithheldOutcome(steps: readonly ChatProgressStep[]): boolean {
  let terminal: boolean | undefined;
  for (const step of steps) {
    if (step.outcome === 'withheld') terminal = true;
    if (step.outcome === 'succeeded' && step.stage === 'turn-terminal') terminal = false;
    const text = `${step.label} ${step.detail ?? ''}`;
    if (/\b(?:edit withheld|withheld|blocked|refused)\b/i.test(text)) terminal = true;
    if (/\b(?:applying targeted edit|applied (?:the )?(?:edit|change)|files? updated|project update complete)\b/i.test(text)) terminal = false;
  }
  return terminal ?? false;
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
    const runOutcome = run.outcome ?? (run.status === 'done' ? 'succeeded' : run.status);
    notes.push({
      kind: 'tool',
      label: `${run.name} — ${runOutcome === 'succeeded' ? 'completed' : runOutcome}`,
      body: [input ? `Input: ${input}` : '', output ? `Output: ${output}` : ''].filter(Boolean).join(' · ') || undefined,
      status: hasAdverseOutcome(run.outcome) ? 'failed' : run.status,
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
  return displayLabelForStep(step) ?? PHASES.find((phase) => phase.id === id)?.idleDetail ?? '';
}

export function buildSoftwareWorkView(input: {
  readonly steps: readonly ChatProgressStep[];
  readonly live: boolean;
  readonly durationMs?: number;
  readonly outputFileCount?: number;
}): SoftwareWorkView {
  const { steps, live } = input;
  const terminalOutcome = [...steps]
    .reverse()
    .find((step) => step.stage === 'turn-terminal')
    ?.outcome;
  const workSteps = steps.filter((step) => step.stage !== 'turn-terminal');
  const buckets = new Map<SoftwarePhaseId, ChatProgressStep[]>();
  for (const step of workSteps) {
    const id = phaseForSoftwareStage(step.stage);
    const bucket = buckets.get(id) ?? [];
    bucket.push(step);
    buckets.set(id, bucket);
  }

  const activeStep = live
    ? [...workSteps].reverse().find((step) => step.status === 'running') ?? workSteps.at(-1)
    : undefined;
  const activeId = activeStep ? phaseForSoftwareStage(activeStep.stage) : undefined;
  const issueCount = issueCountFrom(steps);
  const remainingIssueCount = remainingIssueCountFrom(steps);
  const repair = repairStateFrom(steps);
  const withheld = isWithheldOutcome(steps);

  const phases = PHASES.map((phase): SoftwarePhaseView => {
    const phaseSteps = buckets.get(phase.id) ?? [];
    const latest = phaseSteps.at(-1);
    const hasAttention = phaseSteps.some((step) =>
      hasAdverseOutcome(step.outcome)
      || /issue|failed|refused|withheld|sent back|invalid|blocked/i.test(`${step.label} ${step.detail ?? ''}`),
    );
    const status: SoftwarePhaseStatus = phase.id === activeId
      ? 'running'
      : hasAttention && (live || withheld || hasAdverseOutcome(terminalOutcome))
        ? 'attention'
        : phaseSteps.length > 0 && phaseSteps.every((step) => step.status === 'done')
          ? 'done'
          : 'pending';
    return {
      id: phase.id,
      label: phase.label,
      purpose: phase.purpose,
      status,
      detail: conciseDetail(phase.id, latest, issueCount, remainingIssueCount, repair.pass, repair.limit),
    };
  });

  const journal = buildJournal(workSteps);
  const completedCount = phases.filter((phase) => phase.status === 'done').length;
  const outputFileCount = input.outputFileCount ?? 0;
  const observableActionCount = journal.reduce((total, item) => total + 1 + item.notes.length, 0);
  const repairSummary = repair.pass > 0 ? ` · ${repair.pass} repair pass${repair.pass === 1 ? '' : 'es'}` : '';
  const durationSummary = input.durationMs && input.durationMs >= 500 ? ` · ${formatWorkDuration(input.durationMs)}` : '';
  const fileSummary = outputFileCount > 0 ? `${outputFileCount} file${outputFileCount === 1 ? '' : 's'} ready` : 'review complete';
  const actionSummary = observableActionCount > 0 ? ` · ${observableActionCount} recorded action${observableActionCount === 1 ? '' : 's'}` : '';
  const activePhase = activeId ? PHASES.find((phase) => phase.id === activeId) : undefined;
  const outcomeSummary = terminalOutcome === 'failed'
    ? 'Failed · work did not complete'
    : terminalOutcome === 'interrupted'
      ? 'Interrupted · work stopped before completion'
      : terminalOutcome === 'not-run'
        ? 'Not run · no work was executed'
        : withheld
    ? `Withheld${remainingIssueCount > 0
      ? ` · ${remainingIssueCount} of ${Math.max(issueCount, remainingIssueCount)} validation issues remain`
      : issueCount > 0 ? ` · ${issueCount} validation issue${issueCount === 1 ? '' : 's'} found` : ''}`
          : `Implementation · ${fileSummary}`;

  return {
    phases,
    journal,
    activeTitle: activeId
      ? conciseDetail(activeId, activeStep, issueCount, remainingIssueCount, repair.pass, repair.limit)
      : live ? 'Preparing the implementation' : 'Implementation reviewed',
    activeDetail: friendlyAdvisorDetail(activeStep?.detail) ?? normalize(activeStep?.label, 500) ?? (live ? 'Waiting for the next observable action' : fileSummary),
    activePurpose: activePhase?.purpose ?? 'Preparing the next verified step.',
    completedCount,
    issueCount,
    remainingIssueCount,
    repairPass: repair.pass,
    repairLimit: repair.limit,
    outputFileCount,
    observableActionCount,
    withheld,
    outcome: terminalOutcome,
    summary: `${outcomeSummary}${actionSummary}${repairSummary}${durationSummary}`,
  };
}

export function formatWorkDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
