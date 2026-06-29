/**
 * Tests for grounded GitHub repo INQUIRY answers.
 *
 * Regression for the DEV-VEGGASTARE / hono / zod traces: "look at <repo> and tell me what
 * is this app and is it good?" used to return a metadata card + a "rebuild / paste code"
 * menu (formatGitHubRepoSummary) — it never actually answered. Now an inquiry routes to
 * formatGitHubRepoAssessment, which answers from the description + topics + README and gives
 * an honest, signal-bound assessment. We test the formatter directly with synthetic repo
 * info so the test is hermetic (no GitHub network).
 */
import { describe, expect, it } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

const engine = new VaiEngine({ testMode: true }) as unknown as {
  formatGitHubRepoAssessment: (owner: string, repo: string, info: unknown) => string;
};

const honoInfo = {
  description: 'Web framework built on Web Standards',
  language: 'TypeScript',
  topics: ['hono', 'web-framework', 'edge'],
  stars: 21000,
  homepage: 'https://hono.dev',
  readmeText: '# Hono\n\nHono is a small, simple, and ultrafast web framework built on Web Standards. It works on any JavaScript runtime.',
};

describe('formatGitHubRepoAssessment', () => {
  it('answers from the README and assesses on real signals', () => {
    const out = engine.formatGitHubRepoAssessment('honojs', 'hono', honoInfo);
    expect(out).toContain('honojs/hono');
    expect(out).toContain('Web Standards'); // grounded in the README, not a hijack
    expect(out).toContain('TypeScript'); // answers "what stack"
    expect(out).toMatch(/21,000 stars/); // honest adoption signal
    expect(out).toMatch(/surface read, not a code audit/i); // no overclaiming
    // Must NOT be the old build-menu or a refusal.
    expect(out).not.toMatch(/what would you like to do\?/i);
    expect(out).not.toMatch(/cannot access/i);
  });

  it('flags a work-in-progress repo from its README', () => {
    const out = engine.formatGitHubRepoAssessment('veggaen', 'DEV-VEGGASTARE', {
      description: 'Nextjs 14->15->16 with NextAuth 5 and still a work in progress',
      language: 'TypeScript',
      topics: [],
      stars: 0,
      homepage: 'https://dev-veggastare.vercel.app',
      readmeText: 'Nextjs 14->15->16 with NextAuth 5 and still a work in progress.',
    });
    expect(out).toMatch(/work in progress/i);
    expect(out).toMatch(/personal\/early|assess it on the code/i); // honest about 0 stars
    expect(out).not.toMatch(/cannot access/i);
  });

  it('says so plainly when the repo fetch failed instead of guessing', () => {
    const out = engine.formatGitHubRepoAssessment('owner', 'repo', null);
    expect(out).toMatch(/didn'?t return its details|won'?t guess/i);
    expect(out).not.toMatch(/\bmight be\b|\bcould be\b/i);
  });
});
