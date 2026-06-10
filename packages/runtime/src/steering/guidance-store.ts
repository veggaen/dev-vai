/**
 * Drizzle-backed GuidanceStore implementation.
 *
 * This is what makes steering *writable*. Every time a human, AI peer, or
 * robot posts a RouteGuidance (or we auto-promote contributions later), we
 * persist it here. Combined with the plan + baseline blobs written on
 * assistant messages, this dataset becomes the reference for answering:
 *
 *   - Did this steer (from this actor, on this scope) actually improve
 *     outcomes on similar turns?
 *   - Are recent steers from a particular source showing negative or
 *     zero lift → time to re-calibrate (weights, match threshold, expiry,
 *     trust model, or even revoke the actor)?
 */

import { eq, and, desc } from 'drizzle-orm';
import type { VaiDatabase } from '@vai/core';
import { schema } from '@vai/core';
import type { GuidanceStore, RouteGuidance } from '@vai/core';
// QuestionIntent is a string union; we cast to avoid deep import resolution in this context.
type QuestionIntent = string;

function parseMatchTokens(raw: string | null | undefined): string[] | undefined {
  if (!raw) return undefined;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : undefined;
  } catch {
    return undefined;
  }
}

function stringifyMatchTokens(tokens?: readonly string[] | null): string | null {
  if (!tokens || tokens.length === 0) return null;
  return JSON.stringify(tokens);
}

export function createGuidanceStore(db: VaiDatabase): GuidanceStore {
  return {
    loadActive(conversationId?: string | null): readonly RouteGuidance[] {
      const nowMs = Date.now();
      const conditions = [
        eq(schema.routeGuidances.active, 1),
        // not expired or no expiry
      ];

      // Global + conversation-specific (class scope are further filtered by selectApplicableGuidance)
      let q = db
        .select()
        .from(schema.routeGuidances)
        .where(
          and(
            eq(schema.routeGuidances.active, 1),
            // expiresAt is null or > now
          ),
        )
        .orderBy(desc(schema.routeGuidances.createdAt));

      // We filter expiry + scope in JS for simplicity (small N expected per convo)
      const rows = q.all();

      return rows
        .filter((row) => {
          // row.*At come back as Date (because schema uses mode:'timestamp') or
          // number during transition / raw queries. Normalize to epoch ms.
          let exp: number | null = null;
          const rawExp = (row as any).expiresAt;
          if (rawExp instanceof Date) exp = rawExp.getTime();
          else if (typeof rawExp === 'number') exp = rawExp;
          else if (rawExp) exp = new Date(rawExp).getTime();
          if (exp && exp <= nowMs) return false;
          if (row.scope === 'global') return true;
          if (row.scope === 'conversation') {
            return !!conversationId && row.conversationId === conversationId;
          }
          // class: always load candidates; matcher decides
          return true;
        })
        .map((row): RouteGuidance => ({
          id: row.id,
          conversationId: row.conversationId ?? null,
          from: row.from as 'human' | 'ai',
          author: row.author ?? undefined,
          signal: row.signal as 'avoid' | 'prefer',
          handler: row.handler,
          note: row.note ?? undefined,
          scope: row.scope as 'class' | 'conversation' | 'global',
          matchTokens: parseMatchTokens(row.matchTokens),
          intent: (row.intent as any) ?? undefined,
          weight: row.weight ?? 1,
          active: !!row.active,
          createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
          expiresAt: row.expiresAt ? (row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt)) : null,
          appliedCount: (row as any).appliedCount ?? 0,
          lastAppliedAt: row.lastAppliedAt ? (row.lastAppliedAt instanceof Date ? row.lastAppliedAt : new Date(row.lastAppliedAt)) : null,
        }));
    },

    save(input) {
      const id = input.id ?? `rg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const now = input.createdAt ?? new Date();

      const values = {
        id,
        conversationId: input.conversationId ?? null,
        from: input.from,
        author: input.author ?? null,
        signal: input.signal,
        handler: input.handler,
        note: input.note ?? null,
        scope: input.scope,
        matchTokens: stringifyMatchTokens(input.matchTokens),
        intent: input.intent ?? null,
        weight: input.weight ?? 1.0,
        active: 1,
        // drizzle `{ mode: 'timestamp' }` columns expect Date objects (it calls
        // .getTime() internally) — passing epoch numbers throws "value.getTime
        // is not a function" and 500s the steer. Hand it Dates.
        createdAt: now,
        expiresAt: input.expiresAt ?? null,
        originMessageId: null, // can be enriched by callers if they have the turn id
        appliedCount: 0,
        lastAppliedAt: null,
      };

      db.insert(schema.routeGuidances).values(values as any).run();

      return {
        id,
        conversationId: input.conversationId ?? null,
        from: input.from,
        author: input.author,
        signal: input.signal,
        handler: input.handler,
        note: input.note,
        scope: input.scope,
        matchTokens: input.matchTokens as any,
        intent: input.intent,
        weight: input.weight ?? 1,
        active: true,
        createdAt: now,
        expiresAt: input.expiresAt ?? null,
      } as RouteGuidance;
    },

    recordApplication(id: string, appliedAt: Date = new Date()) {
      try {
        // Best-effort increment. Low volume so a read-modify is acceptable.
        const row = db
          .select({ count: schema.routeGuidances.appliedCount })
          .from(schema.routeGuidances)
          .where(eq(schema.routeGuidances.id, id))
          .get();
        const next = (row?.count ?? 0) + 1;
        db.update(schema.routeGuidances)
          .set({
            appliedCount: next,
            lastAppliedAt: appliedAt,
          } as any)
          .where(eq(schema.routeGuidances.id, id))
          .run();
      } catch {
        // best effort; reference data is nice-to-have
      }
    },
  };
}
