import { describe, expect, it } from 'vitest';
import type { ChatProgressStep } from '../../stores/chatStore.js';
import { buildSoftwareWorkView } from './SoftwareWorkProgress.logic.js';

describe('buildSoftwareWorkView', () => {
  const repairSteps: ChatProgressStep[] = [
    { stage: 'reason', label: 'Read the intent', status: 'done' },
    {
      stage: 'workspace',
      label: 'Read the relevant files in mpm-frontend',
      detail: '3 files · 1 editable · 2 read-only references · Change: package.json',
      status: 'done',
    },
    { stage: 'council-code', label: 'Editing the project', status: 'done' },
    { stage: 'council-validate', label: 'Validation found 5 issue(s)', status: 'done' },
    { stage: 'council-repair', label: 'Edit repair pass 2/2 (5 issue(s))', status: 'running' },
  ];

  it('organizes raw events into six user-oriented stages and a chronological journal', () => {
    const view = buildSoftwareWorkView({ steps: repairSteps, live: true });
    expect(view.phases.map((phase) => phase.label)).toEqual([
      'Understand', 'Investigate', 'Plan', 'Build', 'Review', 'Validate',
    ]);
    expect(view.activeTitle).toBe('Fixing 5 validation issues · pass 2 of 2');
    expect(view.activeDetail).toContain('Edit repair pass 2/2');
    expect(view.phases.find((phase) => phase.id === 'build')?.status).toBe('running');
    expect(view.phases.find((phase) => phase.id === 'validate')?.status).toBe('attention');
    expect(view.journal.map((item) => item.label)).toEqual(repairSteps.map((step) => step.label));
  });

  it('keeps tools, evidence, and council activity as teachable nested journal notes', () => {
    const view = buildSoftwareWorkView({
      live: true,
      steps: [{
        stage: 'council-review',
        label: 'Reviewing the implementation',
        detail: 'Checking the public API and error path',
        status: 'running',
        processLog: [{ kind: 'read', label: 'Opened src/api.ts', body: 'The public function returns Result.' }],
        toolRuns: [{ id: 't1', name: 'typecheck', status: 'done', success: true, output: '0 errors' }],
        councilMembers: [{ name: 'Qwen', verdict: 'needs-work', confidence: 0.8, note: 'Handle the rejected promise.' }],
      }],
    });

    expect(view.journal[0]?.notes.map((note) => note.label)).toEqual([
      'Opened src/api.ts',
      'typecheck — completed',
      'Qwen: requested improvement',
    ]);
    expect(view.observableActionCount).toBe(4);
  });

  it('settles to a compact result summary with actions, files, repairs, and duration', () => {
    const settled = repairSteps.map((step) => ({ ...step, status: 'done' as const }));
    const view = buildSoftwareWorkView({
      steps: settled,
      live: false,
      durationMs: 98_000,
      outputFileCount: 6,
    });
    expect(view.summary).toBe('Implementation · 6 files ready · 5 recorded actions · 2 repair passes · 1m 38s');
  });

  i