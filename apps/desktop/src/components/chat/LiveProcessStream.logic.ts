import type { ChatProgressStep } from '../../stores/chatStore.js';
import { stripAnsi } from '../../lib/strip-ansi.js';

/** Flat row for live streaming — no nested tree until a step is active. */
export interface LiveFlatRow {
  id: string;
  stage: string;
  label: string;
  detail?: string;
  status: 'running' | 'done';
  subLines: LiveSubLine[];
}

export interface LiveSubLine {
  id: string;
  label: string;
  detail?: string;
}

export function flattenStepsForLive(steps: readonly ChatProgressStep[]): LiveFlatRow[] {
  return steps.map((step, index) => {
    const subLines: LiveSubLine[] = [];
    for (const [logIndex, entry] of (step.processLog ?? []).entries()) {
      subLines.push({
        id: `${step.stage}-log-${logIndex}`,
        label: entry.label,
        detail: entry.body?.trim() ? stripAnsi(entry.body.trim()).slice(0, 280) : undefined,
      });
    }
    for (const [memberIndex, member] of (step.councilMembers ?? []).entries()) {
      subLines.push({
        id: `${step.stage}-member-${memberIndex}`,
        label: member.name,
        detail: member.failed
          ? stripAnsi(member.note?.trim() || 'no response')
          : `${member.verdict} · ${Math.round(member.confidence * 100)}%`,
      });
    }
    for (const [toolIndex, tool] of (step.toolRuns ?? []).entries()) {
      subLines.push({
        id: `${step.stage}-tool-${toolIndex}`,
        label: tool.name,
        detail: tool.status === 'running' ? 'running…' : `${tool.success === false ? 'failed' : 'ok'}`,
      });
    }

    const detail = step.detail?.trim();
    const shortDetail = detail && detail.length <= 56 ? detail : undefined;

    return {
      id: `${step.stage}-${index}`,
      stage: step.stage,
      label: step.label,
      detail: shortDetail,
      status: step.status === 'running' ? 'running' : 'done',
      subLines,
    };
  });
}

export function pickActiveRowIndex(rows: readonly LiveFlatRow[], visibleCount: number): number {
  if (rows.length === 0 || visibleCount <= 0) return 0;
  return Math.min(visibleCount - 1, rows.length - 1);
}

/** How many completed rows to keep fully visible before folding into a summary chip. */
export const LIVE_VISIBLE_DONE_CAP = 3;

export function partitionLiveRows(rows: readonly LiveFlatRow[], visibleCount: number) {
  const activeIndex = pickActiveRowIndex(rows, visibleCount);
  const doneBeforeActive = rows.slice(0, activeIndex);
  const foldedCount = Math.max(0, doneBeforeActive.length - LIVE_VISIBLE_DONE_CAP);
  const visibleDone = doneBeforeActive.slice(foldedCount);
  const active = rows[activeIndex];

  return {
    activeIndex,
    foldedCount,
    visibleDone,
    active,
    total: rows.length,
  };
}
