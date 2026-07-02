import { describe, it, expect } from 'vitest';
import {
  cleanModelName,
  topicPhrase,
  humanizeSuggestedAction,
  humanizeVerdict,
  humanizeMemberWaiting,
  humanizeMemberReturned,
  humanizeAdvisorState,
  humanizeMemberBody,
  humanizeLiveTail,
} from './process-humanize.js';

/**
 * Locks the "no raw debug dumps" contract: every council/advisor field renders as
 * plain, first-person narration — never "Member: … / Topic: … / Status: …" or a
 * bare enum. Each assertion below corresponds to a dump string seen in the live
 * process tree before this change.
 */
describe('process-humanize', () => {
  it('strips Local / local: prefixes from model names', () => {
    expect(cleanModelName('Local qwen3:8b')).toBe('qwen3:8b');
    expect(cleanModelName('local:deepseek-r1:8b')).toBe('deepseek-r1:8b');
    expect(cleanModelName(undefined)).toBe('a local model');
  });

  it('turns a council topic into a spoken phrase', () => {
    expect(topicPhrase('reasoning')).toMatch(/reasoning/i);
    expect(topicPhrase('code')).toMatch(/code/i);
    expect(topicPhrase('factual')).toMatch(/facts/i);
  });

  it('humanizes the suggestedAction enum (no bare kebab)', () => {
    expect(humanizeSuggestedAction('reread-intent')).toMatch(/re-read/i);
    expect(humanizeSuggestedAction('reread-intent')).not.toContain('reread-intent');
    expect(humanizeSuggestedAction('answer-directly')).toMatch(/directly/i);
    // Unknown action degrades to a readable de-kebab, never crashes.
    expect(humanizeSuggestedAction('some-new-thing')).toBe('some new thing');
  });

  it('glosses a verdict + confidence in plain words', () => {
    expect(humanizeVerdict('needs-work', 80)).toMatch(/improved.*80% sure/i);
    expect(humanizeVerdict('good', 95)).toMatch(/solid.*95% sure/i);
  });

  it('replaces the "Member/Topic/Status: waiting" dump with a sentence', () => {
    const line = humanizeMemberWaiting('Local qwen3:8b', 'reasoning');
    expect(line).toMatch(/waiting for qwen3:8b/i);
    expect(line).toMatch(/reasoning/i);
    expect(line).not.toMatch(/Member:|Topic:|Status:/);
  });

  it('replaces the "returned structured review" dump with a verdict sentence', () => {
    const line = humanizeMemberReturned('Local qwen3:8b', 'code', 'needs-work', 60, false);
    expect(line).toMatch(/qwen3:8b/);
    expect(line).toMatch(/60% sure/);
    expect(line).not.toMatch(/Member:|Status:|returned structured review/);
  });

  it('says when a member failed instead of dumping a status', () => {
    const line = humanizeMemberReturned('Local qwen2.5:7b', 'reasoning', 'bad', undefined, true);
    expect(line).toMatch(/didn't get back/i);
  });

  it('replaces the "Actor/Model/State: running" advisor dump', () => {
    expect(humanizeAdvisorState('local:qwen2.5:3b', 'background')).toMatch(/steering quietly/i);
    expect(humanizeAdvisorState('local:qwen2.5:3b', 'running')).toMatch(/thinking it through/i);
    expect(humanizeAdvisorState('local:qwen2.5:3b', 'invalid')).toMatch(/setting it aside/i);
    expect(humanizeAdvisorState('local:qwen2.5:3b', 'background')).not.toMatch(/Actor:|State:/);
  });

  it('humanizes a full member body without the field-label stack', () => {
    const body = humanizeMemberBody({
      name: 'Local qwen3:8b',
      realIntent: 'Determine if two trains meet',
      suggestedAction: 'reread-intent',
      methodLesson: 'Use relative speed',
      concerns: ['no calculator'],
    });
    expect(body).toMatch(/qwen3:8b/);
    expect(body).toMatch(/really after/i);
    expect(body).toMatch(/re-read/i);
    // No raw "Real intent:" / "Suggested action:" labels.
    expect(body).not.toMatch(/^Real intent:/m);
    expect(body).not.toMatch(/^Suggested action:/m);
  });

  describe('humanizeLiveTail — names the active work, never bare "Working"', () => {
    it('names the council member in flight', () => {
      const tail = humanizeLiveTail({ stage: 'council-vai-round-1', memberInFlight: 'Local deepseek-r1:8b', memberTopic: 'reasoning' });
      expect(tail).toMatch(/consulting deepseek-r1:8b/i);
      expect(tail).toMatch(/reasoning/i);
    });
    it('falls back to a stage phrase', () => {
      expect(humanizeLiveTail({ stage: 'council-vai' })).toMatch(/deliberating/i);
      expect(humanizeLiveTail({ stage: 'vai-draft' })).toMatch(/drafting/i);
      expect(humanizeLiveTail({ stage: 'search' })).toMatch(/searching/i);
      expect(humanizeLiveTail({ stage: 'verify' })).toMatch(/double-check/i);
    });
    it('never returns a bare "Working"', () => {
      expect(humanizeLiveTail({})).not.toBe('Working');
      expect(humanizeLiveTail(undefined)).toMatch(/thinking/i);
    });
  });
});
