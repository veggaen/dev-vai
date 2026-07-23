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

  it('reports a withheld change as withheld instead of calling validation failure an implementation', () => {
    const view = buildSoftwareWorkView({
      live: false,
      durationMs: 98_000,
      steps: [
        ...repairSteps.map((step) => ({ ...step, status: 'done' as const })),
        {
          stage: 'council-validate',
          label: 'Edit withheld — 4 validation issue(s) remain',
          detail: 'Hardhat 3 config is invalid.',
          status: 'done',
        },
      ],
    });

    expect(view.withheld).toBe(true);
    expect(view.remainingIssueCount).toBe(4);
    expect(view.summary).toBe('Withheld · 4 of 5 validation issues remain · 6 recorded actions · 2 repair passes · 1m 38s');
    expect(view.phases.find((phase) => phase.id === 'validate')?.status).toBe('attention');
  });

  it('does not keep a stale withheld label after the validated edit is applied', () => {
    const view = buildSoftwareWorkView({
      live: false,
      outputFileCount: 1,
      steps: [
        { stage: 'council-review', label: 'Prepared change — withheld until validation completes', status: 'done' },
        { stage: 'council-validate', label: 'Static checks passed', status: 'done' },
        { stage: 'council-code', label: 'Applying targeted edit to readtrack (src/App.tsx)', status: 'done' },
      ],
    });

    expect(view.withheld).toBe(false);
    expect(view.summary).toContain('Implementation · 1 file ready');
  });

  it('translates internal advisor jargon into apprentice-friendly operational language', () => {
    const view = buildSoftwareWorkView({
      live: true,
      steps: [{
        stage: 'advisor',
        label: 'Local model friend returned advice',
        detail: 'build-action | risks: format-contract-risk | guiding answer needed | confidence 90%',
        status: 'done',
        processLog: [{
          kind: 'artifact',
          label: 'Advisor steering packet',
          body: 'build-action | risks: format-contract-risk | guiding answer needed | confidence 90%',
        }],
      }],
    });

    expect(view.journal[0]?.label).toBe('Background route and risk check completed');
    expect(view.journal[0]?.detail).toContain('strict file-output contract');
    expect(view.journal[0]?.notes[0]?.label).toBe('Background advisor finding');
    expect(view.activeTitle).toBe('Background route and risk check completed');
    expect(view.activeDetail).not.toContain('format-contract-risk');
  });

  it('translates debugging advisor packets instead of exposing raw route jargon', () => {
    const view = buildSoftwareWorkView({
      live: false,
      steps: [{
        stage: 'advisor',
        label: 'Local model friend returned advice',
        detail: 'debugging | risks: format-contract-risk | guiding answer needed | confidence 90%',
        status: 'done',
      }],
    });

    expect(view.journal[0]?.detail).toContain('debugging and repair task');
    expect(view.journal[0]?.detail).toContain('strict file-output contract');
    expect(view.journal[0]?.detail).not.toContain('format-contract-risk');
  });
});
