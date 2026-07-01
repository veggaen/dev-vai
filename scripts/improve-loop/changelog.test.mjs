import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderChangelogEntry,
  appendChangelogEntry,
  parseChangelog,
  readChangelogEntries,
  CHANGELOG_HEADER,
} from './changelog.mjs';

// In-memory fs fake so the tests never touch the real docs/ file.
function memFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    exists: (p) => files.has(p),
    read: (p) => files.get(p),
    write: (p, c) => files.set(p, c),
    ensureDir: () => {},
  };
}

// ── render ──────────────────────────────────────────────────────────────────────
test('renderChangelogEntry: includes what/why/files/verification + a machine block', () => {
  const md = renderChangelogEntry({
    kind: 'integrated',
    title: 'route business-idea asks to opportunity handler',
    why: 'Norway idea returned a country-fact card',
    files: ['packages/core/src/chat/service.ts'],
    verification: 'tsc + colocated test green',
    commit: 'abc1234',
    at: '2026-07-01T12:00:00.000Z',
  });
  assert.match(md, /route business-idea asks/);
  assert.match(md, /Norway idea returned/);
  assert.match(md, /service\.ts/);
  assert.match(md, /tsc \+ colocated test green/);
  assert.match(md, /```council-change/);
  // The machine block must be valid JSON with the stable schema id.
  const parsed = parseChangelog(md);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].schema, 'council-change/1');
  assert.equal(parsed[0].commit, 'abc1234');
});

test('renderChangelogEntry: peer verdict is summarised when present', () => {
  const md = renderChangelogEntry({
    kind: 'integrated',
    title: 'add streaming barge-in',
    peers: { accept: true, ratio: 0.75, modernScale: 0.82, dissent: ['perf: extra call'] },
    at: '2026-07-01T00:00:00.000Z',
  });
  assert.match(md, /accepted — 75% accept, modern\/scale 0\.82/);
  assert.match(md, /dissent: perf: extra call/);
});

test('renderChangelogEntry: collapses multiline title/why to one line', () => {
  const md = renderChangelogEntry({ title: 'line one\nline two', why: 'a\n\nb', at: '2026-07-01T00:00:00.000Z' });
  assert.match(md, /line one line two/);
  assert.doesNotMatch(md.split('```council-change')[0], /line one\nline two/);
});

// ── append (prepend under anchor), newest first ──────────────────────────────────
test('appendChangelogEntry: creates the file with header + discovery marker on first write', () => {
  const fs = memFs();
  const r = appendChangelogEntry({ title: 'first change', at: '2026-07-01T00:00:00.000Z' }, { fs });
  assert.ok(r.ok);
  const doc = fs.files.get('docs/COUNCIL-CHANGELOG.md');
  assert.match(doc, /AGENT-DISCOVERY: council-self-improvement-changelog/);
  assert.match(doc, /## Entries/);
  assert.match(doc, /first change/);
});

test('appendChangelogEntry: newest entry lands ABOVE older ones', () => {
  const fs = memFs();
  appendChangelogEntry({ title: 'older', at: '2026-07-01T00:00:00.000Z' }, { fs });
  appendChangelogEntry({ title: 'newer', at: '2026-07-01T01:00:00.000Z' }, { fs });
  const doc = fs.files.get('docs/COUNCIL-CHANGELOG.md');
  assert.ok(doc.indexOf('newer') < doc.indexOf('older'), 'newer appears before older');
  // Header/preamble stays at the very top, above both entries.
  assert.ok(doc.indexOf('AGENT-DISCOVERY') < doc.indexOf('newer'));
});

test('appendChangelogEntry: an entry appended to a hand-seeded header still parses', () => {
  const fs = memFs({ 'docs/COUNCIL-CHANGELOG.md': CHANGELOG_HEADER });
  appendChangelogEntry({ title: 'seeded', at: '2026-07-01T00:00:00.000Z' }, { fs });
  const entries = readChangelogEntries({ fs });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'seeded');
});

// ── parse / read ─────────────────────────────────────────────────────────────────
test('parseChangelog: reads multiple entries newest-first and skips malformed blocks', () => {
  const good1 = renderChangelogEntry({ title: 'a', at: '2026-07-01T02:00:00.000Z' });
  const good2 = renderChangelogEntry({ title: 'b', at: '2026-07-01T01:00:00.000Z' });
  const bad = '```council-change\n{ not json ]\n```\n';
  const entries = parseChangelog(good1 + bad + good2);
  assert.equal(entries.length, 2, 'malformed block skipped');
  assert.equal(entries[0].title, 'a');
  assert.equal(entries[1].title, 'b');
});

test('parseChangelog: honours the limit', () => {
  let doc = '';
  for (let i = 0; i < 5; i++) doc += renderChangelogEntry({ title: `e${i}`, at: '2026-07-01T00:00:00.000Z' });
  assert.equal(parseChangelog(doc, { limit: 3 }).length, 3);
});

test('readChangelogEntries: returns [] when the file is absent', () => {
  assert.deepEqual(readChangelogEntries({ fs: memFs() }), []);
});

test('appendChangelogEntry: never throws — returns ok:false on a broken fs', () => {
  const brokenFs = {
    exists: () => false,
    read: () => '',
    write: () => { throw new Error('disk full'); },
    ensureDir: () => {},
  };
  const r = appendChangelogEntry({ title: 'x' }, { fs: brokenFs });
  assert.equal(r.ok, false);
  assert.match(r.error, /disk full/);
});
