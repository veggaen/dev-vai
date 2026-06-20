import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ModelAdapter } from '@vai/core';
import { buildLocalCouncilRoster } from './build-roster.js';

/**
 * Locks the council seating contract:
 *  - ALL installed local models are seated by default (no silent cap that benches a
 *    deliberately-pulled specialist) — the deepseek-r1-behind-two-qwen bug.
 *  - A recognized niche specialist (DeepSeek-R1 → reasoning) wins a seat even when a
 *    cap would otherwise truncate the panel to the first-discovered generalists.
 *  - The specialist seats on its niche topic.
 */

function fakeLocalAdapter(id: string): ModelAdapter {
  return {
    id,
    provider: 'local',
    displayName: id,
    // The roster pre-warms members (fire-and-forget); a resolved chat keeps it quiet.
    async chat() {
      return { content: 'ok', model: id, usage: { promptTokens: 0, completionTokens: 0 } } as never;
    },
  } as unknown as ModelAdapter;
}

function registryOf(ids: string[]): { listByProvider: (p: string) => ModelAdapter[] } {
  const adapters = ids.map(fakeLocalAdapter);
  return { listByProvider: (p: string) => (p === 'local' ? adapters : []) };
}

describe('buildLocalCouncilRoster — seat all installed models, niche-prioritized', () => {
  // Pre-warm is fire-and-forget; disable to keep the test deterministic/fast.
  const opts = { localLensCount: 1 } as const;
  const env = process.env;
  beforeEach(() => { process.env = { ...env, VAI_COUNCIL_PREWARM: '0', VAI_COUNCIL_CONTEXT_ROOT: '' }; });
  afterEach(() => { process.env = env; });

  it('seats every installed local model when uncapped (maxMembers = Infinity)', () => {
    const models = registryOf(['qwen3:8b', 'qwen2.5:7b', 'qwen2.5:3b', 'deepseek-r1:8b']);
    const roster = buildLocalCouncilRoster(models, { ...opts, maxMembers: Number.POSITIVE_INFINITY });
    expect(roster).toBeDefined();
    expect(roster!.default).toHaveLength(4);
  });

  it('a niche specialist (deepseek-r1) wins a seat over generalists even under a tight cap', () => {
    // Discovery order puts the specialist LAST; with the old slice(0, cap) it would be
    // dropped. Niche-priority sort must pull it into the seated panel.
    const models = registryOf(['qwen3:8b', 'qwen2.5:7b', 'deepseek-r1:8b']);
    const roster = buildLocalCouncilRoster(models, { ...opts, maxMembers: 2 });
    const ids = (roster?.default ?? []).map((m) => m.id);
    expect(ids).toContain('deepseek-r1:8b');
  });

  it('seats the deepseek-r1 specialist on the reasoning topic', () => {
    const models = registryOf(['qwen3:8b', 'deepseek-r1:8b']);
    const roster = buildLocalCouncilRoster(models, opts);
    const reasoning = roster?.byTopic?.reasoning ?? [];
    expect(reasoning.some((m) => m.id === 'deepseek-r1:8b')).toBe(true);
  });

  it('returns undefined when there are no local models (council stays dormant)', () => {
    const roster = buildLocalCouncilRoster(registryOf([]), opts);
    expect(roster).toBeUndefined();
  });
});
