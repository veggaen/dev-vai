import { describe, expect, it } from 'vitest';
import { buildCopyPayload, nodeToSnapshot, snapshotsToMarkdown } from './ProcessTree.copy.js';
import type { ProcessNode } from './ProcessTree.logic.js';

const sample: ProcessNode = {
  id: 'a',
  label: 'Search',
  status: 'done',
  tone: 'search',
  children: [{
    id: 'b',
    label: 'In',
    status: 'done',
    note: 'price of eth',
    children: [],
  }],
};

describe('ProcessTree.copy', () => {
  it('serializes a branch with nested note', () => {
    const md = snapshotsToMarkdown([nodeToSnapshot(sample)]);
    expect(md).toContain('Search');
    expect(md).toContain('price of eth');
  });

  it('builds node-only payload without children', () => {
    const json = buildCopyPayload('node', sample, [sample]).json;
    expect(JSON.parse(json).children).toBeUndefined();
  });

  it('builds tree payload from all nodes', () => {
    const json = buildCopyPayload('tree', sample, [sample]).json;
    expect(JSON.parse(json)).toHaveLength(1);
  });
});
