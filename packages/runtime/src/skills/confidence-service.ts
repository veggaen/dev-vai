import { randomUUID } from 'node:crypto';
import { skillRecordSchema, type SkillRecord } from '@vai/contracts/adoption';
import { JsonStore } from '../persistence/json-store.js';

export class SkillConfidenceService {
  private records: SkillRecord[];
  constructor(private readonly store: JsonStore<SkillRecord[]>, private readonly now = () => Date.now()) {
    this.records = store.read().flatMap((value) => {
      const parsed = skillRecordSchema.safeParse(value); return parsed.success ? [parsed.data] : [];
    });
  }
  list(): SkillRecord[] { return [...this.records]; }
  create(input: Pick<SkillRecord, 'name' | 'content' | 'author' | 'capabilityCeiling'>): SkillRecord {
    const now = this.now();
    const record = skillRecordSchema.parse({
      ...input, id: randomUUID(), confidence: input.author === 'system' ? 1 : input.author === 'user' ? 0.8 : 0.35,
      successes: 0, failures: 0, flagged: input.author === 'agent', createdAt: now, updatedAt: now,
    });
    this.records.push(record); this.persist(); return record;
  }
  update(id: string, patch: Partial<Pick<SkillRecord, 'name' | 'content' | 'capabilityCeiling'>>): SkillRecord {
    const record = this.require(id);
    const next = skillRecordSchema.parse({ ...record, ...patch, updatedAt: this.now() });
    this.records = this.records.map((item) => item.id === id ? next : item); this.persist(); return next;
  }
  observe(id: string, success: boolean): SkillRecord {
    const record = this.require(id);
    const successes = record.successes + (success ? 1 : 0);
    const failures = record.failures + (success ? 0 : 1);
    const observations = successes + failures;
    const confidence = Math.min(0.99, Math.max(0.05, (successes + 1) / (observations + 2)));
    const next = skillRecordSchema.parse({
      ...record, successes, failures, confidence,
      flagged: record.author === 'agent' && (observations < 3 || confidence < 0.75),
      lastObservedAt: this.now(), updatedAt: this.now(),
    });
    this.records = this.records.map((item) => item.id === id ? next : item); this.persist(); return next;
  }
  remove(id: string): void { this.records = this.records.filter((item) => item.id !== id); this.persist(); }
  restore(records: readonly SkillRecord[], overwrite: boolean): number {
    const existing = new Set(this.records.map((record) => record.id));
    const accepted = records.map((record) => skillRecordSchema.parse(record)).filter((record) => overwrite || !existing.has(record.id));
    if (overwrite) {
      const ids = new Set(accepted.map((record) => record.id));
      this.records = this.records.filter((record) => !ids.has(record.id));
    }
    this.records.push(...accepted); this.persist(); return accepted.length;
  }
  private require(id: string): SkillRecord { const record = this.records.find((item) => item.id === id); if (!record) throw new Error(`Skill not found: ${id}`); return record; }
  private persist(): void { this.store.write(this.records); }
}
