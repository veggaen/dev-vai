/**
 * Tests for the "council recommendation → real READ" bridge.
 *
 * The DEV-VEGGASTARE failure: the user pasted a GitHub link and asked "what is this app
 * and is it good?". Every council member correctly read the intent ("go read the repo")
 * and recommended web-search — but the redraft only ever SEARCHED the bare URL string,
 * got nothing, and produced "I cannot access external websites". The repo was never read.
 *
 * The fix: when the prompt carries explicit URLs, `fetchCouncilDirectedEvidence` reads
 * those exact pages with the Readability reader (`readUrl`) and hands the real page text
 * to the redraft as grounded evidence — even when no search backend is configured.
 *
 * We mock `readUrl` (the network boundary) so the test is hermetic, and assert:
 *   - the pasted repo is READ (readUrl called with the exact URL),
 *   - the redraft receives the page content as its evidence hint,
 *   - it works with NO searchForEvidence callback configured.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const readUrlMock = vi.fn();
vi.mock('../src/tools/read-url.js', () => ({
  readUrl: (...args: unknown[]) => readUrlMock(...args),
}));

// Keep the test hermetic: the council's always-on evidence path constructs a SearchPipeline.
// Stub it so no live SearXNG/network call runs (which would make the test slow/flaky). The
// pasted-URL READ path under test goes through the mocked `readUrl`, not this.
vi.mock('../src/search/pipeline.js', () => ({
  SearchPipeline: class {
    async search() { return { sources: [] }; }
  },
  generateFollowUps: () => [],
}));

// The Chrome AI-Overview bonus is also network; disable it so gatherWebEvidence stays offline.
vi.mock('../src/search/browser-search.js', () => ({
  isBrowserSearchEnabled: () => false,
  fetchGooglePageViaBrowser: async () => ({ aiOverview: null, results: [] }),
}));

import { createDb } from '../src/db/client.js';
import { ChatService } from '../src/chat/service.js';
import type { CouncilRedraftFeedback } from '../src/chat/service.js';
import { ModelRegistry } from '../src/models/adapter.js';
import type { CouncilMember, CouncilMemberNote } from '../src/consensus/types.js';
import type { CouncilRoster } from '../src/consensus/topic-router.js';

function stubMember(id: string, note: Partial<CouncilMemberNote>): CouncilMember {
  return {
    id,
    displayName: id,
    topic: 'other',
    async review(): Promise<CouncilMemberNote> {
      return {
        memberId: id, memberName: id, topic: 'other', verdict: 'needs-work',
        confidence: 0.8, realIntent: 'Understand what the linked repo is and whether it is good',
        hiddenMeaning: '', missingCapability: 'read the repository', suggestedAction: 'web-search',
        searchQuery: '', methodLesson: 'Read the README and assess from it', concerns: ['no repo evidence'],
        durationMs: 1, ...note,
      };
    },
  };
}

function webSearchRoster(): CouncilRoster {
  return { byTopic: {}, default: [stubMember('m1', {}), stubMember('m2', {})] };
}

// `runCouncilLoop` is private; reach it through the same typed escape hatch the redraft-loop
// test uses. The redraft callback receives (feedback, evidenceHint) — we capture the hint.
function runLoop(
  service: ChatService,
  draft: { prompt: string; draftText: string; modelId: string },
  redraft: (feedback: CouncilRedraftFeedback, evidenceHint?: string) => Promise<string | undefined>,
): Promise<{ finalText: string; revised: boolean }> {
  return (service as unknown as {
    runCouncilLoop: (
      d: typeof draft,
      r: typeof redraft,
    ) => Promise<{ finalText: string; revised: boolean }>;
  }).runCouncilLoop(draft, redraft);
}

const REPO = 'https://github.com/veggaen/DEV-VEGGASTARE';
const PROMPT = `Look at ${REPO} and tell me what is this app and is it good?`;
const README = 'Nextjs 14->15->16 with NextAuth 5 and still a work in progress';

describe('council-directed pasted-URL read', () => {
  beforeEach(() => {
    readUrlMock.mockReset();
    readUrlMock.mockResolvedValue({ ok: true, url: REPO, title: 'GitHub - veggaen/DEV-VEGGASTARE', markdown: README });
  });

  it('reads the pasted repo and hands its real content to the redraft (no search backend)', async () => {
    // No searchForEvidence configured — the read path must still fire.
    const service = new ChatService(createDb(':memory:'), new ModelRegistry(), { councilRoster: webSearchRoster() });

    let capturedHint: string | undefined;
    const redraft = vi.fn(async (_feedback: CouncilRedraftFeedback, evidenceHint?: string) => {
      capturedHint = evidenceHint;
      return 'DEV-VEGGASTARE is a Next.js app (14→16) using NextAuth 5, still a work in progress.';
    });

    await runLoop(service, { prompt: PROMPT, draftText: 'I cannot access external websites.', modelId: 'vai:v0' }, redraft);

    // The exact repo URL was READ, not searched.
    expect(readUrlMock).toHaveBeenCalled();
    expect(readUrlMock.mock.calls.some((c) => c[0] === REPO)).toBe(true);

    // The redraft received the real README content as grounded evidence.
    expect(capturedHint).toBeDefined();
    expect(capturedHint).toContain(README);
    expect(capturedHint).toContain(REPO);
    expect(capturedHint).toMatch(/do not say you cannot access/i);
  });

  it('honors VAI_COUNCIL_READ_PASTED_URLS=0 (directed redraft read is off; council evidence is unaffected)', async () => {
    // The flag gates only the DIRECTED-REDRAFT read. The council's own always-on web
    // evidence (separate path) is intentionally not governed by it, so we assert the thing
    // the flag actually controls: the redraft gets NO directed evidence hint.
    const prev = process.env.VAI_COUNCIL_READ_PASTED_URLS;
    process.env.VAI_COUNCIL_READ_PASTED_URLS = '0';
    try {
      const service = new ChatService(createDb(':memory:'), new ModelRegistry(), { councilRoster: webSearchRoster() });
      let capturedHint: string | undefined = 'UNSET';
      const redraft = vi.fn(async (_f: CouncilRedraftFeedback, evidenceHint?: string) => {
        capturedHint = evidenceHint;
        return 'redrafted';
      });
      await runLoop(service, { prompt: PROMPT, draftText: 'draft', modelId: 'vai:v0' }, redraft);
      expect(capturedHint).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.VAI_COUNCIL_READ_PASTED_URLS;
      else process.env.VAI_COUNCIL_READ_PASTED_URLS = prev;
    }
  });
});
