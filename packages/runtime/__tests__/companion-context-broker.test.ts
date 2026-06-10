import { describe, expect, it } from 'vitest';
import { CompanionContextBroker } from '../src/companion-context/broker.js';

describe('CompanionContextBroker', () => {
  it('returns a claimed companion result to the waiting requester', async () => {
    const broker = new CompanionContextBroker();
    const result = broker.request({
      requestedFields: ['openFile'],
      timeoutMs: 100,
    });

    const workItem = broker.poll({ clientId: 'vscode-client' });
    expect(workItem?.requestedFields).toEqual(['openFile']);

    broker.respond(workItem!.requestId, 'vscode-client', {
      source: 'vscode-capture-adapter',
      capturedAt: new Date().toISOString(),
      openFile: 'packages/runtime/src/routes/chat.ts',
    });

    await expect(result).resolves.toMatchObject({
      source: 'vscode-capture-adapter',
      openFile: 'packages/runtime/src/routes/chat.ts',
    });
    expect(broker.getPendingCount()).toBe(0);
  });

  it('does not expose a user-targeted request to a different user companion', async () => {
    const broker = new CompanionContextBroker();
    const result = broker.request({
      requestedFields: ['selection'],
      targetUserId: 'user-a',
      timeoutMs: 20,
    });

    expect(broker.poll({ clientId: 'client-b', userId: 'user-b' })).toBeNull();
    await expect(result).resolves.toBeUndefined();
  });

  it('rejects a response from a client that did not claim the request', async () => {
    const broker = new CompanionContextBroker();
    const result = broker.request({
      requestedFields: ['openFile'],
      timeoutMs: 20,
    });
    const workItem = broker.poll({ clientId: 'client-a' });

    expect(() => broker.respond(workItem!.requestId, 'client-b', {
      source: 'vscode-capture-adapter',
      capturedAt: new Date().toISOString(),
      openFile: 'README.md',
    })).toThrow(/not claimed by this client/i);
    await expect(result).resolves.toBeUndefined();
  });
});
