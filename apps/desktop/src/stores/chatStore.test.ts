import { describe, expect, it } from 'vitest';
import {
  resolveConversationSandboxProjectIdOption,
  isConversationWorking,
  mergeProgressStepsForMessage,
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
});
