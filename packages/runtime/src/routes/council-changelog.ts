import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Council changelog route — serves the self-improvement side-note (docs/COUNCIL-CHANGELOG.md) as
 * structured JSON so the desktop UI can surface "the Council improved Vai" under a collapsed menu.
 *
 * The changelog is WRITTEN by scripts/improve-loop/changelog.mjs (plain-node loop world). This is
 * the READ twin for the TS runtime: it parses the same stable fenced `council-change` JSON blocks.
 * Kept a tiny pure parser rather than importing across the .mjs/.ts build boundary — the format is
 * the shared contract (schema id `council-change/1`), not the code.
 */

export interface CouncilChangeEntry {
  readonly schema: string;
  readonly at: string | null;
  readonly kind: string | null;
  readonly title: string | null;
  readonly why: string | null;
  readonly area: string | null;
  readonly files: readonly string[];
  readonly verification: string | null;
  readonly commit: string | null;
  readonly peers: unknown;
}

const CHANGELOG_RELATIVE = 'docs/COUNCIL-CHANGELOG.md';
const BLOCK_RE = /```council-change\s*\n([\s\S]*?)\n```/g;

/** Parse the fenced council-change blocks (newest first, as written). Skips malformed blocks. */
export function parseCouncilChangelog(text: string, limit = 20): CouncilChangeEntry[] {
  const out: CouncilChangeEntry[] = [];
  let m: RegExpExecArray | null;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(text)) !== null) {
    try {
      const obj = JSON.parse(m[1]) as Partial<CouncilChangeEntry>;
      if (obj && typeof obj.schema === 'string' && obj.schema.startsWith('council-change/')) {
        out.push({
          schema: obj.schema,
          at: obj.at ?? null,
          kind: obj.kind ?? null,
          title: obj.title ?? null,
          why: obj.why ?? null,
          area: obj.area ?? null,
          files: Array.isArray(obj.files) ? obj.files : [],
          verification: obj.verification ?? null,
          commit: obj.commit ?? null,
          peers: obj.peers ?? null,
        });
      }
    } catch {
      /* skip a malformed block, don't fail the whole read */
    }
    if (out.length >= limit) break;
  }
  return out;
}

export interface CouncilChangelogDeps {
  readonly repoRoot?: string;
}

export function registerCouncilChangelogRoutes(app: FastifyInstance, deps: CouncilChangelogDeps = {}): void {
  app.get('/api/council/changelog', async (request) => {
    const target = deps.repoRoot
      ? path.join(deps.repoRoot, CHANGELOG_RELATIVE)
      : undefined;
    const limitRaw = Number((request.query as { limit?: string } | undefined)?.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
    let entries: CouncilChangeEntry[] = [];
    try {
      if (target && existsSync(target)) {
        entries = parseCouncilChangelog(readFileSync(target, 'utf8'), limit);
      }
    } catch {
      entries = [];
    }
    return { schemaVersion: 1, path: CHANGELOG_RELATIVE, count: entries.length, entries };
  });
}
