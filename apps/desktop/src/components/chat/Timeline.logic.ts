import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';
import { enrichProgressStepsWithCouncil } from './process-step-enrich.js';
import { buildProcessTree, type ProcessNode } from './ProcessTree.logic.js';

/**
 * Loop-aware timeline model.
 *
 * The backend streams a FLAT list of progress steps. The user's mental model (and the Excalidraw
 * sketch) is a LOOP with phases and approval gates:
 *
 *   Message IN → Understand → [ Council ⇄ Engineering ⇄ Factory ] → Vai + Council
 *      → gate(approved?) ──no──→ another round (redraft)
 *                         └─yes─→ Response + breakdown → Message out
 *
 * This module folds the flat stages into that shape WITHOUT any schema/backend change: phases group
 * related stages, loop rounds are detected from council/redraft stage suffixes, and gates are
 * derived from the verdict-bearing stages (council consensus, quality-check, redraft). Every node
 * keeps a pointer back to its underlying ProcessTree nodes so the existing detail UI still works.
 *
 * Engineering hardening over the raw sketch (validated, not just transcribed):
 *  - A loop that never approves must still terminate: we surface the round count and the LAST gate
 *    verdict so a stuck/limited turn reads as "shipped best-so-far after N rounds", never a hang.
 *  - Each phase reports its own elapsed/derived cost so the timeline answers "where did time go".
 *  - Feature-notes (missing capability / method lessons) are lifted to a dedicated lane because that
 *    is the data that improves Vai — the sketch's "ADD NOTE about feature Vai needs".
 */

export type TimelinePhaseId =
  | 'intake'
  | 'understand'
  | 'gather'
  | 'deliberate'
  | 'compose'
  | 'gate'
  | 'redraft'
  | 'build'
  | 'deliver';

export interface TimelineGate {
  /** Which gate fired (council consensus, quality verification, redraft decision). */
  readonly kind: 'council' | 'quality' | 'redraft';
  readonly approved: boolean;
  /** One-line, human-readable reason for the decision. */
  readonly reason: string;
  /** 0..1 confidence behind the decision, when known. */
  readonly confidence?: number;
}

export interface TimelinePhase {
  readonly id: string;
  readonly phase: TimelinePhaseId;
  readonly title: string;
  /** One-line "what this phase bought us" — the useful summary, not raw logs. */
  readonly summary: string;
  readonly status: 'running' | 'done' | 'bad';
  /** Which loop round this phase belongs to (1-based). */
  readonly round: number;
  /** Approval gate decision attached to this phase, if it is a gate. */
  readonly gate?: TimelineGate;
  /** Underlying ProcessTree nodes so the existing expandable detail still renders. */
  readonly nodes: ProcessNode[];
  readonly durationMs?: number;
}

export interface FeatureNote {
  readonly id: string;
  readonly source: string;
  readonly kind: 'missing-capability' | 'method-lesson' | 'concern';
  readonly text: string;
}

export interface TimelineModel {
  readonly phases: TimelinePhase[];
  /** How many deliberation/redraft rounds the turn ran. */
  readonly rounds: number;
  /** Whether the turn was approved on the final gate (vs shipped best-so-far). */
  readonly approved: boolean;
  /** Feature-notes lifted from council reviews — the self-improvement lane. */
  readonly featureNotes: FeatureNote[];
  readonly totalDurationMs: number;
}

/** Map a raw stage string to one of the diagram's phases. */
export function phaseForStage(stage: string): TimelinePhaseId {
  if (stage === 'understand' || stage === 'structured:classify' || stage.startsWith('structure')) return 'understand';
  if (stage === 'search' || stage === 'research' || stage === 'reason' || stage === 'escalate') return 'gather';
  if (stage.startsWith('council') || stage === 'friend-review') return 'deliberate';
  if (stage === 'vai-draft' || stage === 'answer' || stage === 'compose') return 'compose';
  if (stage === 'vai-redraft') return 'redraft';
  if (stage === 'quality-check' || stage === 'verify') return 'gate';
  if (stage.startsWith('build') || stage === 'apply' || stage === 'preview') return 'build';
  return 'intake';
}

// Display names intentionally diverge from the internal `Council*` types and `council-*` stages:
// the product surface reads as plain "Reasoning" by owner decision — the deliberation is Vai's own
// review pass, not a separate committee. Rename display strings here, never the types/APIs.
const PHASE_TITLE: Record<TimelinePhaseId, string> = {
  intake: 'Message in',
  understand: 'Read the intent',
  gather: 'Gather evidence',
  deliberate: 'Deliberating',
  compose: 'Drafting',
  gate: 'Approval gate',
  redraft: 'Revising',
  build: 'Build',
  deliver: 'Deliver',
};

/** Detect the loop round from a stage suffix like `council-vai-round-2`. */
function roundForStage(stage: string): number {
  const m = /round-(\d+)/.exec(stage);
  if (m) return Number(m[1]);
  if (stage === 'vai-redraft') return 2;
  return 1;
}

