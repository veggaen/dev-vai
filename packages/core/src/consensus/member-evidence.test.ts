import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseToolRequests, runToolRequest, gatherMemberEvidence } from './member-evidence.js';
import { createCouncilContextTools } from './context-tools.js';
import { createCouncilMember } from './member.js';
import type { ModelAdapter } from '../models/adapter.js';
import type { CouncilInput } from './types.js';

/**
 * member-evidence — the pull-model round. These tests are V3gga's exact ask: VALIDATE that a
 * member knows how to use the tools — i.e. given a context-needing question it issues a correct
 * fetch and the fetched, real content reaches its vote.
 */

function makeRepo(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'council-ev-'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'target.ts'), 'export const SECRET_MARKER = "blueberry-42";\n');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const INPUT: CouncilInput = {
  prompt: 'Where is SECRET_MARKER defined and what is its value?',
  draft: 'I think it is somewhere in src.',
  modelId: 'test',
  turnKind: 'standalone-question',
  hasEvidence: false,
  sources: [],
};

/**
 * A scripted adapter. The evidence round is identifiable by its system prompt (it carries the
 * tool instructions); everything else is the vote. Keying off the message — not a call counter —
 * makes the stub correct whether or not an evidence round happens.
 */
function scriptedAdapter(evidenceReply: string, noteReply: string): ModelAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    id: 'scripted',
    displayName: 'Scripted',
    calls, // exposed so tests can assert how many rounds ran and what each received
    async chat(req: any) {
      const system = req.messages.find((m: any) => m.role === 'system')?.content ?? '';
      const lastUser = [...req.messages].reverse().find((m: any) => m.role === 'user')?.content ?? '';
      calls.push(lastUser);
      const isEvidenceRound = system.includes('CONTEXT TOOLS');
      return { message: { role: 'assistant', content: isEvidenceRound ? evidenceReply : noteReply } } as any;
    },
    async *chatStream() { /* unused */ },
    supportsToolUse: false,
  } as any;
}

describe('parseToolRequests', () => {
  it('parses a valid request list and caps at 4', () => {
    const raw = '{"requests":[{"tool":"grep","pattern":"FOO"},{"tool":"readFile","path":"a.ts"},{"tool":"listFiles","glob":"**/*.ts"},{"tool":"grep","pattern":"BAR"},{"tool":"grep","pattern":"FIFTH"}]}';
    const reqs = parseToolRequests(raw);
    expect(reqs).toHaveLength(4);
    expect(reqs[0]).toMatchObject({ tool: 'grep', pattern: 'FOO' });
  });

  it('tolerates fenced JSON and prose around it', () => {
    const raw = 'Sure, here:\n```json\n{"requests":[{"tool":"grep","pattern":"X"}]}\n```';
    expect(parseToolRequests(raw)).toHaveLength(1);
  });

  it('returns [] for garbage / no JSON / wrong shape', () => {
    expect(parseToolRequests('no json here')).toEqual([]);
    expect(parseToolRequests('{"nope":true}')).toEqual([]);
    expect(parseToolRequests('{"requests":"notarray"}')).toEqual([]);
  });
});

describe('runToolRequest — executes against real sandboxed tools', () => {
  it('grep returns formatted hits with the real value', () => {
    const { root, cleanup } = makeRepo();
    try {
      const tools = createCouncilContextTools(root);
      const out = runToolRequest(tools, { tool: 'grep', pattern: 'SECRET_MARKER' });
      expect(out).toContain('src/target.ts');
      expect(out).toContain('blueberry-42');
    } finally { cleanup(); }
  });

  it('readFile returns the real file content', () => {
    const { root, cleanup } = makeRepo();
    try {
      const tools = createCouncilContextTools(root);
      const out = runToolRequest(tools, { tool: 'readFile', path: 'src/target.ts' });
      expect(out).toContain('blueberry-42');
    } finally { cleanup(); }
  });

  it('reports missing required args instead of throwing', () => {
    const { root, cleanup } = makeRepo();
    try {
      const tools = createCouncilContextTools(root);
      expect(runToolRequest(tools, { tool: 'grep' })).toMatch(/missing pattern/i);
      expect(runToolRequest(tools, { tool: 'readFile' })).toMatch(/missing path/i);
    } finally { cleanup(); }
  });
});

