import { describe, it, expect } from 'vitest';
import {
  runParityBench,
  shouldContinueParityLoop,
  describeParityReport,
  type ParityTask,
} from './parity-bench.js';

/** A task where Vai's grounded answer should win. */
function groundedWinTask(id: string): ParityTask {
  return {
    id,
    prompt: 'what changed in my repo?',
    vai: {
      text: '**Git evidence:** `src/foo.ts` modified (+12/-3).',
      boundEvidence: ['git:file:src/foo.ts'],
      verified: true,
    },
    model: {
      text: 'There may be some changes in your repository, I believe it\'s a few files, presumably.',
      boundEvidence: [],
    },
  };
}

/** A task where the model genuinely wins (Vai had nothing grounded, model was on-task). */
function modelWinTask(id: string): ParityTask {
  return {
    id,
    prompt: 'explain the tradeoffs between server components and client components in nextjs',
    vai: {
      text: 'I don\'t have grounded evidence for that yet.',
      boundEvidence: [],
    },
    model: {
      text: 'Server components render on the server and reduce client bundle size, while client components enable interactivity and hooks; the tradeoff is between bundle size/SEO and interactivity, so you push data-fetching to server components and keep interactive leaves as client components.',
      boundEvidence: ['doc:nextjs-rsc'],
      verified: true,
    },
  };
}

/** A task where both are equally grounded → at par. */
function parTask(id: string): ParityTask {
  const same = { text: '`src/foo.ts` modified, `src/added.ts` staged', boundEvidence: ['a', 'b'], verified: true };
  return { id, prompt: 'which files changed and staged?', vai: { ...same }, model: { ...same } };
}

describe('runParityBench — fair, blind measurement', () => {
  it('credits Vai when its grounded answer beats a fluent ungrounded model answer', () => {
    const report = runParityBench([groundedWinTask('t1')]);
    expect(report.results[0].outcome).toBe('vai');
    expect(report.vaiWinRate).toBe(1);
  });

  it('credits the model only when it GENUINELY wins on grounded/on-task criteria', () => {
    const report = runParityBench([modelWinTask('t1')]);
    expect(report.results[0].outcome).toBe('model');
    expect(report.modelWinRate).toBe(1);
    expect(report.modelWonTasks).toHaveLength(1);
  });

  it('detects at-par when answers are equivalent', () => {
    const report = runParityBench([parTask('t1')]);
    expect(report.results[0].outcome).toBe('par');
    expect(report.atParRate).toBe(1);
  });

  it('aggregates a mixed set into a parity rate', () => {
    const report = runParityBench([
      groundedWinTask('t1'),
      groundedWinTask('t2'),
      parTask('t3'),
      modelWinTask('t4'),
    ]);
    expect(report.tasks).toBe(4);
    expect(report.vaiWins).toBe(2);
    expect(report.atPar).toBe(1);
    expect(report.modelWins).toBe(1);
    // parityRate = (2 wins + 1 par) / 4 = 0.75
    expect(report.parityRate).toBeCloseTo(0.75, 5);
    expect(report.atParOverall).toBe(false); // below 0.9 target
  });

  it('reports at par overall when Vai wins-or-ties at/above the target', () => {
    const report = runParityBench([
      groundedWinTask('t1'),
      groundedWinTask('t2'),
      groundedWinTask('t3'),
      parTask('t4'),
    ]);
    expect(report.parityRate).toBe(1);
    expect(report.atParOverall).toBe(true);
  });
});

describe('shouldContinueParityLoop — safe, directed loop gate', () => {
  it('STOPS when Vai is at par overall', () => {
    const report = runParityBench([groundedWinTask('t1'), parTask('t2')]);
    const gate = shouldContinueParityLoop(report);
    expect(gate.continue).toBe(false);
    expect(gate.reason).toMatch(/at par/i);
  });

  it('CONTINUES only while the model genuinely wins — and names the tasks to close', () => {
    const report = runParityBench([
      groundedWinTask('t1'),
      modelWinTask('t2'),
      modelWinTask('t3'),
    ]);
    const gate = shouldContinueParityLoop(report);
    expect(gate.continue).toBe(true);
    expect(gate.targets.map((t) => t.id).sort()).toEqual(['t2', 't3']);
    // Each target carries WHY the model won, to direct the fix.
    expect(gate.targets[0].rationale).toBeTruthy();
  });

  it('does NOT loop on noise (model wins nothing, just ties below target)', () => {
    // 5 ties → parityRate 1.0 actually; force below-target with no model wins via mix.
    const report = runParityBench([groundedWinTask('t1'), parTask('t2')]);
    // Already at par; but assert the no-model-wins branch directly with a crafted report:
    const noModelWins = { ...report, atParOverall: false, modelWins: 0, modelWonTasks: [] as never[] };
    const gate = shouldContinueParityLoop(noModelWins);
    expect(gate.continue).toBe(false);
    expect(gate.reason).toMatch(/noise|ties/i);
  });
});

describe('describeParityReport', () => {
  it('renders a readable summary listing model-won tasks', () => {
    const report = runParityBench([groundedWinTask('t1'), modelWinTask('t2')]);
    const text = describeParityReport(report);
    expect(text).toContain('Parity over 2 task(s)');
    expect(text).toContain('Model won');
    expect(text).toContain('t2');
  });
});
