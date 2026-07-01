import { describe, expect, it } from 'vitest';
import {
  shapeChange,
  shapeChanges,
  relativeWhen,
  summaryLabel,
  changesToText,
  type CouncilChangeEntry,
} from './SelfImprovements.logic.js';

const NOW = Date.parse('2026-07-01T12:00:00.000Z');

function entry(over: Partial<CouncilChangeEntry> = {}): CouncilChangeEntry {
  return {
    schema: 'council-change/1',
    at: '2026-07-01T11:00:00.000Z',
    kind: 'integrated',
    title: 'route business ideas to opportunity handler',
    why: 'Norway idea returned a country-fact card',
    area: 'chat routing',
    files: ['packages/core/src/chat/service.ts'],
    verification: 'tsc + test green',
    commit: 'abc1234',
    peers: { accept: true, ratio: 0.75, modernScale: 0.82, dissent: ['perf: extra call'] },
    ...over,
  };
}

describe('relativeWhen', () => {
  it('formats minutes/hours/days ago and falls back to a date past a week', () => {
    expect(relativeWhen('2026-07-01T11:59:30.000Z', NOW)).toBe('just now');
    expect(relativeWhen('2026-07-01T11:30:00.000Z', NOW)).toBe('30m ago');
    expect(relativeWhen('2026-07-01T09:00:00.000Z', NOW)).toBe('3h ago');
    expect(relativeWhen('2026-06-29T12:00:00.000Z', NOW)).toBe('2d ago');
    expect(relativeWhen('2026-06-01T12:00:00.000Z', NOW)).toBe('2026-06-01');
  });
  it('returns null for missing/invalid timestamps', () => {
    expect(relativeWhen(null, NOW)).toBeNull();
    expect(relativeWhen('not a date', NOW)).toBeNull();
  });
});

describe('shapeChange', () => {
  it('shapes a full entry with plain-language kind label (no uppercase pill)', () => {
    const s = shapeChange(entry(), NOW);
    expect(s.title).toMatch(/business ideas/);
    expect(s.kind).toBe('integrated');
    expect(s.kindLabel).toBe('integrated'); // lower-case, human — not "INTEGRATED"
    expect(s.when).toBe('1h ago');
    expect(s.files).toEqual(['packages/core/src/chat/service.ts']);
    expect(s.peers?.accepted).toBe(true);
    expect(s.peers?.acceptPct).toBe(75);
    expect(s.peers?.modernScale).toBe(0.82);
  });

  it('held maps to a readable label', () => {
    expect(shapeChange(entry({ kind: 'held' }), NOW).kindLabel).toBe('held for review');
  });

  it('an unknown kind degrades gracefully', () => {
    expect(shapeChange(entry({ kind: 'weird' }), NOW).kind).toBe('unknown');
    expect(shapeChange(entry({ kind: 'weird' }), NOW).kindLabel).toBe('changed');
  });

  it('falls back to a title when missing and drops empty fields', () => {
    const s = shapeChange(entry({ title: '  ', why: '   ', peers: null }), NOW);
    expect(s.title).toBe('Vai self-improvement');
    expect(s.why).toBeNull();
    expect(s.peers).toBeNull();
  });
});

describe('shapeChanges', () => {
  it('keeps only well-formed entries', () => {
    const list = shapeChanges([entry(), { title: 'no schema' } as CouncilChangeEntry, entry({ title: 'second' })], NOW);
    expect(list).toHaveLength(2);
    expect(list[1].title).toBe('second');
  });
  it('handles null/garbage input', () => {
    expect(shapeChanges(null)).toEqual([]);
    expect(shapeChanges(undefined)).toEqual([]);
  });
});

describe('summaryLabel', () => {
  it('covers empty / singular / plural', () => {
    expect(summaryLabel(0)).toBe('No self-improvements yet');
    expect(summaryLabel(1)).toBe('1 recent self-improvement');
    expect(summaryLabel(4)).toBe('4 recent self-improvements');
  });
});

describe('changesToText (copyable debugging digest)', () => {
  it('produces a plain-text digest with why/files/verify/peers', () => {
    const txt = changesToText(shapeChanges([entry()], NOW));
    expect(txt).toMatch(/route business ideas/);
    expect(txt).toMatch(/why: Norway idea/);
    expect(txt).toMatch(/files: packages\/core\/src\/chat\/service\.ts/);
    expect(txt).toMatch(/verify: tsc \+ test green/);
    expect(txt).toMatch(/peers: accepted 75%/);
  });
  it('has an empty-state string', () => {
    expect(changesToText([])).toBe('No self-improvements yet.');
  });
});
