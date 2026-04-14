import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { VaiSnapshot } from '../src/models/vai-engine.js';

describe('VaiEngine Persistence', () => {
  let tmpDir: string;
  let persistPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vai-persist-'));
    persistPath = path.join(tmpDir, 'vai-knowledge.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates no file when no knowledge is trained', () => {
    const engine = new VaiEngine({ persistPath });
    engine.flushPersist();
    expect(fs.existsSync(persistPath)).toBe(false);
  });

  it('persists trained knowledge to disk on flushPersist()', () => {
    const engine = new VaiEngine({ persistPath });
    engine.teach('python language', 'Python is a high-level programming language.', 'user-taught', 'en');
    engine.flushPersist();

    expect(fs.existsSync(persistPath)).toBe(true);
    const snapshot: VaiSnapshot = JSON.parse(fs.readFileSync(persistPath, 'utf-8'));
    expect(snapshot.version).toBe(1);
    expect(snapshot.learnedEntries.length).toBeGreaterThan(0);
    // Should NOT contain bootstrap entries
    expect(snapshot.learnedEntries.every(e => !e.source.startsWith('bootstrap'))).toBe(true);
  });

  it('filters polluted learned entries out of persistence snapshots', () => {
    const engine = new VaiEngine({ persistPath });
    engine.teach('clean topic', 'This is a clean learned response.', 'user-taught', 'en');
    engine.teach(
      'epic agent merge',
      'SearchCtrl+K Toggle Sidebar Cancel Request was interrupted by the user. 20 (Beta) Upgrade to SuperGrok.',
      'auto-learned',
      'en',
    );
    engine.flushPersist();

    const snapshot: VaiSnapshot = JSON.parse(fs.readFileSync(persistPath, 'utf-8'));
    expect(snapshot.learnedEntries.some((entry) => entry.pattern === 'clean topic')).toBe(true);
    expect(snapshot.learnedEntries.some((entry) => /supergrok/i.test(entry.response))).toBe(false);
  });

  it('loads persisted entries on construction', () => {
    // Step 1: Teach and persist
    const engine1 = new VaiEngine({ persistPath });
    engine1.teach('my custom topic', 'This is a custom response.', 'user-taught', 'en');
    engine1.flushPersist();

    // Step 2: Create a new engine — it should load the persisted data
    const engine2 = new VaiEngine({ persistPath });
    const match = engine2.knowledge.findBestMatch('my custom topic');
    expect(match).not.toBeNull();
    expect(match!.response).toBe('This is a custom response.');
  });

  it('skips polluted persisted entries during load', () => {
    const snapshot: VaiSnapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      learnedEntries: [
        {
          pattern: 'clean topic',
          response: 'This is a clean learned response.',
          frequency: 1,
          source: 'user-taught',
          language: 'en',
        },
        {
          pattern: 'epic agent merge',
          response: 'SearchCtrl+K Toggle Sidebar Cancel Request was interrupted by the user. 20 (Beta) Upgrade to SuperGrok.',
          frequency: 1,
          source: 'auto-learned',
          language: 'en',
        },
      ],
      strategyStats: {},
      missedTopics: {},
    };
    fs.writeFileSync(persistPath, JSON.stringify(snapshot), 'utf-8');

    const engine = new VaiEngine({ persistPath });
    expect(engine.knowledge.findBestMatch('clean topic')?.response).toBe('This is a clean learned response.');
    expect(engine.knowledge.findBestMatch('epic agent merge')).toBeNull();
  });

  it('skips persisted AI app-shell chrome entries during load', () => {
    const snapshot: VaiSnapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      learnedEntries: [
        {
          pattern: 'perplexity',
          response: 'Search Computer New Thread History Discover Spaces Finance More Recent make a good prompt for me Account & Settings Upgrade to access the top AI models Ask anything Model Computer.',
          frequency: 2,
          source: 'https://www.perplexity.ai/',
          language: 'en',
        },
      ],
      strategyStats: {},
      missedTopics: {},
    };
    fs.writeFileSync(persistPath, JSON.stringify(snapshot), 'utf-8');

    const engine = new VaiEngine({ persistPath });
    expect(engine.knowledge.findBestMatch('what is perplexity')).toBeNull();
  });

  it('preserves bootstrap entries alongside persisted ones', () => {
    const engine1 = new VaiEngine({ persistPath });
    const bootstrapCount = engine1.knowledge.entryCount;
    engine1.teach('persisted topic', 'Persisted response about a custom topic.', 'user-taught', 'en');
    engine1.flushPersist();

    const engine2 = new VaiEngine({ persistPath });
    // Should have bootstrap + persisted entries
    expect(engine2.knowledge.entryCount).toBeGreaterThan(bootstrapCount);

    // Bootstrap still works
    const hello = engine2.knowledge.findBestMatch('hello');
    expect(hello).not.toBeNull();
    expect(hello!.response).toContain('VeggaAI');

    // Persisted still works
    const custom = engine2.knowledge.findBestMatch('persisted topic');
    expect(custom).not.toBeNull();
    expect(custom!.response).toBe('Persisted response about a custom topic.');
  });

  it('persists strategy stats and missed topics', async () => {
    const engine1 = new VaiEngine({ persistPath });
    // Generate some responses to build strategy stats
    await engine1.generateResponse('hello', []);
    await engine1.generateResponse('asdfghjkl random gibberish xyz123', []);
    // Teach something so the file gets written
    engine1.teach('persisted item', 'For strategy stats test.', 'user-taught', 'en');
    engine1.flushPersist();

    const snapshot: VaiSnapshot = JSON.parse(fs.readFileSync(persistPath, 'utf-8'));
    expect(Object.keys(snapshot.strategyStats).length).toBeGreaterThan(0);
  });

  it('does nothing when persistPath is not set', () => {
    const engine = new VaiEngine(); // no options
    engine.train('Test data.', 'user-taught', 'en');
    engine.flushPersist(); // should not throw
    expect(engine.persistenceFile).toBeNull();
  });

  it('handles corrupt persistence file gracefully', () => {
    fs.writeFileSync(persistPath, '{ broken json !!!', 'utf-8');
    // Should not throw, just skip loading
    const engine = new VaiEngine({ persistPath });
    expect(engine.knowledge.entryCount).toBeGreaterThan(0); // has bootstrap
  });

  it('handles wrong version gracefully', () => {
    fs.writeFileSync(persistPath, JSON.stringify({ version: 999, learnedEntries: [] }), 'utf-8');
    const engine = new VaiEngine({ persistPath });
    // Should skip loading but still work
    expect(engine.knowledge.entryCount).toBeGreaterThan(0);
  });

  it('creates directory if it does not exist', () => {
    const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'vai-knowledge.json');
    const engine = new VaiEngine({ persistPath: deepPath });
    engine.teach('deep dir topic', 'Deep directory test response.', 'user-taught', 'en');
    engine.flushPersist();
    expect(fs.existsSync(deepPath)).toBe(true);
  });

  it('atomic write — no partial file on disk', () => {
    const engine = new VaiEngine({ persistPath });
    engine.teach('atomic topic', 'Atomic write test response.', 'user-taught', 'en');
    engine.flushPersist();

    // The .tmp file should not exist after successful write
    expect(fs.existsSync(persistPath + '.tmp')).toBe(false);
    // The actual file should be valid JSON
    const snapshot = JSON.parse(fs.readFileSync(persistPath, 'utf-8'));
    expect(snapshot.version).toBe(1);
  });

  it('accumulates knowledge across multiple persist cycles', () => {
    // Cycle 1
    const engine1 = new VaiEngine({ persistPath });
    engine1.teach('topic a', 'Response A is about the first topic.', 'user-taught', 'en');
    engine1.flushPersist();

    // Cycle 2 — load + add more
    const engine2 = new VaiEngine({ persistPath });
    engine2.teach('topic b', 'Response B is about the second topic.', 'user-taught', 'en');
    engine2.flushPersist();

    // Cycle 3 — should have both
    const engine3 = new VaiEngine({ persistPath });
    const matchA = engine3.knowledge.findBestMatch('topic a');
    const matchB = engine3.knowledge.findBestMatch('topic b');
    expect(matchA).not.toBeNull();
    expect(matchA!.response).toBe('Response A is about the first topic.');
    expect(matchB).not.toBeNull();
    expect(matchB!.response).toBe('Response B is about the second topic.');
  });
});
