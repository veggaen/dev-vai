import { describe, expect, it } from 'vitest';
import { buildProcessTree, shouldAutoExpand } from './ProcessTree.logic.js';
import type { ChatProgressStep } from '../../stores/chatStore.js';

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
