import { describe, expect, it } from 'vitest';
import {
  buildProcessTree, buildTimeSpectrum, shouldAutoExpand, resolveDwellCollapse, MIN_STEP_DWELL_MS,
  planStaggeredReveal, activeRevealIndex, STAGGER_STEP_MS, STAGGER_MAX_TOTAL_MS,
} from './ProcessTree.logic.js';
import type { ChatProgressStep } from '../../stores/chatStore.js';

describe('planStaggeredReveal — a fast burst plays the timeline forward, not all at once', () => {
  it('gives each step a sequential, non-overlapping read window', () => {
    const plan = planStaggeredReveal(3);
    expect(plan).toHaveLength(3);
    expect(plan[0]).toEqual({ index: 0, openAt: 0, closeAt: STAGGER_STEP_MS });
    expect(plan[1].openAt).toBe(STAGGER_STEP_MS); // step 2 opens exactly when step 1 closes
    expect(plan[2].openAt).toBe(2 * STAGGER_STEP_MS);
    // no overlap: each opens at the previous close
    for (let i = 1; i < plan.length; i++) expect(plan[i].openAt).toBe(plan[i - 1].closeAt);
  });

  it('compresses the per-step window so a long burst still settles within the cap', () => {
    const plan = planStaggeredReveal(40);
    const total = plan[plan.length - 1].closeAt;
    expect(total).toBeLessThanOrEqual(STAGGER_MAX_TOTAL_MS);
    expect(plan[1].openAt - plan[0].openAt).toBeLessThan(STAGGER_STEP_MS); // window shrank
  });

  it('never produces a window shorter than a readable floor', () => {
    const plan = planStaggeredReveal(1000);
    const window = plan[0].closeAt - plan[0].openAt;
    expect(window).toBeGreaterThanOrEqual(120);
  });

  it('empty/zero burst yields no windows', () => {
    expect(planStaggeredReveal(0)).toEqual([]);
  });
});

describe('activeRevealIndex — which step the timeline is currently showing', () => {
  const plan = planStaggeredReveal(3); // windows at 0,700,1400
  it('opens the step whose window contains elapsed', () => {
    expect(activeRevealIndex(plan, 0)).toBe(0);
    expect(activeRevealIndex(plan, 700)).toBe(1);
    expect(activeRevealIndex(plan, 1500)).toBe(2);
  });
  it('holds the last step once the plan has played out', () => {
    expect(activeRevealIndex(plan, 99999)).toBe(2);
  });
  it('returns -1 for an empty plan', () => {
    expect(activeRevealIndex([], 100)).toBe(-1);
  });
});

describe('resolveDwellCollapse — a completed step lingers long enough to read', () => {
  it('holds a just-completed step open until the dwell window passes', () => {
    const opened = 1000;
    // 200ms after opening, with a 700ms floor → keep open, recheck after the remainder.
    const r = resolveDwellCollapse({ live: true, status: 'done', openedAt: opened, now: opened + 200 });
    expect(r).toEqual({ open: true, recheckInMs: MIN_STEP_DWELL_MS - 200 });
  });

  it('allows collapse once the dwell window is satisfied', () => {
    const opened = 1000;
    const r = resolveDwellCollapse({ live: true, status: 'done', openedAt: opened, now: opened + MIN_STEP_DWELL_MS + 1 });
    expect(r).toEqual({ open: false, recheckInMs: 0 });
  });

  it('does not apply when the step never auto-opened', () => {
    expect(resolveDwellCollapse({ live: true, status: 'done', openedAt: null, now: 5000 })).toBeNull();
  });

  it('does not apply to a still-running step or a user-toggled / settled view', () => {
    expect(resolveDwellCollapse({ live: true, status: 'running', openedAt: 0, now: 9999 })).toBeNull();
    expect(resolveDwellCollapse({ live: true, status: 'done', openedAt: 0, now: 9999, userToggled: true })).toBeNull();
    expect(resolveDwellCollapse({ live: false, status: 'done', openedAt: 0, now: 9999 })).toBeNull();
  });
});

