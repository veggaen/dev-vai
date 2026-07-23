import { randomUUID } from 'node:crypto';
import { and, desc, eq, type VaiDatabase, schema, wrapUntrustedContent, UNTRUSTED_CONTENT_POLICY } from '@vai/core';
import { governedMemorySchema, type GovernedMemory } from '@vai/contracts/adoption';

/**
 * Vai Memory service — extract, store, and govern durable memories mined from
 * conversations. This is the re-architected "knowledge graph" backend: typed,
 * inspectable, deletable memory cards with provenance, NOT untyped word-overlap.
 *
 * Extraction is explicit (called per conversation) so quality can be tuned before
 * it's wired to run automatically. Retrieval stays selective by design.
 */

export type MemoryKind = 'decision' | 'project' | 'preference' | 'fact';
const KINDS: readonly MemoryKind[] = ['decision', 'project', 'preference', 'fact'];

export interface MemoryRow {
  id: string;
  userId: string;
  conversationId: string | null;
  kind: MemoryKind;
  content: string;
  sourceExcerpt: string | null;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

interface ExtractedMemory {
  kind: MemoryKind;
  content: string;
  sourceExcerpt?: string;
}

function localModelBaseUrl(): string {
  return (process.env.LOCAL_MODEL_URL?.trim() || 'http://localhost:11434').replace(/\/$/, '');
}

function extractionModel(): string {
  return process.env.VAI_MEMORY_MODEL?.trim()
    || process.env.LOCAL_MODEL?.trim()
    || 'qwen2.5:3b';
}

function buildExtractionPrompt(transcript: string): string {
  return [
    'You extract DURABLE memories from a chat transcript — things worth remembering for future sessions.',
    'Return ONLY a JSON array (no prose) of at most 5 objects: {"kind","content","sourceExcerpt"}.',
    'kind is one of: decision, project, preference, fact.',
    '- decision: a choice the user made ("use Postgres in prod").',
    '- project: something they are building ("a photographer portfolio site").',
    '- preference: a stable taste/habit ("prefers concise answers").',
    '- fact: a durable personal fact ("their name is Vetle").',
    'Rules: skip pleasantries, one-off questions, and anything transient. content is one concise sentence.',
    'sourceExcerpt is a short verbatim quote from the transcript that supports it.',
    'If nothing is worth remembering, return [].',
    UNTRUSTED_CONTENT_POLICY,
    '',
    'Transcript:',
    wrapUntrustedContent(
      'memory',
      transcript.length > 6000 ? transcript.slice(0, 3000) + '\n...\n' + transcript.slice(-3000) : transcript,
      { source: 'conversation transcript' },
    ),
  ].join('\n');
}

/** Best-effort parse of the model's JSON array, tolerant of code fences / stray prose. */
function parseExtracted(raw: string): ExtractedMemory[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: ExtractedMemory[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const kind = rec.kind;
    const content = typeof rec.content === 'string' ? rec.content.trim() : '';
    if (!content || !KINDS.includes(kind as MemoryKind)) continue;
    out.push({
      kind: kind as MemoryKind,
      content: content.slice(0, 400),
      sourceExcerpt: typeof rec.sourceExcerpt === 'string' ? rec.sourceExcerpt.trim().slice(0, 400) : undefined,
    });
    if (out.length >= 5) break;
  }
  return out;
}

export class MemoryService {
  constructor(private readonly db: VaiDatabase) {}

  list(userId: string, includeArchived = false): MemoryRow[] {
    const where = includeArchived
      ? eq(schema.memories.userId, userId)
      : and(eq(schema.memories.userId, userId), eq(schema.memories.status, 'active'));
    return this.db
      .select()
      .from(schema.memories)
      .where(where)
      .orderBy(desc(schema.memories.updatedAt))
      .all() as MemoryRow[];
  }

  add(userId: string, kind: MemoryKind, content: string, sourceExcerpt?: string, conversationId?: string): MemoryRow {
    const now = new Date();
    const row = {
      id: randomUUID(),
      userId,
      conversationId: conversationId ?? null,
      kind,
      content: content.trim().slice(0, 400),
      sourceExcerpt: sourceExcerpt?.trim().slice(0, 400) ?? null,
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(schema.memories).values(row).run();
    return row;
  }

  setStatus(userId: string, id: string, status: 'active' | 'archived'): void {
    this.db.update(schema.memories)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(schema.memories.id, id), eq(schema.memories.userId, userId)))
      .run();
  }

  update(userId: string, id: string, patch: { kind?: MemoryKind; content?: string; sourceExcerpt?: string | null }): MemoryRow | null {
    const current = this.list(userId, true).find((memory) => memory.id === id);
    if (!current) return null;
    this.db.update(schema.memories)
      .set({
        ...(patch.kind ? { kind: patch.kind } : {}),
        ...(patch.content !== undefined ? { content: patch.content.trim().slice(0, 400) } : {}),
        ...(patch.sourceExcerpt !== undefined ? { sourceExcerpt: patch.sourceExcerpt?.trim().slice(0, 400) ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.memories.id, id), eq(schema.memories.userId, userId)))
      .run();
    return this.list(userId, true).find((memory) => memory.id === id) ?? null;
  }

  remove(userId: string, id: string): void {
    this.db.delete(schema.memories)
      .where(and(eq(schema.memories.id, id), eq(schema.memories.userId, userId)))
      .run();
  }

  restore(userId: string, records: readonly GovernedMemory[], overwrite: boolean): number {
    const existing = new Set(this.list(userId, true).map((record) => record.id));
    let applied = 0;
    for (const input of records) {
      const record = governedMemorySchema.parse({ ...input, userId });
      if (existing.has(record.id)) {
        if (!overwrite) continue;
        this.remove(userId, record.id);
      }
      this.db.insert(schema.memories).values({
        ...record,
        userId,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      }).run();
      applied += 1;
    }
    return applied;
  }

  /**
   * Mine a conversation transcript for durable memories via the local model and
   * store them. Deduped against existing content (case-insensitive) so repeated
   * extraction of the same chat doesn't pile up. Returns the newly-added rows.
   */
  async extractFromText(userId: string, conversationId: string | null, transcript: string, signal?: AbortSignal): Promise<MemoryRow[]> {
    const text = transcript.trim();
    if (text.length < 40) return [];

    const response = await fetch(`${localModelBaseUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: extractionModel(),
        stream: false,
        think: false,
        keep_alive: process.env.VAI_LOCAL_KEEP_ALIVE?.trim() || '30m',
        options: { temperature: 0 },
        prompt: buildExtractionPrompt(text),
      }),
    });
    if (!response.ok) throw new Error(`memory_extract_${response.status}`);
    const body = await response.json() as { response?: string };
    const candidates = parseExtracted(String(body.response ?? ''));
    if (candidates.length === 0) return [];

    const existing = new Set(this.list(userId, true).map((m) => m.content.toLowerCase()));
    const added: MemoryRow[] = [];
    for (const c of candidates) {
      if (existing.has(c.content.toLowerCase())) continue;
      existing.add(c.content.toLowerCase());
      added.push(this.add(userId, c.kind, c.content, c.sourceExcerpt, conversationId ?? undefined));
    }
    return added;
  }
}
