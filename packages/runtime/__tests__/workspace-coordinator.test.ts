import { describe, expect, it } from 'vitest';
import {
  WorkspaceTurnCoordinator,
  buildWorkspaceColleagueNote,
  normalizeWorkspaceRoot,
} from '../src/workspace-coordinator.js';

const ROOT = 'C:\\Users\\v3gga\\Documents\\dev-lawn';

describe('normalizeWorkspaceRoot', () => {
  it('collides separator/case/trailing-slash variants', () => {
    expect(normalizeWorkspaceRoot('C:\\Dev\\App')).toBe(normalizeWorkspaceRoot('c:/dev/app/'));
    expect(normalizeWorkspaceRoot('/home/v3gga/app')).toBe('/home/v3gga/app');
  });
});

describe('WorkspaceTurnCoordinator', () => {
  it('first turn in a folder sees an empty site', () => {
    const c = new WorkspaceTurnCoordinator();
    const snap = c.beginTurn(ROOT, 'conv-a', 'lay the foundation');
    expect(snap.activeColleagues).toHaveLength(0);
    expect(snap.recentWork).toHaveLength(0);
  });

  it('a concurrent turn on the same folder sees the in-flight colleague', () => {
    const c = new WorkspaceTurnCoordinator();
    c.beginTurn(ROOT, 'conv-a', 'lay the foundation and plumbing');
    const snap = c.beginTurn('c:/users/v3gga/documents/dev-lawn/', 'conv-b', 'paint the walls');
    expect(snap.activeColleagues.map((x) => x.conversationId)).toEqual(['conv-a']);
    expect(snap.activeColleagues[0].goal).toContain('foundation');
  });

  it('finished turns move to the journal and are visible to later turns', () => {
    const c = new WorkspaceTurnCoordinator();
    c.beginTurn(ROOT, 'conv-a', 'set up the database schema');
    c.endTurn(ROOT, 'conv-a');
    const snap = c.beginTurn(ROOT, 'conv-b', 'build the API on top');
    expect(snap.activeColleagues).toHaveLength(0);
    expect(snap.recentWork).toHaveLength(1);
    expect(snap.recentWork[0].goal).toContain('database schema');
  });

  it('a conversation never sees itself as a colleague', () => {
    const c = new WorkspaceTurnCoordinator();
    c.beginTurn(ROOT, 'conv-a', 'first ask');
    c.endTurn(ROOT, 'conv-a');
    const snap = c.beginTurn(ROOT, 'conv-a', 'follow-up ask');
    expect(snap.activeColleagues).toHaveLength(0);
    // Its own finished work IS useful context.
    expect(snap.recentWork).toHaveLength(1);
  });

  it('different folders are independent sites', () => {
    const c = new WorkspaceTurnCoordinator();
    c.beginTurn(ROOT, 'conv-a', 'lawn work');
    const snap = c.beginTurn('C:\\other\\project', 'conv-b', 'other work');
    expect(snap.activeColleagues).toHaveLength(0);
  });

  it('journal is capped', () => {
    const c = new WorkspaceTurnCoordinator();
    for (let i = 0; i < 15; i += 1) {
      c.beginTurn(ROOT, `conv-${i}`, `task ${i}`);
      c.endTurn(ROOT, `conv-${i}`);
    }
    const snap = c.beginTurn(ROOT, 'conv-final', 'latest');
    expect(snap.recentWork.length).toBeLessThanOrEqual(10);
    expect(snap.recentWork[0].goal).toBe('task 14');
  });
});

describe('buildWorkspaceColleagueNote', () => {
  it('returns null for a quiet workspace (zero prompt cost)', () => {
    expect(buildWorkspaceColleagueNote(ROOT, { activeColleagues: [], recentWork: [] })).toBeNull();
  });

  it('renders in-flight and finished work with sequencing guidance', () => {
    const note = buildWorkspaceColleagueNote(ROOT, {
      activeColleagues: [{ conversationId: 'conv-aaaa1111', goal: 'wire the auth pages', startedAt: Date.now() }],
      recentWork: [{ conversationId: 'conv-bbbb2222', goal: 'created the db schema', finishedAt: Date.now() }],
    });
    expect(note).toContain('Workspace coordination');
    expect(note).toContain('conv-aaaa1111'.slice(0, 8));
    expect(note).toContain('wire the auth pages');
    expect(note).toContain('created the db schema');
    expect(note).toContain('foundation before walls');
  });
});
