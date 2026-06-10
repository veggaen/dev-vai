import { describe, expect, it } from 'vitest';
import { tryEmitDecisionTake } from './decision-take.js';

describe('tryEmitDecisionTake — DIY vs established tool', () => {
  it('gives a grounded build-vs-use take and names both subjects', () => {
    const r = tryEmitDecisionTake('honestly, is it dumb to write my own ORM instead of just using Prisma? give me your real take.');
    expect(r?.kind).toBe('diy-vs-tool');
    expect(r?.reply).toMatch(/orm/i);
    expect(r?.reply).toMatch(/prisma/i);
    expect(r?.reply).toMatch(/production|maintenance|edge cases/i);
    expect(r?.reply).toMatch(/learn|narrow/i); // includes the "roll your own when" case
  });

  it('works without a named alternative', () => {
    const r = tryEmitDecisionTake('is it worth building my own auth system?');
    expect(r?.kind).toBe('diy-vs-tool');
    expect(r?.reply).toMatch(/auth system/i);
    expect(r?.reply).toMatch(/established/i);
  });

  it('generalizes to any subject, not a hardcoded list', () => {
    const r = tryEmitDecisionTake('is it a bad idea to roll my own state manager instead of Redux?');
    expect(r?.kind).toBe('diy-vs-tool');
    expect(r?.reply).toMatch(/state manager/i);
    expect(r?.reply).toMatch(/redux/i);
  });
});

describe('tryEmitDecisionTake — adopt or not', () => {
  it('gives a grounded adoption take', () => {
    const r = tryEmitDecisionTake('is it worth adding Redis to my stack right now?');
    expect(r?.kind).toBe('adopt-or-not');
    expect(r?.reply).toMatch(/redis/i);
    expect(r?.reply).toMatch(/pain|complexity|scale/i);
  });
});

describe('tryEmitDecisionTake — declines non-decision prompts (no slop)', () => {
  it('does not fire on a plain build request', () => {
    expect(tryEmitDecisionTake('write my own ORM in typescript')).toBeNull();
    expect(tryEmitDecisionTake('build me a todo app')).toBeNull();
  });

  it('does not fire on a factual or comparison question', () => {
    expect(tryEmitDecisionTake('what is an ORM?')).toBeNull();
    expect(tryEmitDecisionTake('difference between Prisma and TypeORM')).toBeNull();
  });
});
