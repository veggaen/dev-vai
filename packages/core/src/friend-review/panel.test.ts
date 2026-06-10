import { describe, expect, it, vi } from 'vitest';
import {
  aggregateVerdicts,
  runFriendReviewPanel,
} from './panel.js';
import {
  createGrokFriendReviewer,
  createModelReviewer,
  parseFriendVerdict,
} from './reviewers.js';
import { toResponseReviewer } from './integration.js';
import type { FriendReviewInput, FriendReviewer, FriendVerdict } from './types.js';
import type { ChatRequest, ChatResponse, ModelAdapter } from '../models/adapter.js';

const INPUT: FriendReviewInput = {
  prompt: 'what are good restaurants in Hommersåk, Norway?',
  draft: 'Norway is a country in Northern Europe; its capital is Oslo.',
  modelId: 'vai:v0',
  turnKind: 'factual',
  hasEvidence: false,
  sources: [],
};

function verdict(partial: Partial<FriendVerdict> & Pick<FriendVerdict, 'verdict'>): FriendVerdict {
  return {
    reviewerId: partial.reviewerId ?? 'r',
    reviewerName: partial.reviewerName ?? 'Reviewer',
    verdict: partial.verdict,
    confidence: partial.confidence ?? 0.8,
    summary: partial.summary ?? 'summary',
    concerns: partial.concerns ?? [],
    suggestions: partial.suggestions ?? [],
    requiresFreshEvidence: partial.requiresFreshEvidence ?? false,
    durationMs: partial.durationMs ?? 1,
    error: partial.error,
  };
}

/** Minimal adapter that replies with a fixed string, asserting the review shape. */
function stubAdapter(reply: string, opts: { id?: string; onRequest?: (r: ChatRequest) => void } = {}): ModelAdapter {
  return {
    id: opts.id ?? 'local:stub',
    displayName: opts.id ?? 'Stub',
    supportsStreaming: false,
    supportsToolUse: false,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      opts.onRequest?.(request);
      return {
        message: { role: 'assistant', content: reply },
        usage: { promptTokens: 1, completionTokens: 1 },
        finishReason: 'stop',
      };
    },
    async *chatStream() {
      yield { type: 'done' as const };
    },
  };
}

describe('aggregateVerdicts', () => {
  it('approves when every friend says good', () => {
    const notice = aggregateVerdicts([
      verdict({ verdict: 'good' }),
      verdict({ verdict: 'good', reviewerId: 'r2' }),
    ]);
    expect(notice.outcome).toBe('approved');
    expect(notice.rejected).toBe(false);
    expect(notice.score).toBe(1);
    expect(notice.reviewerIds).toEqual(['r', 'r2']);
    expect(notice.consensus).toMatch(/2 friends reviewed/i);
  });

  it('asks to revise (not block) when a friend wants changes', () => {
    const notice = aggregateVerdicts([
      verdict({ verdict: 'good' }),
      verdict({ verdict: 'needs-work', reviewerId: 'r2', suggestions: ['Add the actual restaurant names'] }),
    ]);
    expect(notice.outcome).toBe('revise');
    expect(notice.rejected).toBe(false);
    expect(notice.score).toBeCloseTo(0.75);
    expect(notice.topSuggestions).toContain('Add the actual restaurant names');
  });

  it('blocks when a friend is confidently bad', () => {
    const notice = aggregateVerdicts([
      verdict({ verdict: 'bad', confidence: 0.9, summary: 'Answers Norway, not restaurants.', concerns: ['Off-topic: describes the country, not local restaurants'] }),
    ]);
    expect(notice.outcome).toBe('blocked');
    expect(notice.rejected).toBe(true);
    expect(notice.consensus).toMatch(/Blocked:/);
    expect(notice.topConcerns[0]).toMatch(/off-topic/i);
  });

  it('a low-confidence bad verdict only triggers revise, not block', () => {
    const notice = aggregateVerdicts(
      [verdict({ verdict: 'bad', confidence: 0.2 })],
      { blockConfidence: 0.5 },
    );
    expect(notice.outcome).toBe('revise');
    expect(notice.rejected).toBe(false);
  });

  it('excludes failed verdicts from scoring but keeps them on the notice', () => {
    const notice = aggregateVerdicts([
      verdict({ verdict: 'good' }),
      verdict({ verdict: 'needs-work', reviewerId: 'dead', error: 'timeout' }),
    ]);
    expect(notice.reviewerIds).toEqual(['r']); // failed one excluded
    expect(notice.score).toBe(1);
    expect(notice.verdicts).toHaveLength(2); // but still recorded
  });

  it('approves with an honest note when no usable verdicts exist', () => {
    const notice = aggregateVerdicts([
      verdict({ verdict: 'bad', confidence: 1, error: 'network' }),
    ]);
    expect(notice.outcome).toBe('approved');
    expect(notice.rejected).toBe(false);
    expect(notice.consensus).toMatch(/no reviewer returned a usable verdict/i);
  });

  it('dedups and ranks concerns by frequency', () => {
    const notice = aggregateVerdicts([
      verdict({ verdict: 'needs-work', concerns: ['Too vague', 'No sources'] }),
      verdict({ verdict: 'needs-work', reviewerId: 'r2', concerns: ['too vague'] }),
    ]);
    expect(notice.topConcerns[0]).toBe('Too vague'); // 2 mentions, original casing kept
    expect(notice.topConcerns).toContain('No sources');
  });
});