describe('shouldAutoExpand — stream the active step open (any tone, not just council)', () => {
  it('auto-expands ANY running expandable step while live', () => {
    // The fix: a running search/build/verify step opens itself so the user watches it
    // stream, instead of only council steps opening (the manual-click complaint).
    expect(shouldAutoExpand({ live: true, expandable: true, status: 'running' })).toBe(true);
  });

  it('collapses a step once it completes (settled trace stays quiet)', () => {
    expect(shouldAutoExpand({ live: true, expandable: true, status: 'done' })).toBe(false);
  });

  it('never overrides a user toggle', () => {
    expect(shouldAutoExpand({ live: true, expandable: true, status: 'running', userToggled: true })).toBeNull();
  });

  it('does not auto-expand a non-expandable step', () => {
    expect(shouldAutoExpand({ live: true, expandable: false, status: 'running' })).toBeNull();
  });

  it('expandAll forces expansion regardless of live/status (settled re-open)', () => {
    expect(shouldAutoExpand({ live: false, expandable: true, status: 'done', expandAll: true })).toBe(true);
  });

  it('makes no change for a non-live running step (no spurious open)', () => {
    expect(shouldAutoExpand({ live: false, expandable: true, status: 'running' })).toBeNull();
  });
});

describe('buildProcessTree council rounds', () => {
  it('nests council members on each round step from progress payloads', () => {
    const steps: ChatProgressStep[] = [
      { stage: 'vai-draft', label: 'Vai proposed an answer', status: 'done' },
      {
        stage: 'council-vai-round-1',
        label: 'Council asked Vai to revise',
        status: 'done',
        processLog: [{
          kind: 'artifact',
          label: 'Draft under review',
          body: 'First draft text',
        }],
        councilMembers: [{
          memberId: 'local:qwen-code',
          name: 'Qwen Code',
          topic: 'code',
          verdict: 'needs-work',
          confidence: 0.82,
          durationMs: 1234,
          realIntent: 'wants runnable code',
          methodLesson: 'Add runnable example',
          missingCapability: 'concrete code sample',
        }],
      },
    ];

    const nodes = buildProcessTree(steps);
    expect(nodes[1]?.children.length).toBeGreaterThanOrEqual(2);
    const qwen = nodes[1]?.children.find((child) => child.label === 'Qwen Code');
    expect(qwen).toBeTruthy();
    expect(qwen?.detail).toContain('1.2s');
    expect(qwen?.children.map((child) => child.label)).toEqual(expect.arrayContaining([
      'What happened',
      'Verdict',
      'Intent read',
      'Missing capability',
      'Method lesson',
      'Fact quarantine',
    ]));
    expect(nodes[1]?.children.some((child) => child.label === 'Draft under review')).toBe(true);
  });

  it('adds a settled activity map with stage, event, tool, and submodel inventory', () => {
    const steps: ChatProgressStep[] = [{
      stage: 'local-steering',
      label: 'Local model friend returned advice',
      status: 'done',
      advisor: {
        schemaVersion: 1,
        actorId: 'local:qwen3:8b',
        modelId: 'qwen3:8b',
        state: 'ready',
        taskShape: 'debugging',
        routeGuidance: [],
        riskFlags: ['generic-fallback-risk'],
        retrievalHints: [],
        confidence: 0.9,
        durationMs: 321,
      },
      processLog: [{ kind: 'event', label: 'Advisor packet received' }],
      toolRuns: [{ id: 't1', name: 'read_file', status: 'done', success: true, output: 'body' }],
    }, {
      stage: 'council-vai-round-1',
      label: 'Council reviewed Vai\'s draft',
      status: 'done',
      councilMembers: [{ memberId: 'qwen', name: 'Qwen', verdict: 'good', confidence: 0.91, durationMs: 100 }],
    }];

    const nodes = buildProcessTree(steps, undefined, undefined, undefined, false, true);
    expect(nodes[0]?.label).toBe('Turn activity map');
    expect(nodes[0]?.detail).toContain('2 stages');
    expect(nodes[0]?.children.some((child) => child.label === 'Submodels (2)')).toBe(true);
    expect(nodes[1]?.children[0]?.label).toBe('qwen3:8b');
    expect(nodes[1]?.children[0]?.note).toMatch(/qwen3:8b/);
  });

  it('shows a live reasoning child while a member is pending with a reasoningPreview', () => {
    const steps: ChatProgressStep[] = [{
      stage: 'council-vai-round-1',
      label: 'Council member 1/3: deepseek-r1:8b thinking…',
      status: 'running',
      councilMembers: [{
        memberId: 'local:deepseek-r1:8b',
        name: 'deepseek-r1:8b',
        topic: 'reasoning',
        verdict: 'needs-work',
        confidence: 0,
        pending: true,
        reasoningPreview: 'The user pasted a repo URL.\nFirst I should check the README before claiming a stack.',
      }],
    }];
    const member = buildProcessTree(steps)[0]?.children.find((c) => c.label === 'deepseek-r1:8b');
    expect(member).toBeTruthy();
    // Role chip surfaces instead of a bare "thinking…".
    expect(member?.detail).toMatch(/reasoning · reasoning…/);
    const reasoning = member?.children.find((c) => c.kind === 'reasoning');
    expect(reasoning).toBeTruthy();
    expect(reasoning?.note).toContain('check the README');
    expect(reasoning?.status).toBe('running');
  });

  it('falls back to the spoken waiting line when a pending member has no preview yet', () => {
    const steps: ChatProgressStep[] = [{
      stage: 'council-vai-round-1', label: 'Asking qwen3:8b', status: 'running',
      councilMembers: [{ name: 'qwen3:8b', topic: 'review', verdict: 'needs-work', confidence: 0, pending: true }],
    }];
    const member = buildProcessTree(steps)[0]?.children.find((c) => c.label === 'qwen3:8b');
    expect(member?.children.some((c) => c.kind === 'reasoning')).toBe(false);
    expect(member?.children[0]?.note).toMatch(/qwen3:8b/i); // humanized waiting line
  });

  it('includes the role chip in a resolved member detail', () => {
    const steps: ChatProgressStep[] = [{
      stage: 'council-vai-round-1', label: 'done', status: 'done',
      councilMembers: [{ memberId: 'q', name: 'qwen3:8b', topic: 'code', verdict: 'good', confidence: 0.9, durationMs: 100 }],
    }];
    const member = buildProcessTree(steps)[0]?.children.find((c) => c.label === 'qwen3:8b');
    expect(member?.detail).toMatch(/^code · good · 90%/);
  });

  it('nests tool runs with input and output grandchildren', () => {
    const steps: ChatProgressStep[] = [{
      stage: 'tool-batch-0',
      label: 'Vai called 2 tools (round 1)',
      status: 'done',
      toolRuns: [
        {
          id: 't1',
          name: 'read_file',
          status: 'done',
          success: true,
          durationMs: 15,
          input: '{ "path": "App.tsx" }',
          output: 'export default function App() {}',
        },
        {
          id: 't2',
          name: 'grep',
          status: 'done',
          success: true,
          durationMs: 9,
          input: '{ "pattern": "useState" }',
          output: '3 matches',
        },
      ],
    }];

    const nodes = buildProcessTree(steps);
    expect(nodes[0]?.children).toHaveLength(2);
    expect(nodes[0]?.children[0]?.children).toHaveLength(3);
    expect(nodes[0]?.children[0]?.children.map((child) => child.label)).toEqual([
      'Tool request',
      'Tool event',
      'Tool response',
    ]);
    expect(nodes[0]?.children[0]?.detail).toBe('read · ok · 15ms');
  });

  it('uses stable stage-based node ids so council completion does not remount the tree', () => {
    const running: ChatProgressStep[] = [{
      stage: 'council-vai-round-1',
      label: 'Council reviewing Vai\'s proposal',
      status: 'running',
      councilMembers: [{
        name: 'Qwen Code',
        verdict: 'needs-work',
        confidence: 0.5,
      }],
    }];
    const done: ChatProgressStep[] = [{
      stage: 'council-vai-round-1',
      label: 'Council asked Vai to revise',
      status: 'done',
      councilMembers: [{
        name: 'Qwen Code',
        verdict: 'needs-work',
        confidence: 0.82,
      }],
    }];
    expect(buildProcessTree(running)[0]?.id).toBe('step-council-vai-round-1');
    expect(buildProcessTree(done)[0]?.id).toBe('step-council-vai-round-1');
  });

  it('nests process log bodies under specific action/artifact panels', () => {
    const steps: ChatProgressStep[] = [{
      stage: 'search',
      label: 'Found 2 sources',
      status: 'done',
      processLog: [
        { kind: 'action', label: 'Vai searched the web', body: '1. price of eth' },
        { kind: 'artifact', label: 'Sources found (2)', body: 'CoinGecko\n$3,400' },
      ],
    }];
    const nodes = buildProcessTree(steps);
    const search = nodes[0];
    expect(search?.children[0]?.children[0]?.label).toBe('Action');
    expect(search?.children[1]?.children[0]?.label).toBe('Artifact');
  });

  it('renders reads, shows, and events as first-class process kinds', () => {
    const steps: ChatProgressStep[] = [{
      stage: 'inspect',
      label: 'Inspected the workspace',
      status: 'done',
      processLog: [
        { kind: 'read', label: 'Read active file', body: 'apps/desktop/src/components/chat/ProcessTree.tsx' },
        { kind: 'show', label: 'Showed preview state', body: 'Preview panel was open' },
        { kind: 'event', label: 'User expanded trace', body: 'Opened process tree details' },
      ],
    }];

    const nodes = buildProcessTree(steps);
    expect(nodes[0]?.children.map((child) => child.detail)).toEqual(['read', 'show', 'event']);
    expect(nodes[0]?.children.map((child) => child.children[0]?.label)).toEqual(['Read', 'Show', 'Event']);
    expect(nodes[0]?.children.map((child) => child.kind)).toEqual(['read', 'show', 'event']);
  });

  it('shows pending council members as running children while deliberating', () => {
    const steps: ChatProgressStep[] = [{
      stage: 'council-vai-round-2',
      label: 'Council re-reviewing the revised draft',
      status: 'running',
      councilMembers: [
        { name: 'Local qwen3:8b', verdict: 'good', confidence: 0.9 },
        { name: 'Grok (CLI)', verdict: 'needs-work', confidence: 0, pending: true },
      ],
    }];

    const nodes = buildProcessTree(steps);
    const councilStep = nodes.find((n) => n.id === 'step-council-vai-round-2');
    expect(councilStep?.children.some((c) => c.label === 'Grok (CLI)' && c.status === 'running')).toBe(true);
    expect(councilStep?.children.some((c) => c.label === 'qwen3:8b' && c.status === 'done')).toBe(true);
  });
});

