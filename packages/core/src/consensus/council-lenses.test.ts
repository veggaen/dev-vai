import { describe, expect, it } from 'vitest';
import { buildLocalLensMembers, LOCAL_COUNCIL_LENSES, LOCAL_COUNCIL_ROLES, isRole } from './council-lenses.js';
import { THORSEN_TIER_RANK, type ThorsenTier } from './member.js';
import type { ModelAdapter } from '../models/adapter.js';

function fakeAdapter(): ModelAdapter {
  return {
    id: 'local:qwen3',
    displayName: 'Qwen3',
    provider: 'local',
    async chat() {
      return {
        message: { role: 'assistant', content: '{"verdict":"good","confidence":0.7}' },
      } as any;
    },
  } as unknown as ModelAdapter;
}

describe('buildLocalLensMembers (multi-angle local council)', () => {
  it('seats one distinct member per lens with unique ids and labels', () => {
    const members = buildLocalLensMembers({ adapter: fakeAdapter(), topic: 'other', count: 3 });
    expect(members).toHaveLength(3);
    const ids = members.map((m) => m.id);
    expect(new Set(ids).size).toBe(3); // all unique
    expect(ids.every((id) => id.startsWith('local:qwen3-lens-'))).toBe(true);
    expect(members.every((m) => m.displayName.startsWith('Qwen3 · '))).toBe(true);
  });

  it('clamps count to the available lens set', () => {
    const tooMany = buildLocalLensMembers({ adapter: fakeAdapter(), topic: 'other', count: 99 });
    expect(tooMany).toHaveLength(LOCAL_COUNCIL_LENSES.length);
    const tooFew = buildLocalLensMembers({ adapter: fakeAdapter(), topic: 'other', count: 0 });
    expect(tooFew).toHaveLength(1);
  });

  it('keeps the first lens as the deterministic anchor (temperature 0)', () => {
    expect(LOCAL_COUNCIL_LENSES[0].temperature).toBe(0);
    expect(LOCAL_COUNCIL_LENSES.slice(1).some((l) => (l.temperature ?? 0) > 0)).toBe(true);
  });
});

describe('Thorsen-inspired role definitions (Milestone 1)', () => {
  it('every lens is now a full role: tier + mandate + weight', () => {
    expect(LOCAL_COUNCIL_ROLES).toBe(LOCAL_COUNCIL_LENSES); // role-facing alias of the same set
    for (const r of LOCAL_COUNCIL_ROLES) {
      expect(isRole(r)).toBe(true);
      expect(r.tier).toBeTruthy();
      expect(r.mandate && r.mandate.length).toBeGreaterThan(10);
      expect(typeof r.weight).toBe('number');
      expect(r.weight).toBeGreaterThan(0);
      expect(r.weight).toBeLessThanOrEqual(2); // sane multiplier, never runaway
    }
  });

  it('covers the full Thorsen seniority ladder (senior → distinguished)', () => {
    const tiers = new Set(LOCAL_COUNCIL_ROLES.map((r) => r.tier as ThorsenTier));
    expect(tiers).toEqual(new Set<ThorsenTier>(['senior', 'staff', 'principal', 'distinguished']));
    // The self-improvement role sits at the top altitude (drives Vai's evolution).
    const gap = LOCAL_COUNCIL_ROLES.find((r) => r.id === 'capability-gap');
    expect(gap?.tier).toBe('distinguished');
    expect(THORSEN_TIER_RANK[gap!.tier as ThorsenTier]).toBe(4);
  });

  it('THORSEN_TIER_RANK is a strict low→high ordering', () => {
    expect(THORSEN_TIER_RANK.senior).toBeLessThan(THORSEN_TIER_RANK.staff);
    expect(THORSEN_TIER_RANK.staff).toBeLessThan(THORSEN_TIER_RANK.principal);
    expect(THORSEN_TIER_RANK.principal).toBeLessThan(THORSEN_TIER_RANK.distinguished);
  });

  it('surfaces the tier in member displayName so the panel reads as a seniority ladder', () => {
    const members = buildLocalLensMembers({ adapter: fakeAdapter(), topic: 'other', count: 4 });
    // e.g. "Qwen3 · Skeptic · staff"
    expect(members.every((m) => /· (senior|staff|principal|distinguished)$/.test(m.displayName))).toBe(true);
  });
});