describe('gatherMemberEvidence — a member fetches its own context', () => {
  it('runs the requests the model asks for and returns real fetched content', async () => {
    const { root, cleanup } = makeRepo();
    try {
      const tools = createCouncilContextTools(root);
      const adapter = scriptedAdapter('{"requests":[{"tool":"grep","pattern":"SECRET_MARKER"}]}', '');
      const ev = await gatherMemberEvidence(adapter, INPUT, tools, { system: 'sys', question: INPUT.prompt });
      expect(ev.requests).toHaveLength(1);
      expect(ev.block).toContain('blueberry-42'); // the member's fetched evidence has the real value
    } finally { cleanup(); }
  });

  it('returns an empty block when the member needs nothing', async () => {
    const { root, cleanup } = makeRepo();
    try {
      const tools = createCouncilContextTools(root);
      const adapter = scriptedAdapter('{"requests":[]}', '');
      const ev = await gatherMemberEvidence(adapter, INPUT, tools, { system: 'sys', question: INPUT.prompt });
      expect(ev.block).toBe('');
    } finally { cleanup(); }
  });

  it('degrades gracefully (empty block) if the adapter throws', async () => {
    const { root, cleanup } = makeRepo();
    try {
      const tools = createCouncilContextTools(root);
      const adapter = { id: 'x', displayName: 'X', chat: async () => { throw new Error('model down'); }, async *chatStream() {}, supportsToolUse: false } as any;
      const ev = await gatherMemberEvidence(adapter, INPUT, tools, { system: 'sys', question: INPUT.prompt });
      expect(ev).toEqual({ requests: [], fetched: [], block: '' });
    } finally { cleanup(); }
  });
});

describe('createCouncilMember with contextTools — end-to-end pull-model', () => {
  const freshInput = (): CouncilInput => ({
    prompt: 'Where is SECRET_MARKER defined and what is its value?',
    draft: 'I think it is somewhere in src.',
    modelId: 'test',
    turnKind: 'standalone-question',
    hasEvidence: false,
    sources: [],
  });

  it('feeds the member-fetched evidence into the vote (the note can cite the real value)', async () => {
    const { root, cleanup } = makeRepo();
    try {
      const tools = createCouncilContextTools(root);
      const adapter = scriptedAdapter(
        '{"requests":[{"tool":"grep","pattern":"SECRET_MARKER"}]}',
        '{"verdict":"good","confidence":0.9,"realIntent":"find SECRET_MARKER","hiddenMeaning":"","missingCapability":"","suggestedAction":"answer-directly","searchQuery":"","methodLesson":"grounded in src/target.ts blueberry-42","concerns":[]}',
      );
      const member = createCouncilMember({ adapter, topic: 'code', contextTools: tools });
      const note = await member.review(freshInput());
      expect(note).not.toBeNull();
      expect(adapter.calls).toHaveLength(2); // evidence round + vote
      // The vote must have RECEIVED the fetched evidence in its user prompt.
      expect(adapter.calls[1]).toContain('blueberry-42');
      expect(note!.methodLesson).toContain('blueberry-42');
      // Context-state ledger: the member fetched 1 grep and grounded on it → used=1.
      expect(note!.contextLedger).toBeDefined();
      expect(note!.contextLedger!.used).toBe(1);
      expect(note!.contextLedger!.items[0].state).toBe('used');
    } finally { cleanup(); }
  });

  it('without contextTools, behaves exactly as before (no evidence round, one chat call)', async () => {
    const adapter = scriptedAdapter(
      'unused',
      '{"verdict":"good","confidence":0.8,"realIntent":"x","hiddenMeaning":"","missingCapability":"","suggestedAction":"answer-directly","searchQuery":"","methodLesson":"y","concerns":[]}',
    );
    const member = createCouncilMember({ adapter, topic: 'code' });
    const note = await member.review(freshInput());
    expect(note).not.toBeNull();
    expect(adapter.calls).toHaveLength(1); // only the vote, no evidence round
  });
});