describe('buildProcessTree — surfaced council dissent (transparency)', () => {
  const council = {
    outcome: 'ship' as const, agreement: 0.75, confidence: 0.8, topic: 'other',
    summary: 'shipped', realIntent: '', recommendedAction: 'answer-directly',
    missingCapabilities: [], methodLessons: [], members: [],
    dissent: {
      dissentStrength: 0.25,
      dissentingMembers: [
        { memberName: 'local:qwen2.5:7b', weight: 0.25, confidence: 0.9, concerns: ['unsupported latency claim'] },
      ],
    },
  };

  it('adds a visible Minority view node with the dissenter and their concern', () => {
    const nodes = buildProcessTree([{ stage: 'council-vai-round-1', label: 'Council', status: 'done' }], council);
    const d = nodes.find((n) => n.id === 'council-dissent');
    expect(d).toBeTruthy();
    expect(d?.label).toMatch(/Minority view/i);
    expect(d?.label).toMatch(/25% of the panel/);
    // Dissent is the panel working as intended — a completed council note, NOT an error glyph.
    expect(d?.status).toBe('done');
    expect(d?.tone).toBe('council');
    const member = d?.children[0];
    expect(member?.label).toBe('qwen2.5:7b'); // cleaned name
    expect(member?.status).toBe('done');
    expect(member?.note).toContain('unsupported latency claim');
  });

  it('adds no dissent node when the council had none (unanimous / no objection)', () => {
    const nodes = buildProcessTree([{ stage: 'council-vai-round-1', label: 'Council', status: 'done' }], { ...council, dissent: undefined });
    expect(nodes.some((n) => n.id === 'council-dissent')).toBe(false);
  });
});

