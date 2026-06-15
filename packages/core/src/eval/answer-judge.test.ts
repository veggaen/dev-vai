import { describe, it, expect } from 'vitest';
import { judgeAnswers, type JudgeCandidate } from './answer-judge.js';

const ctx = { prompt: 'what changed in my repo and which files are staged?' };

describe('answer-judge — groundedness leads, not fluency', () => {
  it('a grounded TERSE answer BEATS a fluent UNGROUNDED one', () => {
    const vai: JudgeCandidate = {
      id: 'A',
      text: '**Git evidence:** `src/foo.ts` modified (+12/-3), `src/added.ts` added (staged).',
      boundEvidence: ['git:file:src/foo.ts', 'git:file:src/added.ts'],
      verified: true,
    };
    const model: JudgeCandidate = {
      id: 'B',
      text: 'Great question! Looking at your repository, it seems like there may have been several changes recently. Typically when you modify files, git tracks them, and staging is an important concept in version control. You might have some files changed and some staged, depending on your workflow. In conclusion, it is worth noting that you should check git status.',
      boundEvidence: [],
      verified: false,
    };
    const verdict = judgeAnswers([vai, model], ctx);
    expect(verdict.winnerId).toBe('A');
    expect(verdict.atPar).toBe(false);
    expect(verdict.rationale).toMatch(/groundedness/);
  });

  it('is BLIND: swapping candidate order yields the SAME winner', () => {
    const grounded: JudgeCandidate = { id: 'G', text: '`src/foo.ts` modified.', boundEvidence: ['git:file:src/foo.ts'], verified: true };
    const fluent: JudgeCandidate = { id: 'F', text: 'There are probably some changes, I think, in your files somewhere.', boundEvidence: [] };
    const v1 = judgeAnswers([grounded, fluent], ctx);
    const v2 = judgeAnswers([fluent, grounded], ctx);
    expect(v1.winnerId).toBe('G');
    expect(v2.winnerId).toBe('G');
  });

  it('more evidence bindings outrank fewer (groundedness is monotone)', () => {
    const more: JudgeCandidate = { id: 'M', text: 'changed: foo, added, staged', boundEvidence: ['a', 'b', 'c'], verified: true };
    const less: JudgeCandidate = { id: 'L', text: 'changed: foo', boundEvidence: ['a'], verified: true };
    const verdict = judgeAnswers([more, less], ctx);
    expect(verdict.winnerId).toBe('M');
  });
});

describe('answer-judge — honesty beats fabrication', () => {
  it('an honest "no grounded evidence" BEATS a confident fabrication', () => {
    const honest: JudgeCandidate = {
      id: 'H',
      text: 'I can answer that from git, but no git evidence was gathered for this turn. Re-ask in a git repository.',
      boundEvidence: [],
    };
    const fabricated: JudgeCandidate = {
      id: 'X',
      text: 'Your repo changed a lot — I believe it\'s about 5 files, trust me, presumably all staged.',
      boundEvidence: [],
    };
    const verdict = judgeAnswers([honest, fabricated], ctx);
    expect(verdict.winnerId).toBe('H');
  });

  it('a FAILED verify caps groundedness even with bindings present', () => {
    const claimed: JudgeCandidate = { id: 'C', text: 'all good', boundEvidence: ['a', 'b', 'c'], verified: false };
    const honest: JudgeCandidate = { id: 'D', text: 'I don\'t have grounded evidence for that yet.', boundEvidence: [] };
    const verdict = judgeAnswers([claimed, honest], ctx);
    // The failed-verify answer must not run away with it on raw binding count.
    expect(verdict.ranked.find((r) => r.id === 'C')!.criteria.find((c) => c.criterion === 'groundedness')!.score).toBeLessThanOrEqual(0.3);
  });
});

describe('answer-judge — length is never the deciding factor', () => {
  it('padding phrases are penalized, not rewarded', () => {
    const padded: JudgeCandidate = { id: 'P', text: 'As I mentioned, in conclusion, it is worth noting that to summarize, at the end of the day, the file changed.', boundEvidence: ['a'] };
    const direct: JudgeCandidate = { id: 'T', text: 'The file `src/foo.ts` changed.', boundEvidence: ['a'] };
    const verdict = judgeAnswers([padded, direct], ctx);
    const pd = verdict.ranked.find((r) => r.id === 'P')!.criteria.find((c) => c.criterion === 'directness')!.score;
    const td = verdict.ranked.find((r) => r.id === 'T')!.criteria.find((c) => c.criterion === 'directness')!.score;
    expect(td).toBeGreaterThan(pd);
  });

  it('self-reported confidence is NOT a scoring input (cannot be gamed)', () => {
    const cocky: JudgeCandidate = { id: 'C', text: 'maybe something changed', boundEvidence: [], selfConfidence: 0.99 };
    const grounded: JudgeCandidate = { id: 'G', text: '`src/foo.ts` modified', boundEvidence: ['git:file:src/foo.ts'], verified: true, selfConfidence: 0.4 };
    const verdict = judgeAnswers([cocky, grounded], ctx);
    expect(verdict.winnerId).toBe('G'); // high self-confidence did not save the ungrounded answer
  });
});

describe('answer-judge — at-par detection', () => {
  it('two equally grounded, equally on-task answers are AT PAR', () => {
    const a: JudgeCandidate = { id: 'A', text: '`src/foo.ts` modified, `src/added.ts` staged', boundEvidence: ['x', 'y'], verified: true };
    const b: JudgeCandidate = { id: 'B', text: '`src/foo.ts` modified, `src/added.ts` staged', boundEvidence: ['x', 'y'], verified: true };
    const verdict = judgeAnswers([a, b], ctx);
    expect(verdict.atPar).toBe(true);
    expect(verdict.winnerId).toBeNull();
  });
});
