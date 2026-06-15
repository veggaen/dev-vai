import { describe, it, expect } from 'vitest';
import {
  webEvidenceToItems,
  aiOverviewToItem,
  pageEvidenceToItems,
  notesToItems,
} from './source-adapters.js';
import {
  synthesizeAcrossSources,
  formatSummaryBrief,
  formatContradictions,
  formatDecisionRecord,
} from './synthesize-across.js';
import { synthesizeFromEvidence } from './synthesize.js';
import type { GitEvidence } from '../tools/git-evidence.js';
import type { PageEvidence } from '../tools/page-evidence.js';

function gitEvidence(): GitEvidence {
  return {
    ok: true,
    workspaceRoot: '/repo',
    changedFiles: [{ id: 'git:file:src/db.ts', path: 'src/db.ts', status: 'modified', additions: 5, deletions: 1, staged: false }],
    hunks: [],
    blame: [],
    log: [{ id: 'git:commit:abc1234', sha: 'abc1234', author: 'Alice', authoredAt: null, subject: 'switch to sqlite' }],
    branch: { id: 'git:branch:main', current: 'main', ahead: 0, behind: 0, upstream: 'origin/main' },
    gatheredAt: '2026-06-14T00:00:00Z',
    durationMs: 20,
  };
}

function pageEvidence(title: string, status = 200): PageEvidence {
  return {
    ok: true,
    url: 'https://docs.example.com/db',
    finalUrl: 'https://docs.example.com/db',
    status,
    title,
    titleId: 'page:title:https://docs.example.com/db',
    selectors: [{ id: 'page:selector:https://docs.example.com/db#h1', selector: 'h1', exists: true, text: title }],
    observedAt: '2026-06-14T00:00:00Z',
    durationMs: 300,
  };
}

describe('source adapters — bind, never fabricate', () => {
  it('webEvidenceToItems cites the url and copies the snippet verbatim', () => {
    const items = webEvidenceToItems(
      [{ title: 'SQLite docs', url: 'https://sqlite.org', snippet: 'SQLite is a C-language library.' }],
      'database',
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sourceId: 'web:https://sqlite.org', subject: 'database', attribute: 'mention', value: 'SQLite is a C-language library.' });
  });

  it('webEvidenceToItems skips empty snippets and falls back to an indexed id when no url', () => {
    const items = webEvidenceToItems([{ snippet: '' }, { snippet: 'has content' }], 'x');
    expect(items).toHaveLength(1);
    expect(items[0].sourceId).toBe('web:result-1');
  });

  it('aiOverviewToItem labels provenance and is empty for null', () => {
    expect(aiOverviewToItem(null, 'x')).toEqual([]);
    const [item] = aiOverviewToItem('Overview text', 'x');
    expect(item.span).toMatch(/AI Overview/i);
  });

  it('pageEvidenceToItems yields structured facts (title/status/selector)', () => {
    const items = pageEvidenceToItems(pageEvidence('DB Guide'));
    expect(items.find((i) => i.attribute === 'title')!.value).toBe('DB Guide');
    expect(items.find((i) => i.attribute === 'http-status')!.value).toBe('200');
    expect(items.find((i) => i.attribute === 'element:h1')).toBeTruthy();
  });

  it('notesToItems binds to note ids and drops empty notes', () => {
    const items = notesToItems([{ id: 'n1', text: 'we chose sqlite' }, { id: 'n2', text: '' }], 'database');
    expect(items).toHaveLength(1);
    expect(items[0].sourceId).toBe('note:n1');
  });
});

describe('synthesizeAcrossSources — merge + cite all families', () => {
  it('merges every source family and reports contributions', () => {
    const res = synthesizeAcrossSources({
      subject: 'database',
      git: gitEvidence(),
      web: [{ url: 'https://sqlite.org', snippet: 'SQLite is serverless.' }],
      aiOverview: 'SQLite is an embedded database.',
      page: pageEvidence('SQLite Docs'),
      notes: [{ id: 'adr-1', text: 'Decided sqlite for local-first.' }],
    });
    expect(res.contributions.git).toBeGreaterThan(0);
    expect(res.contributions.web).toBeGreaterThan(0);
    expect(res.contributions.page).toBeGreaterThan(0);
    expect(res.contributions.notes).toBeGreaterThan(0);
    // Every claim is source-bound.
    expect(res.claims.every((c) => c.sources.length >= 1)).toBe(true);
    expect(res.droppedUnbound).toBe(0);
    expect(res.sourceCount).toBeGreaterThanOrEqual(4);
  });

  it('produces an honest empty result when no sources are given', () => {
    const res = synthesizeAcrossSources({ subject: 'nothing' });
    expect(res.claims).toHaveLength(0);
    expect(formatSummaryBrief(res)).toMatch(/no evidence-bound claims/i);
  });
});

describe('cross-source contradiction detection', () => {
  it('flags two structured sources that disagree on the same subject/attribute', () => {
    // Two page observations of the SAME url subject with DIFFERENT titles. Build the merged
    // item set the way synthesizeAcrossSources does, then synthesize over it directly.
    const a = pageEvidenceToItems(pageEvidence('Postgres Guide'));
    const b = pageEvidenceToItems(pageEvidence('SQLite Guide')); // same finalUrl → same subject
    const merged = [...a, ...b];
    const res = synthesizeFromEvidence(merged, 'docs', { filterByQuery: false });
    const titleConflict = res.contradictions.find((c) => c.attribute === 'title');
    expect(titleConflict).toBeTruthy();
    expect(titleConflict!.sides.map((s) => s.value).sort()).toEqual(['Postgres Guide', 'SQLite Guide']);
    // Both sides are cited.
    expect(titleConflict!.sides.every((s) => s.sources.length >= 1)).toBe(true);
  });

  it('does not flag a contradiction when sources agree', () => {
    const a = pageEvidenceToItems(pageEvidence('Same Title'));
    const b = pageEvidenceToItems(pageEvidence('Same Title'));
    const res = synthesizeFromEvidence([...a, ...b], 'docs', { filterByQuery: false });
    expect(res.contradictions.find((c) => c.attribute === 'title')).toBeUndefined();
  });
});

describe('formatters — summary / contradictions / decision record', () => {
  const res = synthesizeAcrossSources({
    subject: 'database',
    git: gitEvidence(),
    web: [{ url: 'https://sqlite.org', snippet: 'SQLite is serverless and embedded.' }],
    notes: [{ id: 'adr-1', text: 'We chose sqlite for local-first storage.' }],
  });

  it('summary brief cites every claim and names the subject', () => {
    const brief = formatSummaryBrief(res);
    expect(brief).toContain('What I know about "database"');
    expect(brief).toContain('sqlite.org');
    expect(brief).toContain('note adr-1');
  });

  it('contradictions view reports none when sources agree', () => {
    expect(formatContradictions(res)).toMatch(/no contradictions/i);
  });

  it('decision record has ADR shape with PENDING decision and cited evidence', () => {
    const adr = formatDecisionRecord(res, 'Storage engine choice');
    expect(adr).toContain('# Storage engine choice');
    expect(adr).toContain('## Context');
    expect(adr).toContain('## Evidence');
    expect(adr).toContain('## Decision');
    expect(adr).toContain('**PENDING**');
    // Evidence lines carry citations.
    expect(adr).toMatch(/_\(.*\)_/);
  });

  it('decision record never invents a decision', () => {
    const adr = formatDecisionRecord(res);
    expect(adr).not.toMatch(/we (?:will|should|recommend|decided)/i);
    expect(adr).toContain('PENDING');
  });
});
