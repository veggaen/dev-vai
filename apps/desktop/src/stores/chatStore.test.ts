import { describe, expect, it } from 'vitest';
import {
  auditPriorDraftExcerpt,
  resolveConversationSandboxProjectIdOption,
  resolveConversationResumeId,
  isConversationWorking,
  finalizeProgressStepsForMessage,
  mergeAuditPriorDraftExcerpt,
  mergeProgressStepsForMessage,
  parseAssistantMessagePlan,
  shouldResetSandboxOnSwitch,
} from './chatStore.js';

describe('resolveConversationSandboxProjectIdOption', () => {
  it('uses the active sandbox when no explicit option is provided', () => {
    expect(resolveConversationSandboxProjectIdOption(undefined, 'active-sandbox')).toBe('active-sandbox');
  });

  it('preserves an explicit sandbox id option', () => {
    expect(resolveConversationSandboxProjectIdOption({ sandboxProjectId: 'chosen-sandbox' }, 'active-sandbox')).toBe('chosen-sandbox');
  });

  it('preserves explicit null as a clean conversation request', () => {
    expect(resolveConversationSandboxProjectIdOption({ sandboxProjectId: null }, 'active-sandbox')).toBeNull();
  });
});

describe('resolveConversationResumeId', () => {
  const conversations = [{ id: 'chat-a' }, { id: 'chat-b' }];

  it('resumes a saved chat only when it still exists', () => {
    expect(resolveConversationResumeId(conversations, 'chat-b')).toBe('chat-b');
  });

  it('refuses stale saved ids so reload does not show a phantom active row', () => {
    expect(resolveConversationResumeId(conversations, 'deleted-chat')).toBeNull();
  });

  it('does nothing without a saved id', () => {
    expect(resolveConversationResumeId(conversations, null)).toBeNull();
  });
});

describe('async audit metadata persistence helpers', () => {
  it('rehydrates audit metadata from a persisted assistant plan without requiring evidence', () => {
    const auditMeta = {
      outcomeKind: 'O8',
      convened: true,
      revised: true,
      resetFired: true,
      draftStrategy: 'vai-buffered',
      visibleTextChanged: true,
      realIntent: 'wants the concrete fix',
      methodLesson: 'lead with the fix',
      councilOutcome: 'ship',
    } as const;

    expect(parseAssistantMessagePlan(JSON.stringify({ auditMeta }))).toEqual({ auditMeta });
  });

  it('preserves a bounded pre-reset draft excerpt when done thinking lacks one', () => {
    const thinking = mergeAuditPriorDraftExcerpt({
      intent: 'other',
      strategy: 'vai-buffered',
      strategyChain: [],
      auditMeta: {
        outcomeKind: 'O8',
        convened: true,
        revised: true,
        resetFired: true,
        visibleTextChanged: true,
      },
    }, 'First draft before the council rewrite.');

    expect(thinking?.auditMeta?.priorTextExcerpt).toBe('First draft before the council rewrite.');
  });

  it('bounds prior draft excerpts for compact storage', () => {
    const excerpt = auditPriorDraftExcerpt('x '.repeat(400));
    expect(excerpt?.length).toBeLessThanOrEqual(600);
    expect(excerpt?.endsWith('...')).toBe(true);
  });
});

describe('isConversationWorking — "Working…" badge attribution', () => {
  it('marks the chat that is actually streaming', () => {
    expect(isConversationWorking('chat-A', 'chat-A')).toBe(true);
  });

  it('does NOT mark a different chat even if it is the active selection', () => {
    // The bug: user switches from streaming chat-A to chat-B; chat-B must not
    // show "Working…" just because it became active.
    expect(isConversationWorking('chat-B', 'chat-A')).toBe(false);
  });

  it('keeps the badge on the streaming chat after the user switches away', () => {
    // Streaming on A, viewing B → A still shows the badge, B does not.
    expect(isConversationWorking('chat-A', 'chat-A')).toBe(true);
    expect(isConversationWorking('chat-B', 'chat-A')).toBe(false);
  });

  it('marks no chat when nothing is streaming', () => {
    expect(isConversationWorking('chat-A', null)).toBe(false);
  });
});

describe('shouldResetSandboxOnSwitch — no cross-chat code leak', () => {
  it('resets when opening a chat bound to a different project', () => {
    expect(shouldResetSandboxOnSwitch('proj-1', 'proj-2')).toBe(true);
  });

  it('resets when opening a chat with no sandbox while one is loaded', () => {
    expect(shouldResetSandboxOnSwitch('proj-1', null)).toBe(true);
    expect(shouldResetSandboxOnSwitch('proj-1', undefined)).toBe(true);
  });

  it('does NOT reset when re-opening the same project (keeps its files)', () => {
    expect(shouldResetSandboxOnSwitch('proj-1', 'proj-1')).toBe(false);
  });

  it('does nothing when no project is currently loaded', () => {
    expect(shouldResetSandboxOnSwitch(null, 'proj-2')).toBe(false);
  });
});