describe('runFriendReviewPanel', () => {
  it('runs reviewers in parallel and tolerates one throwing', async () => {
    const good: FriendReviewer = {
      id: 'good',
      displayName: 'Good',
      review: async () => verdict({ verdict: 'good', reviewerId: 'good' }),
    };
    const flaky: FriendReviewer = {
      id: 'flaky',
      displayName: 'Flaky',
      review: async () => {
        throw new Error('boom');
      },
    };
    const onNotice = vi.fn();
    const notice = await runFriendReviewPanel([good, flaky], INPUT, { onNotice });

    expect(notice.outcome).toBe('approved'); // flaky failure doesn't block
    expect(notice.reviewerIds).toEqual(['good']);
    expect(notice.verdicts.find((v) => v.reviewerId === 'flaky')?.error).toBe('boom');
    expect(onNotice).toHaveBeenCalledOnce();
  });

  it('records a timeout as a non-blocking failure', async () => {
    const slow: FriendReviewer = {
      id: 'slow',
      displayName: 'Slow',
      review: () => new Promise(() => {}), // never resolves
    };
    const notice = await runFriendReviewPanel([slow], INPUT, { timeoutMs: 10 });
    expect(notice.reviewerIds).toEqual([]); // none usable
    expect(notice.verdicts[0].error).toMatch(/timed out/i);
    expect(notice.rejected).toBe(false);
  });
});

describe('createModelReviewer', () => {
  it('asks the model to review-only and parses its JSON verdict', async () => {
    let seen: ChatRequest | undefined;
    const adapter = stubAdapter(
      JSON.stringify({
        verdict: 'bad',
        confidence: 0.95,
        summary: 'Describes Norway instead of listing restaurants.',
        concerns: ['Off-topic'],
        suggestions: ['Search for local listings first'],
        requiresFreshEvidence: true,
      }),
      { id: 'local:qwen2.5:7b', onRequest: (r) => { seen = r; } },
    );
    const reviewer = createModelReviewer({ adapter });
    const v = await reviewer.review(INPUT);

    expect(seen?.messages[0].role).toBe('system');
    expect(seen?.messages[0].content).toMatch(/review only/i);
    expect(seen?.temperature).toBe(0);
    expect(v).toMatchObject({
      reviewerId: 'local:qwen2.5:7b',
      verdict: 'bad',
      confidence: 0.95,
      requiresFreshEvidence: true,
    });
    expect(v?.concerns).toEqual(['Off-topic']);
  });

  it('tolerates a fenced ```json block', async () => {
    const adapter = stubAdapter('```json\n{"verdict":"good","confidence":0.8,"summary":"ok"}\n```');
    const reviewer = createModelReviewer({ adapter });
    const v = await reviewer.review(INPUT);
    expect(v?.verdict).toBe('good');
  });

  it('returns null when the model emits unparseable garbage', async () => {
    const adapter = stubAdapter('I cannot help with that.');
    const reviewer = createModelReviewer({ adapter });
    expect(await reviewer.review(INPUT)).toBeNull();
  });

  it('clamps an out-of-range confidence', () => {
    const v = parseFriendVerdict(
      '{"verdict":"good","confidence":5,"summary":"ok"}',
      { reviewerId: 'x', reviewerName: 'X', durationMs: 1 },
    );
    expect(v?.confidence).toBe(1);
  });
});

describe('createGrokFriendReviewer', () => {
  it('parses a verdict from the friend channel response object', async () => {
    const reviewer = createGrokFriendReviewer({
      ask: async () => ({ response: '{"verdict":"needs-work","confidence":0.6,"summary":"Add detail","suggestions":["Name places"]}' }),
    });
    const v = await reviewer.review(INPUT);
    expect(v).toMatchObject({ reviewerId: 'grok-friend-channel', verdict: 'needs-work' });
    expect(v?.suggestions).toEqual(['Name places']);
  });
});

describe('toResponseReviewer (chat-service seam)', () => {
  it('maps a blocked panel to a reject with the headline concern', async () => {
    const reviewer: FriendReviewer = {
      id: 'q',
      displayName: 'Qwen',
      review: async () => verdict({
        verdict: 'bad',
        confidence: 0.9,
        summary: 'Off-topic.',
        concerns: ['Describes the country, not restaurants'],
        requiresFreshEvidence: true,
      }),
    };
    const result = await toResponseReviewer([reviewer]).review(INPUT);
    expect(result?.decision).toBe('reject');
    expect(result?.reason).toMatch(/Describes the country/);
    expect(result?.requiresFreshEvidence).toBe(true);
  });

  it('maps an approving panel to approve', async () => {
    const reviewer: FriendReviewer = {
      id: 'q',
      displayName: 'Qwen',
      review: async () => verdict({ verdict: 'good' }),
    };
    const result = await toResponseReviewer([reviewer]).review(INPUT);
    expect(result?.decision).toBe('approve');
  });

  it('abstains (null) when no reviewers are configured', async () => {
    expect(await toResponseReviewer([]).review(INPUT)).toBeNull();
  });
});
