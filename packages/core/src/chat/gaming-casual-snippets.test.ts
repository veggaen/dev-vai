import { describe, expect, it } from 'vitest';
import { tryGamingCasualSnippet } from './gaming-casual-snippets.js';

describe('tryGamingCasualSnippet does not over-match on a single keyword', () => {
  it('only fires the Docker/Podman blurb when BOTH are named (a real comparison)', () => {
    expect(tryGamingCasualSnippet('docker vs podman for local dev')).toMatch(/Docker vs Podman/);
    // A bare docker mention must NOT pull the Podman comparison.
    expect(tryGamingCasualSnippet('how do i install docker on ubuntu')).toBeNull();
    expect(tryGamingCasualSnippet("what's the difference between docker and kubernetes?")).toBeNull();
  });

  it('still answers genuine casual prompts', () => {
    expect(tryGamingCasualSnippet('dota 2 mmr explained')).toMatch(/MMR/);
    expect(tryGamingCasualSnippet('redis vs postgres for sessions')).toMatch(/Redis vs Postgres/);
  });
});
