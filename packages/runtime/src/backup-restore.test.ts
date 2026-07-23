import { describe, expect, it } from 'vitest';
import { JsonStore } from './persistence/json-store.js';
import { PersonaService } from './personas/service.js';
import { SkillConfidenceService } from './skills/confidence-service.js';
import { EnvironmentService } from './environments/service.js';

class MemoryStore<T> extends JsonStore<T> {
  constructor(private value: T) { super('unused', value); }
  override read(): T { return structuredClone(this.value); }
  override write(value: T): void { this.value = structuredClone(value); }
}

describe('structured backup restore', () => {
  it('dry-run-compatible merge services preserve conflicts unless overwrite is explicit', () => {
    const source = new PersonaService(new MemoryStore([]), () => 10);
    const record = source.create({
      name: 'Reviewer', description: 'Checks risky changes', systemPrompt: 'Review the evidence.',
      capabilityCeiling: 'read-only',
    });
    const target = new PersonaService(new MemoryStore([]), () => 20);
    expect(target.restore([record], false)).toBe(1);
    expect(target.restore([{ ...record, description: 'replacement' }], false)).toBe(0);
    expect(target.list()[0]?.description).toBe('Checks risky changes');
    expect(target.restore([{ ...record, description: 'replacement' }], true)).toBe(1);
    expect(target.list()[0]?.description).toBe('replacement');
  });

  it('restores skills and strips unusable environment credentials', () => {
    const skillSource = new SkillConfidenceService(new MemoryStore([]), () => 10);
    const skill = skillSource.create({ name: 'Audit', content: 'Check the rendered result.', author: 'agent', capabilityCeiling: 'read-only' });
    const skillTarget = new SkillConfidenceService(new MemoryStore([]), () => 20);
    expect(skillTarget.restore([skill], false)).toBe(1);
    expect(skillTarget.list()[0]).toEqual(skill);

    const environments = new EnvironmentService(new MemoryStore({ environments: [], tokens: [], sessions: [] }), () => 20);
    expect(environments.restoreEnvironments([{
      id: 'remote-1', name: 'Remote', transport: 'ssh', endpoint: 'http://127.0.0.1:3006',
      deviceLabel: 'workstation', trust: 'paired', credentialId: 'credential-that-cannot-be-restored',
      exposed: false, createdAt: 10, updatedAt: 10,
    }], false)).toBe(1);
    expect(environments.listEnvironments()[0]).toMatchObject({ id: 'remote-1', trust: 'unverified' });
    expect(environments.listEnvironments()[0]?.credentialId).toBeUndefined();
  });
});
