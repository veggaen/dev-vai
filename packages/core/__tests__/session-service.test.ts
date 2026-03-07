import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db/client.js';
import { SessionService } from '../src/sessions/service.js';
import type { VaiDatabase } from '../src/db/client.js';

describe('SessionService', () => {
  let db: VaiDatabase;
  let svc: SessionService;

  beforeEach(() => {
    db = createDb(':memory:');
    svc = new SessionService(db);
    svc.ensureTables();
  });

  // ── Session CRUD ──

  it('creates and retrieves a session', () => {
    const session = svc.createSession({
      title: 'Test Session',
      agentName: 'GitHub Copilot',
      modelId: 'claude-opus-4.6',
    });
    expect(session.id).toBeTruthy();
    expect(session.title).toBe('Test Session');
    expect(session.status).toBe('active');

    const fetched = svc.getSession(session.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe('Test Session');
  });

  it('returns null for non-existent session', () => {
    expect(svc.getSession('nonexistent')).toBeNull();
  });

  it('lists sessions with default ordering', () => {
    svc.createSession({ title: 'A', agentName: 'test', modelId: 'm1' });
    svc.createSession({ title: 'B', agentName: 'test', modelId: 'm1' });
    svc.createSession({ title: 'C', agentName: 'test', modelId: 'm1' });

    const all = svc.listSessions();
    expect(all.length).toBe(3);
  });

  it('lists sessions filtered by status', () => {
    const s1 = svc.createSession({ title: 'Active', agentName: 'test', modelId: 'm1' });
    svc.createSession({ title: 'Also Active', agentName: 'test', modelId: 'm1' });
    svc.endSession(s1.id);

    const active = svc.listSessions({ status: 'active' });
    expect(active.length).toBe(1);
    expect(active[0].title).toBe('Also Active');
  });

  it('updates session fields', () => {
    const session = svc.createSession({ title: 'Original', agentName: 'test', modelId: 'm1' });
    svc.updateSession(session.id, { title: 'Updated Title' });

    const updated = svc.getSession(session.id);
    expect(updated!.title).toBe('Updated Title');
  });

  it('ends a session with completed status', () => {
    const session = svc.createSession({ title: 'To End', agentName: 'test', modelId: 'm1' });
    svc.endSession(session.id);

    const ended = svc.getSession(session.id);
    expect(ended!.status).toBe('completed');
    expect(ended!.endedAt).toBeTruthy();
  });

  it('ends a session with failed status', () => {
    const session = svc.createSession({ title: 'Fail', agentName: 'test', modelId: 'm1' });
    svc.endSession(session.id, 'failed');

    const ended = svc.getSession(session.id);
    expect(ended!.status).toBe('failed');
  });

  it('deletes a session and its events', () => {
    const session = svc.createSession({ title: 'Delete Me', agentName: 'test', modelId: 'm1' });
    svc.addEvent({
      sessionId: session.id,
      type: 'message',
      timestamp: Date.now(),
      content: 'Hello',
      meta: { role: 'user' },
    });
    svc.deleteSession(session.id);

    expect(svc.getSession(session.id)).toBeNull();
    expect(svc.getEvents(session.id).length).toBe(0);
  });

  // ── Events ──

  it('adds and retrieves events', () => {
    const session = svc.createSession({ title: 'Events', agentName: 'test', modelId: 'm1' });
    const event = svc.addEvent({
      sessionId: session.id,
      type: 'message',
      timestamp: Date.now(),
      content: 'User said hello',
      meta: { role: 'user' },
    });

    expect(event.id).toBeTruthy();
    const events = svc.getEvents(session.id);
    expect(events.length).toBe(1);
    expect(events[0].content).toBe('User said hello');
  });

  it('adds multiple events in batch', () => {
    const session = svc.createSession({ title: 'Batch', agentName: 'test', modelId: 'm1' });
    const now = Date.now();
    const events = svc.addEvents([
      { sessionId: session.id, type: 'message', timestamp: now, content: 'First', meta: { role: 'user' } },
      { sessionId: session.id, type: 'message', timestamp: now + 1, content: 'Second', meta: { role: 'assistant' } },
    ]);

    expect(events.length).toBe(2);
    expect(svc.getEventCount(session.id)).toBe(2);
  });

  it('filters events by type', () => {
    const session = svc.createSession({ title: 'Filter', agentName: 'test', modelId: 'm1' });
    svc.addEvent({ sessionId: session.id, type: 'message', timestamp: Date.now(), content: 'msg', meta: {} });
    svc.addEvent({ sessionId: session.id, type: 'terminal', timestamp: Date.now(), content: 'cmd', meta: {} });
    svc.addEvent({ sessionId: session.id, type: 'message', timestamp: Date.now(), content: 'msg2', meta: {} });

    const msgs = svc.getEvents(session.id, { type: 'message' });
    expect(msgs.length).toBe(2);
  });

  // ── Pinned Events ──

  it('pins and unpins events', () => {
    const session = svc.createSession({ title: 'Pin', agentName: 'test', modelId: 'm1' });
    const event = svc.addEvent({
      sessionId: session.id,
      type: 'message',
      timestamp: Date.now(),
      content: 'Important',
      meta: {},
    });

    svc.pinEvent(event.id);
    let pinned = svc.getPinnedEvents(session.id);
    expect(pinned.length).toBe(1);
    expect(pinned[0].id).toBe(event.id);

    svc.unpinEvent(event.id);
    pinned = svc.getPinnedEvents(session.id);
    expect(pinned.length).toBe(0);
  });

  // ── Pinned Notes ──

  it('creates and retrieves pinned notes', () => {
    const session = svc.createSession({ title: 'Notes', agentName: 'test', modelId: 'm1' });
    const note = svc.addPinnedNote({
      sessionId: session.id,
      content: 'Key architectural decision',
      category: 'decision',
    });

    expect(note.id).toBeTruthy();
    const notes = svc.getPinnedNotes({ sessionId: session.id });
    expect(notes.length).toBe(1);
    expect(notes[0].content).toBe('Key architectural decision');
  });

  it('resolves and deletes pinned notes', () => {
    const session = svc.createSession({ title: 'Notes', agentName: 'test', modelId: 'm1' });
    const note = svc.addPinnedNote({
      sessionId: session.id,
      content: 'Blocker: need API key',
      category: 'blocker',
    });

    svc.resolvePinnedNote(note.id);
    const resolved = svc.getPinnedNotes({ resolved: true });
    expect(resolved.length).toBe(1);

    svc.deletePinnedNote(note.id);
    expect(svc.getPinnedNotes({ sessionId: session.id }).length).toBe(0);
  });

  // ── Search ──

  it('searches events by content', () => {
    const session = svc.createSession({ title: 'Search', agentName: 'test', modelId: 'm1' });
    svc.addEvent({ sessionId: session.id, type: 'message', timestamp: Date.now(), content: 'How to deploy Docker containers', meta: {} });
    svc.addEvent({ sessionId: session.id, type: 'message', timestamp: Date.now(), content: 'React component patterns', meta: {} });

    const results = svc.searchEvents('Docker');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].event.content).toContain('Docker');
  });

  // ── Export/Import ──

  it('exports and imports a session', () => {
    const session = svc.createSession({ title: 'Export Me', agentName: 'test', modelId: 'm1' });
    svc.addEvent({ sessionId: session.id, type: 'message', timestamp: Date.now(), content: 'Hello', meta: {} });

    const exported = svc.exportSession(session.id);
    expect(exported).not.toBeNull();
    expect(exported!.events.length).toBe(1);

    // Import into a fresh DB
    const db2 = createDb(':memory:');
    const svc2 = new SessionService(db2);
    svc2.ensureTables();

    const importedId = svc2.importSession(exported!);
    const imported = svc2.getSession(importedId);
    expect(imported).not.toBeNull();
    expect(imported!.title).toBe('Export Me');
    expect(svc2.getEvents(importedId).length).toBe(1);
  });

  // ── Context Summary ──

  it('returns a context summary', () => {
    svc.createSession({ title: 'Summary Test', agentName: 'test', modelId: 'm1' });
    const summary = svc.getContextSummary(5);
    expect(summary).toHaveProperty('recentSessions');
    expect(summary.recentSessions.length).toBe(1);
  });
});