describe('buildProcessTree — verification spine (grounding) node', () => {
  const council = {
    outcome: 'ship' as const, agreement: 1, confidence: 0.9, topic: 'other',
    summary: 's', realIntent: '', recommendedAction: 'answer-directly',
    missingCapabilities: [], methodLessons: [], members: [],
    provenance: { total: 4, groundedness: 0.5, hasDisputed: false, verdict: 'grounded' as const,
      counts: { used: 2, unused: 1, considered: 1, unavailable: 0, disputed: 0 } },
  };

  it('renders a Grounding row from council.provenance', () => {
    const nodes = buildProcessTree([{ stage: 'council-vai-round-1', label: 'C', status: 'done' }], council);
    const g = nodes.find((n) => n.id === 'council-provenance');
    expect(g).toBeTruthy();
    expect(g?.label).toMatch(/grounded/);
    expect(g?.label).toMatch(/50% of fetched context used/);
    expect(g?.note).toMatch(/used 2 · unused 1/);
  });

  it('renders the grounding row as a calm completed note (advisory, never an error glyph)', () => {
    const g = buildProcessTree([{ stage: 'council-vai-round-1', label: 'C', status: 'done' }], council).find((n) => n.id === 'council-provenance');
    expect(g?.status).toBe('done'); // advisory-only — the spine never flags an error
    expect(g?.tone).toBe('verify');
    expect(g?.label).not.toMatch(/⚠|contested|disputed/); // no dead vocabulary, no status emoji
  });

  it('renders a thinly-grounded verdict without alarm', () => {
    const thin = { ...council, provenance: { ...council.provenance, verdict: 'thin' as const, groundedness: 0.2 } };
    const g = buildProcessTree([{ stage: 'council-vai-round-1', label: 'C', status: 'done' }], thin).find((n) => n.id === 'council-provenance');
    expect(g?.label).toMatch(/thinly grounded/);
    expect(g?.status).toBe('done');
  });

  it('omits the row when no context was used (verdict none / total 0)', () => {
    const none = { ...council, provenance: { ...council.provenance, total: 0 } };
    expect(buildProcessTree([{ stage: 'council-vai-round-1', label: 'C', status: 'done' }], none).some((n) => n.id === 'council-provenance')).toBe(false);
  });
});

