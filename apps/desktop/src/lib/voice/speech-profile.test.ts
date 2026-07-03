import { describe, expect, it } from 'vitest';
import {
  applyProfile,
  emptyProfile,
  learnFromEdit,
  prettifyTranscript,
  activeRules,
  PROMOTE_AT,
  RETIRE_AT,
  type SpeechProfile,
} from './speech-profile.js';

const profileWith = (rules: Array<Partial<SpeechProfile['rules'][number]> & { heard: string; corrected: string }>): SpeechProfile => ({
  version: 1,
  rules: rules.map((r) => ({ count: PROMOTE_AT, strikes: 0, lastSeen: '2026-01-01T00:00:00Z', ...r })),
});

describe('prettifyTranscript', () => {
  it('capitalizes, punctuates and cleans fillers/doubles', () => {
    expect(prettifyTranscript('um so the the plan is ready')).toBe('So the plan is ready.');
  });

  it('question shapes get a question mark', () => {
    expect(prettifyTranscript('how do i run the tests')).toBe('How do I run the tests?');
  });

  it('keeps existing terminal punctuation and casing after sentences', () => {
    expect(prettifyTranscript('it works. really well!')).toBe('It works. Really well!');
  });

  it('never punctuates fragments under three words', () => {
    expect(prettifyTranscript('hello there')).toBe('Hello there');
  });

  it('fixes space-before-punctuation artifacts from STT', () => {
    expect(prettifyTranscript('wait , what is this ?')).toBe('Wait, what is this?');
  });

  it('uppercases standalone i', () => {
    expect(prettifyTranscript('yesterday i shipped it and i tested it')).toBe('Yesterday I shipped it and I tested it.');
  });
});

describe('applyProfile', () => {
  it('applies promoted rules whole-word, case-preserving', () => {
    const p = profileWith([{ heard: 'vay', corrected: 'vai' }]);
    const r = applyProfile('Vay is ready and vay works', p);
    expect(r.text).toBe('Vai is ready and vai works');
    expect(r.applied).toEqual([{ heard: 'vay', corrected: 'vai' }]);
  });

  it('ignores unpromoted rules', () => {
    const p = profileWith([{ heard: 'vay', corrected: 'vai', count: PROMOTE_AT - 1 }]);
    const r = applyProfile('vay is ready', p);
    expect(r.text).toBe('vay is ready');
    expect(r.applied).toHaveLength(0);
  });

  it('ignores struck-out (healed) rules', () => {
    const p = profileWith([{ heard: 'vay', corrected: 'vai', strikes: RETIRE_AT }]);
    expect(applyProfile('vay is ready', p).text).toBe('vay is ready');
  });

  it('never replaces inside larger words', () => {
    const p = profileWith([{ heard: 'vay', corrected: 'vai' }]);
    expect(applyProfile('voyage stays', p).text).toBe('voyage stays');
  });
});

describe('learnFromEdit', () => {
  it('records a new mishearing and promotes it after enough sightings', () => {
    let p = emptyProfile();
    p = learnFromEdit(p, { insertedText: 'deploy the vay engine', sentText: 'deploy the vai engine' });
    expect(activeRules(p)).toHaveLength(0); // seen once — not promoted yet
    p = learnFromEdit(p, { insertedText: 'restart vay now', sentText: 'restart vai now' });
    expect(activeRules(p)).toEqual([expect.objectContaining({ heard: 'vay', corrected: 'vai', count: 2 })]);
  });

  it('self-heals: reverting an auto-applied rule earns a strike and retires it', () => {
    let p = profileWith([{ heard: 'vay', corrected: 'vai' }]);
    const applied = [{ heard: 'vay', corrected: 'vai' }];
    // The user edited the auto-corrected "vai" BACK to "vay" — twice.
    p = learnFromEdit(p, { insertedText: 'the vai project', sentText: 'the vay project', applied });
    expect(activeRules(p)).toHaveLength(1); // one strike — still active
    p = learnFromEdit(p, { insertedText: 'open vai again', sentText: 'open vay again', applied });
    expect(activeRules(p)).toHaveLength(0); // retired — the algo healed itself
  });

  it('does not learn from pure insertions or deletions', () => {
    const p = learnFromEdit(emptyProfile(), {
      insertedText: 'ship the build',
      sentText: 'please ship the build now',
    });
    expect(p.rules).toHaveLength(0);
  });

  it('caps the profile at 200 rules keeping the freshest', () => {
    const base: SpeechProfile = {
      version: 1,
      rules: Array.from({ length: 205 }, (_, i) => ({
        heard: `word${i}`, corrected: `fixed${i}`, count: 3, strikes: 0,
        lastSeen: new Date(2026, 0, 1, 0, i).toISOString(),
      })),
    };
    const p = learnFromEdit(base, { insertedText: 'foo bar baz', sentText: 'foo qux baz' });
    expect(p.rules.length).toBeLessThanOrEqual(200);
  });
});
