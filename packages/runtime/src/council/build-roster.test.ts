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

  it('seats modern code-specialist local models on the code topic', () => {
    const models = registryOf(['qwen3:8b', 'devstral:24b']);
    const roster = buildLocalCouncilRoster(models, opts);
    const code = roster?.byTopic?.code ?? [];
    expect(code.some((m) => m.id === 'devstral:24b')).toBe(true);
  });

  it('seats explicit reasoning-specialist local models on the reasoning topic', () => {
    const models = registryOf(['qwen2.5:7b', 'qwq:32b']);
    const roster = buildLocalCouncilRoster(models, opts);
    const reasoning = roster?.byTopic?.reasoning ?? [];
    expect(reasoning.some((m) => m.id === 'qwq:32b')).toBe(true);
  });

  it('returns undefined when there are no local models (council stays dormant)', () => {
    const roster = buildLocalCouncilRoster(registryOf([]), opts);
    expect(roster).toBeUndefined();
  });
});

describe('buildLocalCouncilRoster — capability-probe role assignment (flag-gated)', () => {
  const env = process.env;
  beforeEach(() => { process.env = { ...env, VAI_COUNCIL_PREWARM: '0', VAI_COUNCIL_CONTEXT_ROOT: '' }; });
  afterEach(() => { process.env = env; });

  it('default OFF: no role-tiered panel; seating is the unchanged lens/positional path', () => {
    delete process.env.VAI_COUNCIL_ROLE_ASSIGN;
    const roster = buildLocalCouncilRoster(registryOf(['qwen3:8b', 'qwen2.5:7b']), { localLensCount: 1 });
    expect((roster?.default ?? []).some((m) => /· (senior|staff|principal|distinguished)$/.test(m.displayName))).toBe(false);
  });

  it('ON with ≥2 models: seats the Thorsen role ladder, strongest model on the top tier', () => {
    process.env.VAI_COUNCIL_ROLE_ASSIGN = '1';
    const roster = buildLocalCouncilRoster(
      registryOf(['qwen2.5:3b', 'qwen3:8b', 'qwen2.5:7b']),
      { localLensCount: 1, maxMembers: Number.POSITIVE_INFINITY },
    );
    const members = roster?.default ?? [];
    expect(members.length).toBeGreaterThanOrEqual(4); // 4 roles
    expect(members.every((m) => /· (senior|staff|principal|distinguished)$/.test(m.displayName))).toBe(true);
    // The probe's strongest→highest-tier policy, live: distinguished runs 8b, senior a lighter model.
    const distinguished = members.find((m) => / · distinguished$/.test(m.displayName));
    const senior = members.find((m) => / · senior$/.test(m.displayName));
    expect(distinguished?.displayName).toMatch(/8b/i);
    expect(senior?.displayName).not.toMatch(/^qwen3:8b/i);
  });

  it('ON but only ONE model: falls back to the unchanged path (role-assign needs ≥2)', () => {
    process.env.VAI_COUNCIL_ROLE_ASSIGN = '1';
    const roster = buildLocalCouncilRoster(registryOf(['qwen3:8b']), { localLensCount: 1 });
    expect((roster?.default ?? []).some((m) => /· (senior|staff|principal|distinguished)$/.test(m.displayName))).toBe(false);
  });
});
