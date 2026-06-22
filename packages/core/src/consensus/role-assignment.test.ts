import { describe, expect, it } from 'vitest';
import { assignModelsToRoles } from './role-assignment.js';
import { LOCAL_COUNCIL_ROLES } from './council-lenses.js';
import type { DiscoveredOllamaModel } from '../models/ollama-discovery.js';
import type { CouncilLens } from './member.js';

function model(name: string, parameterB: number, extra: Partial<DiscoveredOllamaModel> = {}): DiscoveredOllamaModel {
  return {
    name, parameterB, sizeBytes: parameterB * 1e9,
    contextWindow: 8192, thinking: false, toolUse: false, vision: false, embedding: false,
    ...extra,
  };
}

const ROLE = (id: string, tier: CouncilLens['tier']): CouncilLens => ({ id, label: id, framing: 'x', tier });

describe('assignModelsToRoles — capability-probe (dynamic, no hardcoding)', () => {
  it('gives the strongest model to the highest Thorsen tier', () => {
    const models = [model('small:3b', 3), model('big:14b', 14), model('mid:8b', 8)];
    const roles = [ROLE('a', 'senior'), ROLE('b', 'distinguished'), ROLE('c', 'principal')];
    const out = assignModelsToRoles(models, roles);
    const by = Object.fromEntries(out.map((o) => [o.role.id, o.modelName]));
    expect(by.b).toBe('big:14b');   // distinguished → strongest
    expect(by.c).toBe('mid:8b');    // principal → next
    expect(by.a).toBe('small:3b');  // senior → lightest (also helps crash-safe budget)
  });

  it('preserves input role order in the output (stable for the UI)', () => {
    const out = assignModelsToRoles([model('m:8b', 8)], [ROLE('a', 'senior'), ROLE('b', 'principal')]);
    expect(out.map((o) => o.role.id)).toEqual(['a', 'b']);
  });

  it('degrades gracefully: more roles than models → reuse the best-fit, flagged in the reason', () => {
    const out = assignModelsToRoles([model('only:8b', 8)], [ROLE('a', 'senior'), ROLE('b', 'distinguished')]);
    expect(out.every((o) => o.modelName === 'only:8b')).toBe(true);
    expect(out.some((o) => /reused/.test(o.reason))).toBe(true); // auditable degradation
  });

  it('no chat model available → null assignment with a clear reason (never throws)', () => {
    const out = assignModelsToRoles([model('embed', 1, { embedding: true })], [ROLE('a', 'senior')]);
    expect(out[0].modelName).toBeNull();
    expect(out[0].reason).toMatch(/no local chat model/i);
  });

  it('every assignment carries an auditable reason (capability-probe transparency)', () => {
    const out = assignModelsToRoles([model('m:8b', 8, { thinking: true })], [ROLE('a', 'distinguished')]);
    expect(out[0].reason.length).toBeGreaterThan(10);
    expect(out[0].reason).toMatch(/thinking|best available|8B/i);
  });

  it('works on the REAL role set (LOCAL_COUNCIL_ROLES): distinguished gets the top model', () => {
    const models = [model('q3:8b', 8, { thinking: true }), model('q25:7b', 7), model('q25:3b', 3), model('ds:8b', 8, { thinking: true })];
    const out = assignModelsToRoles(models, LOCAL_COUNCIL_ROLES);
    const gap = out.find((o) => o.role.id === 'capability-gap'); // distinguished
    const intent = out.find((o) => o.role.id === 'intent');      // senior
    // The distinguished role should not be assigned a weaker model than the senior role.
    const rank = (n: string | null) => models.findIndex((m) => m.name === n); // 0 = strongest
    expect(rank(gap!.modelName)).toBeLessThanOrEqual(rank(intent!.modelName));
  });
});
