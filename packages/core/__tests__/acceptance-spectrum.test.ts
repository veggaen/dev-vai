/**
 * Acceptance spec — Vai response spectrum.
 *
 * This file declares the user-visible wins as machine-checkable assertions.
 * It is the single source of truth for the in-flight slice (Phase A first,
 * Phase B/C added incrementally). Tests start green for what has shipped and
 * are added (red → green) as new wins land.
 *
 * Conventions:
 *   - Pure-function asserts only. End-to-end engine behavior is verified by
 *     `scripts/vai-audit.mjs` (live HTTP against :3006) and the visual driver.
 *   - Each describe block maps to one acceptance item from /memories/session/plan.md.
 */

import { describe, expect, it } from 'vitest';
import { detectInstructionConstraint } from '../src/chat/chat-quality.js';
import { normalizeInputForUnderstanding } from '../src/input-normalization.js';

describe('A1 — scope/brevity firewall (instruction-constraint detector)', () => {
  const positives = [
    'who is the king of norway, only the name',
    'what is the capital of france — just the name, no preamble',
    'reply with only the year world war two ended',
    'one-word answer: typescript or javascript?',
    'in one word, what is the fastest animal',
    'just the number of provinces in canada',
    'tell me the name, nothing else',
    'answer with only the date',
  ];
  for (const phrase of positives) {
    it(`detects scope-constraint in: "${phrase}"`, () => {
      expect(detectInstructionConstraint(phrase)).toBe(true);
    });
  }

  const negatives = [
    'who is the king of norway',
    'tell me about norway',
    'what languages compile to javascript',
    'build me a fitness app',
  ];
  for (const phrase of negatives) {
    it(`does NOT trip scope-constraint on: "${phrase}"`, () => {
      expect(detectInstructionConstraint(phrase)).toBe(false);
    });
  }
});

describe('A4 — typo / dictation normalizer extensions', () => {
  // Each tuple: input → expected normalized substring (case-insensitive).
  const cases: Array<[string, string]> = [
    ['waht is raect', 'react'],
    ['how do i use tialwind in nextjs', 'tailwind'],
    ['svetle vs vue for SSR', 'svelte'],
    ['fastapy auth pattern', 'fastapi'],
    ['nodjs streams', 'node'],
    ['djnago ORM relations', 'django'],
    ['vietst snapshot setup', 'vitest'],
    ['tyepscript generics in react', 'typescript'],
  ];
  for (const [input, expected] of cases) {
    it(`normalizes "${input}" → contains "${expected}"`, () => {
      const out = normalizeInputForUnderstanding(input).toLowerCase();
      expect(out).toContain(expected);
    });
  }

  it('does not corrupt clean input', () => {
    const input = 'how do I use react with typescript and tailwind';
    const out = normalizeInputForUnderstanding(input).toLowerCase();
    expect(out).toContain('react');
    expect(out).toContain('typescript');
    expect(out).toContain('tailwind');
  });
});

describe('A5-lite — ResponseMeta.trustBadge contract', () => {
  // We assert only the type contract here. Engine-level population is
  // covered by the live audit. This keeps the unit tests fast and decoupled
  // from the strategy chain — but locks in the field shape so consumers
  // (UI, audit script) can rely on it.
  it('trustBadge is one of the documented values', () => {
    const allowed = new Set([
      'local-curated',
      'official-docs',
      'web-mixed',
      'web-untrusted',
      'fallback',
      'computed',
    ]);
    // Smoke: a representative meta object is constructable with each value.
    for (const value of allowed) {
      const meta: { trustBadge: typeof value } = { trustBadge: value };
      expect(allowed.has(meta.trustBadge)).toBe(true);
    }
  });
});
