import { describe, expect, it } from 'vitest';
import {
  getExplicitGrokFriendPrompt,
  isWorkspaceDeltaQuestion,
  tryEmitAttachedLiveContextResponse,
  tryEmitBridgeCapabilityAudit,
  tryEmitPrivateLiveContextResponse,
} from '../src/chat/bridge-evidence-discipline.js';

describe('bridge evidence discipline', () => {
  it('extracts only an explicit Grok friend-channel request', () => {
    expect(getExplicitGrokFriendPrompt('Ask Grok: give one concise critique of this bridge.'))
      .toBe('give one concise critique of this bridge.');
    expect(getExplicitGrokFriendPrompt('Did you actually call Grok this turn? Give proof.'))
      .toBeNull();
    expect(getExplicitGrokFriendPrompt('Tell me whether Grok might help here.'))
      .toBeNull();
  });

  it('reports the requested private live source instead of a generic file answer', () => {
    expect(tryEmitPrivateLiveContextResponse(
      'What is the last line in my terminal output right now? Answer with the observed line only, or say unavailable.',
    )).toMatch(/live terminal output unavailable/i);

    expect(tryEmitPrivateLiveContextResponse(
      'What text is selected in my editor right now? Answer with the observed text only, or say unavailable.',
    )).toMatch(/live editor selection unavailable/i);

    expect(tryEmitPrivateLiveContextResponse(
      'What exact text do you see in my current chat window? Report only direct observation, not likely content.',
    )).toMatch(/live chat-window observation unavailable/i);
  });

  it('does not treat workspace delta as chat-history recall', () => {
    expect(tryEmitPrivateLiveContextResponse(
      'Which files did I change in this repo since my last message? Answer from direct observation only; if you cannot inspect it, say unavailable.',
    )).toMatch(/live workspace delta unavailable/i);
  });

  it('matches explicit current workspace-delta questions without catching generic file questions', () => {
    expect(isWorkspaceDeltaQuestion('Which files changed in my repo right now?')).toBe(true);
    expect(isWorkspaceDeltaQuestion('Show the current workspace delta.')).toBe(true);
    expect(isWorkspaceDeltaQuestion('What does this file do?')).toBe(false);
  });

  it('denies a capture-adapter call when no timestamped result is attached', () => {
    expect(tryEmitPrivateLiveContextResponse(
      'Did you actually call the VS Code capture adapter in this turn? Answer yes or no, then give the timestamped evidence you received.',
    )).toBe([
      '**No.**',
      'I did not receive a timestamped VS Code companion capture result in this turn, so I cannot claim that a live adapter call completed.',
    ].join('\n\n'));
  });

  it('denies a Grok friend-channel call when no attributed result is attached', () => {
    expect(tryEmitPrivateLiveContextResponse(
      'Did you actually call Grok this turn? Give timestamped proof.',
    )).toBe([
      '**No.**',
      'I did not receive an attributed Grok friend-channel result in this turn, so I cannot claim that a Grok call completed.',
    ].join('\n\n'));
  });

  it('incorporates fresh matching companion evidence with attribution', () => {
    const response = tryEmitAttachedLiveContextResponse(
      'what file do I have open right now?',
      {
        source: 'vscode-capture-adapter',
        capturedAt: '2026-06-02T08:00:00.000Z',
        openFile: 'packages/core/src/chat/service.ts',
      },
      Date.parse('2026-06-02T08:00:10.000Z'),
    );

    expect(response).toMatch(/live editor file/i);
    expect(response).toMatch(/packages\/core\/src\/chat\/service\.ts/i);
    expect(response).toMatch(/vscode-capture-adapter/i);
    expect(response).toMatch(/2026-06-02T08:00:00\.000Z/i);
  });

  it('ignores stale companion evidence', () => {
    expect(tryEmitAttachedLiveContextResponse(
      'what file do I have open right now?',
      {
        source: 'vscode-capture-adapter',
        capturedAt: '2026-06-02T07:58:00.000Z',
        openFile: 'stale/path.ts',
      },
      Date.parse('2026-06-02T08:00:00.000Z'),
    )).toBeNull();
  });

  it('separates observed capability evidence from proposals', () => {
    const response = tryEmitBridgeCapabilityAudit(
      'Which Vai bridge capabilities are implemented end to end today, and which are proposals? Use only evidence available in this turn.',
    );

    expect(response).toMatch(/observed in this turn/i);
    expect(response).toMatch(/not demonstrated in this turn/i);
    expect(response).toMatch(/planned integrations remain proposals/i);
    expect(response).not.toMatch(/smart routing decision|correct action: send/i);
  });
});
