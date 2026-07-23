import { randomUUID } from 'node:crypto';
import {
  blindComparisonSessionSchema,
  personaSchema,
  type BlindComparisonSession,
  type Persona,
} from '@vai/contracts/adoption';
import type { ModelRegistry } from '@vai/core';
import { JsonStore } from '../persistence/json-store.js';

export interface PersonaInput {
  readonly name: string; readonly description: string; readonly systemPrompt: string;
  readonly preferredModelId?: string; readonly capabilityCeiling: Persona['capabilityCeiling'];
}

export class PersonaService {
  private personas: Persona[];
  constructor(private readonly store: JsonStore<Persona[]>, private readonly now = () => Date.now()) {
    this.personas = store.read().flatMap((value) => {
      const parsed = personaSchema.safeParse(value); return parsed.success ? [parsed.data] : [];
    });
  }
  list(): Persona[] { return [...this.personas]; }
  get(id: string): Persona | undefined { return this.personas.find((persona) => persona.id === id); }
  create(input: PersonaInput): Persona {
    const now = this.now();
    const persona = personaSchema.parse({ ...input, id: randomUUID(), owner: 'user', version: 1, createdAt: now, updatedAt: now });
    this.personas.push(persona); this.persist(); return persona;
  }
  update(id: string, input: Partial<PersonaInput>): Persona {
    const current = this.get(id); if (!current) throw new Error(`Persona not found: ${id}`);
    const next = personaSchema.parse({ ...current, ...input, version: current.version + 1, updatedAt: this.now() });
    this.personas = this.personas.map((persona) => persona.id === id ? next : persona); this.persist(); return next;
  }
  remove(id: string): void { this.personas = this.personas.filter((persona) => persona.id !== id); this.persist(); }
  restore(records: readonly Persona[], overwrite: boolean): number {
    const existing = new Set(this.personas.map((persona) => persona.id));
    const accepted = records.map((record) => personaSchema.parse(record)).filter((record) => overwrite || !existing.has(record.id));
    if (overwrite) {
      const ids = new Set(accepted.map((record) => record.id));
      this.personas = this.personas.filter((record) => !ids.has(record.id));
    }
    this.personas.push(...accepted); this.persist(); return accepted.length;
  }
  private persist(): void { this.store.write(this.personas); }
}

interface PrivateComparison {
  session: BlindComparisonSession;
  assignment: Record<string, { modelId: string; personaIds: string[] }>;
}

export class BlindCompareService {
  private readonly comparisons = new Map<string, PrivateComparison>();
  constructor(private readonly models: ModelRegistry, private readonly personas: PersonaService, private readonly now = () => Date.now()) {}

  async compare(prompt: string, modelIds: readonly string[], personaIds: readonly string[]): Promise<BlindComparisonSession> {
    const selectedPersonas = personaIds.map((id) => this.personas.get(id)).filter((value): value is Persona => Boolean(value));
    const systemPrompt = selectedPersonas.map((persona) => persona.systemPrompt).join('\n\n');
    const candidates: BlindComparisonSession['candidates'] = [];
    const assignment: PrivateComparison['assignment'] = {};
    for (const modelId of modelIds) {
      const laneId = randomUUID();
      const started = performance.now();
      const response = await this.models.get(modelId).chat({ messages: [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user' as const, content: prompt },
      ] });
      candidates.push({ laneId, text: response.message.content, durationMs: Math.round(performance.now() - started) });
      assignment[laneId] = { modelId, personaIds: [...personaIds] };
    }
    const session = blindComparisonSessionSchema.parse({ id: randomUUID(), prompt, candidates, createdAt: this.now() });
    this.comparisons.set(session.id, { session, assignment });
    return session;
  }

  vote(id: string, laneId: string): BlindComparisonSession {
    const comparison = this.comparisons.get(id); if (!comparison) throw new Error(`Comparison not found: ${id}`);
    if (!comparison.assignment[laneId]) throw new Error(`Unknown lane: ${laneId}`);
    comparison.session = blindComparisonSessionSchema.parse({
      ...comparison.session, selectedLaneId: laneId, revealed: comparison.assignment,
    });
    return comparison.session;
  }
}