function gateForStep(step: ChatProgressStep): TimelineGate | undefined {
  const members = step.councilMembers ?? [];
  if (step.stage.startsWith('council') && members.length > 0) {
    const usable = members.filter((m) => !m.failed && !m.pending);
    if (usable.length === 0) return undefined;
    const good = usable.filter((m) => m.verdict === 'good').length;
    const avgConfidence = usable.reduce((sum, m) => sum + (m.confidence ?? 0), 0) / usable.length;
    const approved = good >= Math.ceil(usable.length / 2);
    return {
      kind: 'council',
      approved,
      confidence: avgConfidence,
      reason: approved
        ? `${good}/${usable.length} reviewers approved · ${Math.round(avgConfidence * 100)}%`
        : `${good}/${usable.length} approved — sent back for another pass`,
    };
  }
  if (step.stage === 'quality-check' || step.stage === 'verify') {
    const bad = step.status !== 'running' && /fail|reject|decline|insufficient/i.test(step.detail ?? '');
    return {
      kind: 'quality',
      approved: !bad,
      reason: bad ? (step.detail?.slice(0, 120) ?? 'Verification flagged the draft') : 'Verification passed',
    };
  }
  return undefined;
}

function summarizeNodes(nodes: ProcessNode[], fallback: string): string {
  const withDetail = nodes.find((n) => n.detail?.trim());
  if (withDetail?.detail) return withDetail.detail.trim();
  const withNote = nodes.find((n) => n.note?.trim());
  if (withNote?.note) {
    const firstLine = withNote.note.trim().split('\n')[0];
    return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
  }
  return fallback;
}

function collectFeatureNotes(steps: readonly ChatProgressStep[]): FeatureNote[] {
  const notes: FeatureNote[] = [];
  const seen = new Set<string>();
  const push = (source: string, kind: FeatureNote['kind'], text: string) => {
    const t = text.trim();
    if (!t) return;
    const key = `${kind}:${t.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    notes.push({ id: `fn-${notes.length}`, source, kind, text: t });
  };
  for (const step of steps) {
    for (const m of step.councilMembers ?? []) {
      if (m.failed || m.pending) continue;
      if (m.missingCapability?.trim()) push(m.name, 'missing-capability', m.missingCapability);
      if (m.methodLesson?.trim()) push(m.name, 'method-lesson', m.methodLesson);
      for (const c of m.concerns ?? []) push(m.name, 'concern', c);
    }
  }
  return notes;
}

export function buildTimelineModel(
  steps: readonly ChatProgressStep[],
  council?: CouncilThinkingUI,
): TimelineModel {
  const enriched = enrichProgressStepsWithCouncil(steps, council);
  // Reuse the existing tree builder so each phase keeps full expandable detail. buildProcessTree
  // (called without vaiProposedDraft/activityMap) returns one node per step in order, so we match
  // by the stable per-step id rather than positional index (robust to any appended image node).
  const treeNodes = buildProcessTree(enriched, council);
  const nodeById = new Map(treeNodes.map((n) => [n.id, n] as const));

  const phases: TimelinePhase[] = [];
  let maxRound = 1;
  let lastGate: TimelineGate | undefined;
  let totalDurationMs = 0;

  enriched.forEach((step, index) => {
    const phaseId = phaseForStage(step.stage);
    const round = roundForStage(step.stage);
    maxRound = Math.max(maxRound, round);
    const node = nodeById.get(`step-${step.stage}`) ?? treeNodes[index];
    const nodes = node ? [node] : [];
    const gate = gateForStep(step);
    if (gate) lastGate = gate;
    const durationMs = (step as { durationMs?: number }).durationMs;
    if (typeof durationMs === 'number') totalDurationMs += durationMs;

    // A gate keeps the phase's own identity in the TITLE (council vs. verify) so two gates in one
    // turn don't both read as a generic "Approval gate" — the verdict lives in the summary/badge.
    const gateTitle = gate
      ? gate.kind === 'council'
        ? PHASE_TITLE.deliberate
        : gate.kind === 'quality'
          ? 'Verify'
          : PHASE_TITLE.gate
      : PHASE_TITLE[phaseId];
    phases.push({
      id: `phase-${index}-${step.stage}`,
      phase: gate ? 'gate' : phaseId,
      title: gateTitle,
      summary: gate ? gate.reason : summarizeNodes(nodes, step.label),
      status: step.status === 'running' ? 'running' : gate && !gate.approved ? 'bad' : 'done',
      round,
      gate,
      nodes,
      durationMs,
    });
  });

  const approved = lastGate ? lastGate.approved : true;

  return {
    phases,
    rounds: maxRound,
    approved,
    featureNotes: collectFeatureNotes(enriched),
    totalDurationMs,
  };
}
