import { describe, it, expect } from 'vitest';

/**
 * Regression guard for the top-of-chat GitHub-URL inquiry gate.
 *
 * The measured bug (DEV-VEGGASTARE/zod/hono interviews): a pasted GitHub URL question
 * was grabbed by an early preflight handler and routed to escalate→qwen3, which
 * hallucinated ("hono is Rust"). The fix adds a gate as the FIRST branch of both chat()
 * and chatStream() that matches a GitHub repo URL and routes to tryUrlBasedRequest (which
 * fetches the real repo). This test locks the gate's MATCH condition so it can't silently
 * narrow and let the cascade hijack repo turns again.
 *
 * Kept as a pure predicate test (no network): it mirrors the exact regex used by the gate.
 */
const GATE = /https?:\/\/\S*github\.com\/[\w.-]+\/[\w.-]+/i;

describe('GitHub URL inquiry gate — match condition', () => {
  it('fires for the repo questions that previously failed', () => {
    const fires = [
      'Look at https://github.com/veggaen/DEV-VEGGASTARE and tell me what is this app and is it good?',
      'What stack does https://github.com/veggaen/DEV-VEGGASTARE use?',
      'Check out https://github.com/colinhacks/zod — what does it do?',
      'is https://github.com/honojs/hono any good?',
      'review http://github.com/owner/repo please',
    ];
    for (const q of fires) expect(GATE.test(q), q).toBe(true);
  });

  it('does NOT fire for non-repo / non-GitHub turns', () => {
    const skips = [
      'tell me about your engine',
      'what is the capital of japan',
      'look at github.com', // bare host, no owner/repo
      'https://example.com/some/page is this good?',
      'https://github.com/explore', // not an owner/repo pair
    ];
    for (const q of skips) expect(GATE.test(q), q).toBe(false);
  });
});
