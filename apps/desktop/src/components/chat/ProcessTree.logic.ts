import type { ChatProgressStep, CouncilThinkingUI } from '../../stores/chatStore.js';

/**
 * Tree model for ProcessTree. The backend streams a FLAT list of progress steps
 * (`{ stage, label, detail, status }`) plus, separately, the council result on
 * the settled turn. This module folds those into a two-level tree client-side so
 * the UI can render in-place expandable sub-work without a backend change.
 *
 * Rules:
 *  - Each progress step becomes one top-level node.
 *  - The "council" step (matched by stage) gets the council members as children.
 *  - An image-gen turn's steps become children of a synthetic "Generating image"
 *    node when there are no engine steps to attach them to.
 *  - Tone drives the spinner colour so search / council / image read at a glance.
 */

export type ProcessTone = 'default' | 'search' | 'council' | 'image' | 'verify' | 'build' | 'compose';

export interface ProcessNode {
  id: string;
  label: string;
  /** Optional terser label for the collapsed one-line summary. */
  shortLabel?: string;
  /** Short inline detail shown on the row (e.g. "8.1s", "standalone topic retention"). */
  detail?: string;
  /** Longer "what actually happened" body revealed when the row is expanded —
   *  search results, command output, the model's note, etc. Makes every row a
   *  click-to-see-deeper affordance even when it has no structured children. */
  note?: string;
  status: 'running' | 'done' | 'bad';
  tone?: ProcessTone;
  children: ProcessNode[];
}

/** A node is expandable when it has structured children OR a longer note body. */
export function isExpandable(node: ProcessNode): boolean {
  return node.children.length > 0 || Boolean(node.note && node.note.trim());
}

function toneForStage(stage: string): ProcessTone {
  if (stage.startsWith('council')) return 'council';
  if (stage === 'vai-draft') return 'compose';
  if (stage === 'search' || stage === 'escalate' || stage === 'research') return 'search';
  if (stage === 'quality-check' || stage === 'verify') return 'verify';
  if (stage.startsWith('build') || stage === 'apply' || stage === 'preview') return 'build';
  if (stage === 'image' || stage.startsWith('image')) return 'image';
  return 'default';
}

/** A terse label for the settled summary line ("Searched · Council · Wrote files"). */
function shortLabelForStage(stage: string, label: string): string {
  if (stage.startsWith('council')) return stage === 'council-vai' ? 'Council (Vai)' : 'Council';
  if (stage === 'vai-draft') return 'Vai proposed';
  if (stage === 'search' || stage === 'research') return 'Searched';
  if (stage === 'quality-check' || stage === 'verify') return 'Verified';
  if (stage.startsWith('build') || stage === 'apply') return 'Built';
  if (stage === 'escalate') return 'Escalated';
  // Fall back to the first 2 words of the label.
  return label.split(/\s+/).slice(0, 2).join(' ');
}

function verdictTone(verdict: string, failed?: boolean): ProcessNode['status'] {
  if (failed) return 'bad';
  if (verdict === 'bad') return 'bad';
  return 'done';
}

export function buildProcessTree(
  steps: readonly ChatProgressStep[],
  council?: CouncilThinkingUI,
  imageSteps?: readonly { phase: string; label: string; flaws?: string[] }[],
  vaiProposedDraft?: string,
): ProcessNode[] {
  const nodes: ProcessNode[] = [];
  const hasVaiDraftStep = steps.some((step) => step.stage === 'vai-draft');

  for (const [i, step] of steps.entries()) {
    const tone = toneForStage(step.stage);
    // A short detail (≤48 chars, no sentence break) reads as an inline suffix;
    // anything longer is "what happened" content revealed on expand.
    const detail = step.detail?.trim();
    const isShortDetail = !!detail && detail.length <= 48 && !/[.!?]\s/.test(detail);
    const node: ProcessNode = {
      id: `step-${i}-${step.stage}`,
      label: step.label,
      shortLabel: shortLabelForStage(step.stage, step.label),
      detail: isShortDetail ? detail : undefined,
      note: !isShortDetail ? detail : undefined,
      status: step.status === 'running' ? 'running' : 'done',
      tone,
      children: [],
    };

    // Attach council members to the vai-path review step when present; otherwise
    // the legacy single "council" step (fallback-only turns).
    if (tone === 'council' && council && council.members.length > 0) {
      const attachHere =
        step.stage === 'council-vai'
        || (step.stage === 'council' && !steps.some((s) => s.stage === 'council-vai'))
        || step.stage === 'council-fallback';
      if (attachHere && step.stage !== 'council-fallback') {
        node.children = council.members.map((m, mi) => ({
          id: `council-${mi}-${m.name}`,
          label: m.name,
          detail: m.failed
            ? 'no response'
            : `${m.verdict} @ ${Math.round(m.confidence * 100)}%`,
          note: m.failed ? undefined : (m.note?.trim() || undefined),
          status: verdictTone(m.verdict, m.failed),
          tone: 'council',
          children: [],
        }));
      }
    }

    nodes.push(node);
  }

  // Rehydrate from thinking when progress steps were not persisted (e.g. reload).
  if (vaiProposedDraft?.trim() && !hasVaiDraftStep) {
    const draft = vaiProposedDraft.trim();
    nodes.unshift({
      id: 'vai-draft-thinking',
      label: 'Vai proposed an answer',
      shortLabel: 'Vai proposed',
      note: draft,
      status: 'done',
      tone: 'compose',
      children: [],
    });
  }

  // Image-gen steps: if the engine emitted no steps, surface them as their own
  // top node so an image turn still shows produce→verify→regenerate live.
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
