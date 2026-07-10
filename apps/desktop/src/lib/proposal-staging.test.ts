import { describe, expect, it } from 'vitest';
import { makeProposal } from '@vai/core/browser';
import { mergeUniqueProposals, proposalStorageScope } from './proposal-staging.js';

describe('mergeUniqueProposals', () => {
  it('deduplicates a replayed content-addressed proposal', () => {
    const proposal = makeProposal('package.json', '{"old":true}', '{"old":false}', {
      summary: 'Modernize dependencies',
      author: { memberId: 'vai', role: 'builder' },
    });
    expect(proposal).not.toBeNull();
    expect(mergeUniqueProposals([proposal!], [proposal!])).toEqual([proposal]);
  });

  it('keeps distinct candidate contents for the same file', () => {
    const first = makeProposal('package.json', '{"old":true}', '{"choice":1}', {
      summary: 'First candidate',
      author: { memberId: 'vai', role: 'builder' },
    });
    const second = makeProposal('package.json', '{"old":true}', '{"choice":2}', {
      summary: 'Second candidate',
      author: { memberId: 'vai', role: 'builder' },
    });
    expect(mergeUniqueProposals([first!], [second!])).toHaveLength(2);
  });

  it('clears rejected review history when a new artifact is staged', () => {
    const rejected = makeProposal('package.json', '{}', '{"bad":true}', {
      summary: 'Rejected candidate',
      author: { memberId: 'vai', role: 'builder' },
    });
    const next = makeProposal('package.json', '{}', '{"good":true}', {
      summary: 'New candidate',
      author: { memberId: 'vai', role: 'builder' },
    });
    expect(mergeUniqueProposals([{ ...rejected!, status: 'rejected' }], [next!])).toEqual([next]);
  });
});

describe('proposalStorageScope', () => {
  it('isolates proposal review by chat even when two chats use different folders', () => {
    expect(proposalStorageScope({ conversationId: 'mpm-chat', localRoot: 'C:\\code\\mpm' }))
      .toBe('conversation:mpm-chat');
    expect(proposalStorageScope({ conversationId: 'storybook-chat', localRoot: 'C:\\code\\storybook' }))
      .toBe('conversation:storybook-chat');
  });

  it('normalizes a folder fallback when no conversation exists yet', () => {
    expect(proposalStorageScope({ localRoot: 'C:\\Users\\V3GGA\\Documents\\DEV_MPM\\' }))
      .toBe('workspace:c:/users/v3gga/documents/dev_mpm');
  });
});
