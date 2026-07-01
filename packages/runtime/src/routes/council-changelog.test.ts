import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCouncilChangelog, registerCouncilChangelogRoutes } from './council-changelog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const SAMPLE = `# Council Changelog
## Entries

### ✅ 2026-07-01 — newer change

\`\`\`council-change
{ "schema": "council-change/1", "at": "2026-07-01T02:00:00.000Z", "kind": "integrated", "title": "newer change", "why": "b", "area": null, "files": ["a.ts"], "verification": "tsc green", "commit": "deadbee", "peers": null }
\`\`\`

### 🗄 2026-07-01 — older change

\`\`\`council-change
{ "schema": "council-change/1", "at": "2026-07-01T01:00:00.000Z", "kind": "shelved", "title": "older change", "why": "a", "area": null, "files": [], "verification": null, "commit": null, "peers": null }
\`\`\`
`;

describe('parseCouncilChangelog', () => {
  it('reads entries newest-first with files + commit', () => {
    const entries = parseCouncilChangelog(SAMPLE);
    expect(entries).toHaveLength(2);
    expect(entries[0].title).toBe('newer change');
    expect(entries[0].commit).toBe('deadbee');
    expect(entries[0].files).toEqual(['a.ts']);
    expect(entries[1].kind).toBe('shelved');
  });

  it('skips malformed blocks without failing', () => {
    const withBad = SAMPLE + '\n```council-change\n{ not json ]\n```\n';
    expect(parseCouncilChangelog(withBad)).toHaveLength(2);
  });

  it('honours the limit', () => {
    expect(parseCouncilChangelog(SAMPLE, 1)).toHaveLength(1);
  });

  it('returns [] for text with no blocks', () => {
    expect(parseCouncilChangelog('nothing here')).toEqual([]);
  });
});

describe('council changelog route', () => {
  it('serves the real docs/COUNCIL-CHANGELOG.md as structured entries', async () => {
    const app = Fastify();
    registerCouncilChangelogRoutes(app, { repoRoot: REPO_ROOT });
    const res = await app.inject({ method: 'GET', url: '/api/council/changelog' });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { path?: string; count?: number; entries?: Array<{ schema?: string }> };
    expect(body.path).toBe('docs/COUNCIL-CHANGELOG.md');
    // The seed entry from this very feature must be present + well-formed.
    expect((body.count ?? 0)).toBeGreaterThanOrEqual(1);
    expect(body.entries?.[0]?.schema).toBe('council-change/1');
  });

  it('clamps an absurd limit and still returns 200', async () => {
    const app = Fastify();
    registerCouncilChangelogRoutes(app, { repoRoot: REPO_ROOT });
    const res = await app.inject({ method: 'GET', url: '/api/council/changelog?limit=99999' });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});