describe('mergeProgressStepsForMessage — stable process timeline identity', () => {
  it('updates a council round in place instead of moving it below newer rounds', () => {
    const afterRound2 = mergeProgressStepsForMessage([
      { stage: 'council-vai-round-1', label: 'Council R1 running', status: 'done' },
      { stage: 'vai-redraft', label: 'Vai redrafted', status: 'done' },
      { stage: 'council-vai-round-2', label: 'Council R2 running', status: 'running' },
    ], {
      stage: 'council-vai-round-1',
      label: 'Council R1 completed late',
      status: 'done',
      detail: 'late member result arrived',
    });

    expect(afterRound2.map((step) => step.stage)).toEqual([
      'council-vai-round-1',
      'vai-redraft',
      'council-vai-round-2',
    ]);
    expect(afterRound2[0]?.label).toBe('Council R1 completed late');
    expect(afterRound2[2]?.status).toBe('running');
  });

  it('appends a genuinely new round below the completed prior round', () => {
    const steps = mergeProgressStepsForMessage([
      { stage: 'council-vai-round-1', label: 'Council R1', status: 'done' },
      { stage: 'vai-redraft', label: 'Vai redrafted', status: 'done' },
    ], {
      stage: 'council-vai-round-2',
      label: 'Council R2',
      status: 'running',
    });

    expect(steps.map((step) => step.stage)).toEqual([
      'council-vai-round-1',
      'vai-redraft',
      'council-vai-round-2',
    ]);
  });

  it('keeps repeated build actions when a generic stage is reused', () => {
    const steps = mergeProgressStepsForMessage([
      { stage: 'council-review', label: 'Reviewer is checking the edit', status: 'done' },
    ], {
      stage: 'council-review',
      label: 'Reviewer is verifying the repaired edit',
      status: 'running',
    });

    expect(steps).toHaveLength(2);
    expect(steps.map((step) => step.label)).toEqual([
      'Reviewer is checking the edit',
      'Reviewer is verifying the repaired edit',
    ]);
  });

  it('replaces an empty search result when a later pipeline finds real evidence', () => {
    const steps = mergeProgressStepsForMessage([
      { stage: 'search', label: 'No web sources found', status: 'done' },
    ], {
      stage: 'search',
      label: 'Found 1 source',
      detail: '1 source',
      status: 'done',
      processLog: [{ kind: 'artifact', label: 'Sources found (1)', body: 'Official venue page' }],
    });

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ stage: 'search', label: 'Found 1 source', detail: '1 source' });
  });

  it('preserves a terminal failure when a stale running frame arrives late', () => {
    const steps = mergeProgressStepsForMessage([{
      stage: 'verify',
      label: 'Verification failed',
      status: 'done',
      outcome: 'failed',
      evidenceId: 'proof:verify',
    }], {
      stage: 'verify',
      label: 'Still checking',
      status: 'running',
    });

    expect(steps[0]).toMatchObject({
      status: 'done',
      outcome: 'failed',
      evidenceId: 'proof:verify',
    });
  });
});

describe('finalizeProgressStepsForMessage — truthful terminal receipts', () => {
  it('settles unfinished work and tools as failed on an error frame', () => {
    const steps = finalizeProgressStepsForMessage([{
      stage: 'verify',
      label: 'Running typecheck',
      status: 'running',
      toolRuns: [{ id: 'typecheck-1', name: 'typecheck', status: 'running' }],
    }], 'failed');

    expect(steps[0]).toMatchObject({
      status: 'done',
      outcome: 'failed',
      evidenceId: 'progress:1:verify',
    });
    expect(steps[0]?.toolRuns?.[0]).toMatchObject({
      status: 'failed',
      outcome: 'failed',
      evidenceId: 'progress:1:verify:tool:typecheck-1',
    });
    expect(steps.at(-1)).toMatchObject({
      stage: 'turn-terminal',
      label: 'Turn failed',
      outcome: 'failed',
    });
  });

  it('marks a manual stop interrupted without erasing already successful work', () => {
    const steps = finalizeProgressStepsForMessage([
      { stage: 'read', label: 'Read files', status: 'done' },
      { stage: 'build', label: 'Editing', status: 'running' },
    ], 'interrupted');

    expect(steps[0]?.outcome).toBe('succeeded');
    expect(steps[1]?.outcome).toBe('interrupted');
    expect(steps.at(-1)).toMatchObject({
      stage: 'turn-terminal',
      label: 'Turn interrupted',
      outcome: 'interrupted',
    });
  });

  it('replaces an earlier terminal marker instead of duplicating it', () => {
    const first = finalizeProgressStepsForMessage([
      { stage: 'read', label: 'Read files', status: 'running' },
    ], 'interrupted');
    const retried = finalizeProgressStepsForMessage(first, 'succeeded');
    expect(retried.filter((step) => step.stage === 'turn-terminal')).toHaveLength(1);
    expect(retried.at(-1)?.outcome).toBe('succeeded');
  });

  it('does not create a process surface for turns that emitted no progress', () => {
    expect(finalizeProgressStepsForMessage([], 'succeeded')).toEqual([]);
  });
});
