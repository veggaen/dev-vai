import { describe, expect, it } from 'vitest';
import { buildProcessTree } from './ProcessTree.logic.js';
import type { ChatProgressStep } from '../../stores/chatStore.js';

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
          name: 'Qwen Code',
          topic: 'code',
          verdict: 'needs-work',
          confidence: 0.82,
          methodLesson: 'Add runnable example',
          missingCapability: 'concrete code sample',
        }],
      },
    ];

    const nodes = buildProcessTree(steps);
    expect(nodes[1]?.children.length).toBeGreaterThanOrEqual(2);
    expect(nodes[1]?.children.some((child) => child.label === 'Qwen Code')).toBe(true);
    expect(nodes[1]?.children.some((child) => child.label === 'Draft under review')).toBe(true);
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
    expect(nodes[0]?.children[0]?.children).toHaveLength(2);
    expect(nodes[0]?.children[0]?.children[0]?.label).toBe('Input');
    expect(nodes[0]?.children[0]?.children[1]?.label).toBe('Output');
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

  it('nests process log bodies as In/Out children', () => {
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
    expect(search?.children[0]?.children[0]?.label).toBe('In');
    expect(search?.children[1]?.children[0]?.label).toBe('Out');
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
    expect(councilStep?.children.some((c) => c.label === 'Local qwen3:8b' && c.status === 'done')).toBe(true);
  });
});
