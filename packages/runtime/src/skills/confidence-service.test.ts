import { describe, expect, it } from 'vitest';
import { JsonStore } from '../persistence/json-store.js';
import { SkillConfidenceService } from './confidence-service.js';

class MemoryStore<T> extends JsonStore<T> {
  constructor(private value: T) { super('unused', value); }
  override read(): T { return structuredClone(this.value); }
  override write(value: T): void { this.value = structuredClone(value); }
}

describe('SkillConfidenceService', () => {
  it('flags a new agent skill and only clears the flag after observed success', () => {
    const service = new SkillConfidenceService(new MemoryStore([]), () => 100);
    let skill = service.create({ name: 'web-research', content: 'Search carefully.', author: 'agent', capabilityCeiling: 'read-only' });
    expect(skill.flagged).toBe(true);
    expect(skill.confidence).toBeLessThan(0.5);
    skill = service.observe(skill.id, true);
    skill = service.observe(skill.id, true);
    expect(skill.flagged).toBe(true);
    skill = service.observe(skill.id, true);
    expect(skill.confidence).toBeGreaterThanOrEqual(0.75);
    expect(skill.flagged).toBe(false);
  });
});