describe('buildTimeSpectrum — the settled "where did the time go" strip', () => {
  const step = (stage: string, durationMs?: number): ChatProgressStep =>
    ({ stage, label: stage, status: 'done', durationMs } as ChatProgressStep);

  it('produces proportional, tone-tagged segments from timed steps', () => {

    const segs = buildTimeSpectrum([step('search', 3000), step('council-vai', 6000), step('verify', 1000)]);
    expect(segs.length).toBe(3);
    expect(segs[1].tone).toBe('council');
    expect(segs[1].share).toBeCloseTo(0.6, 5);
    expect(segs.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 5);
  });

  it('merges sub-1% slivers into the previous segment', () => {

    const segs = buildTimeSpectrum([step('search', 10000), step('verify', 50), step('council-vai', 5000)]);
    expect(segs.length).toBe(2);
    expect(segs[0].ms).toBe(10050);
  });

  it('returns nothing for un-timed or single-step turns (no fake data)', () => {

    expect(buildTimeSpectrum([step('search'), step('verify')])).toEqual([]);
    expect(buildTimeSpectrum([step('search', 2000)])).toEqual([]);
  });
});

describe('buildProcessTree — truthful terminal outcomes', () => {
  it('renders failed steps and interrupted tools as bad even when lifecycle is done', () => {
    const nodes = buildProcessTree([{
      stage: 'verify',
      label: 'Verification stopped',
      status: 'done',
      outcome: 'failed',
      evidenceId: 'progress:1:verify',
      toolRuns: [{
        id: 't1',
        name: 'typecheck',
        status: 'done',
        outcome: 'interrupted',
        evidenceId: 'progress:1:verify:tool:t1',
      }],
    }]);

    expect(nodes[0]?.status).toBe('bad');
    const tool = nodes[0]?.children.find((child) => child.kind === 'tool');
    expect(tool?.status).toBe('bad');
    expect(tool?.children.find((child) => child.kind === 'tool-event')?.note).toContain('Outcome: interrupted');
    expect(tool?.children.find((child) => child.kind === 'tool-event')?.note).toContain('Evidence: progress:1:verify:tool:t1');
  });
});
