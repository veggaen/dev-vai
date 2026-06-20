import { describe, expect, it } from 'vitest';
import { buildLocalLensMembers, LOCAL_COUNCIL_LENSES } from './council-lenses.js';
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
