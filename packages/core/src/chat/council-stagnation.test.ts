import { describe, expect, it } from 'vitest';
import {
  signature,
  similarity,
  isStagnant,
  escalationForStuck,
  promptNeedsExternalFacts,
  STAGNATION_THRESHOLD,
} from './council-stagnation.js';

describe('signature + similarity', () => {
  it('treats trivially-reworded drafts as the same attempt', () => {
    const a = signature('There are 2 Pizzabakeren shops in Hommersåk.');
    const b = signature('there are 2 pizzabakeren shops in hommersåk!!!');
    expect(similarity(a, b)).toBeGreaterThanOrEqual(STAGNATION_THRESHOLD);
  });

  it('treats genuinely different answers as different', () => {
    const a = signature('There are 2 Pizzabakeren shops in Hommersåk.');
    const b = signature('Hommersåk is a village on the Ryfylke coast of Norway.');
    expect(similarity(a, b)).toBeLessThan(STAGNATION_THRESHOLD);
  });

  it('treats an identical scaffold (same prose + same code) as a repeat', () => {
    const scaffold = 'Here is the plan:\n```ts\nroutes/ services/ repository/\n```\nDo the refactor.';
    expect(similarity(signature(scaffold), signature(`${scaffold} `))).toBeGreaterThanOrEqual(STAGNATION_THRESHOLD);
  });

  it('counts genuinely different code as novelty (does not wrongly flag a real code redraft)', () => {
    // Safer to under-flag stagnation than to block a legitimate redraft whose new material is code.
    const a = signature('Here is the plan:\n```\nold approach\n```');
    const b = signature('Here is the plan:\n```\na completely different real implementation with new modules\n```');
    expect(similarity(a, b)).toBeLessThan(STAGNATION_THRESHOLD);
  });
});

describe('isStagnant', () => {
  it('is false on the first attempt', () => {
    expect(isStagnant('any draft', [])).toBe(false);
  });

  it('catches a repeat of the immediately prior round', () => {
    expect(isStagnant('There are 2 shops.', ['There are 2 shops!'])).toBe(true);
  });

  it('catches an A→B→A oscillation against ALL prior rounds', () => {
    const priors = ['Answer A about the count', 'Answer B a totally unrelated tangent here'];
    expect(isStagnant('answer a about the count', priors)).toBe(true);
  });

  it('passes a genuinely improved redraft', () => {
    const priors = ['I cannot answer that.'];
    expect(isStagnant('There are 3 Pizzabakeren locations, per Proff.no.', priors)).toBe(false);
  });

  it('does NOT flag a multi-intent redraft that keeps the first part and appends a new deliverable', () => {
    // Real case from the council loop: round 1 answered only the JWT question; the redraft keeps
    // that (correct) prose and ADDS the requested app. High overlap, but lots of new content →
    // progress, not a repeat.
    const jwtOnly = 'A JWT is a compact token with header, payload, and signature used for auth.';
    const jwtPlusApp = `${jwtOnly}\n\nHere is the portfolio app:\npackage.json, src/App.tsx with a nature gallery and a logged-in social page component.`;
    expect(isStagnant(jwtPlusApp, [jwtOnly])).toBe(false);
  });
});

describe('escalationForStuck (the break-the-loop ladder)', () => {
  it('forces a search when facts are needed and none gathered', () => {
    expect(escalationForStuck({ hasEvidence: false, needsExternalFacts: true, isAmbiguous: false, searchAlreadyTried: false }).kind)
      .toBe('force-search');
  });

  it('forces a grounded rewrite when evidence exists but was ignored', () => {
    expect(escalationForStuck({ hasEvidence: true, needsExternalFacts: true, isAmbiguous: false, searchAlreadyTried: true }).kind)
      .toBe('force-grounded-rewrite');
  });

  it('asks one question when ambiguous and search was already tried', () => {
    expect(escalationForStuck({ hasEvidence: false, needsExternalFacts: false, isAmbiguous: true, searchAlreadyTried: true }).kind)
      .toBe('ask-clarifying');
  });

  it('accepts best-so-far when nothing else can be tried', () => {
    expect(escalationForStuck({ hasEvidence: false, needsExternalFacts: false, isAmbiguous: false, searchAlreadyTried: true }).kind)
      .toBe('accept-best');
  });
});

describe('promptNeedsExternalFacts', () => {
  it('flags count / contact / place asks', () => {
    expect(promptNeedsExternalFacts('number of pb hommersåk')).toBe(true);
    expect(promptNeedsExternalFacts('phone to pizzabakeren')).toBe(true);
    expect(promptNeedsExternalFacts('address of a hotel in oslo')).toBe(true);
  });

  it('does not flag pure code/opinion asks', () => {
    expect(promptNeedsExternalFacts('refactor this function to be cleaner')).toBe(false);
    expect(promptNeedsExternalFacts('explain closures in javascript')).toBe(false);
  });
});
