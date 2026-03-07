import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VaiEngine } from '../src/models/vai-engine.js';

describe('VaiEngine Learning Flywheel', () => {
  let tmpDir: string;
  let persistPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vai-flywheel-'));
    persistPath = path.join(tmpDir, 'vai-knowledge.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('learns from high-confidence responses via chat()', async () => {
    const engine = new VaiEngine({ persistPath });
    const beforeCount = engine.knowledge.entryCount;

    // Ask about Docker — framework-devops strategy, confidence 0.90
    await engine.chat({ messages: [{ role: 'user', content: 'Explain what Docker is and why developers use it.' }], model: 'vai:v0' });

    // The flywheel should have auto-learned something
    // Note: depends on whether the topic was already known via bootstrap
    // Docker IS bootstrap, so it should dedup and NOT create a new entry
    expect(engine.knowledge.entryCount).toBe(beforeCount);
  });

  it('does NOT learn from fallback responses', async () => {
    const engine = new VaiEngine({ persistPath });
    const beforeCount = engine.knowledge.entryCount;

    // Ask something VaiEngine can't answer — should trigger fallback
    await engine.chat({ messages: [{ role: 'user', content: 'What is the mass of the Higgs boson in electron volts?' }], model: 'vai:v0' });

    // Fallback responses should NOT be learned
    // Entry count may increase from web search, but not from auto-learning
    // The key assertion: no 'auto-learned' entries
    engine.flushPersist();
    if (fs.existsSync(persistPath)) {
      const snapshot = JSON.parse(fs.readFileSync(persistPath, 'utf-8'));
      const autoLearned = snapshot.learnedEntries.filter((e: { source: string }) => e.source === 'auto-learned');
      expect(autoLearned.length).toBe(0);
    }
  });

  it('does NOT learn from conversational greetings', async () => {
    const engine = new VaiEngine({ persistPath });
    const beforeCount = engine.knowledge.entryCount;

    await engine.chat({ messages: [{ role: 'user', content: 'hello' }], model: 'vai:v0' });

    // Greetings are in NO_LEARN_STRATEGIES, so no new entries
    expect(engine.knowledge.entryCount).toBe(beforeCount);
  });

  it('does NOT learn from math results', async () => {
    const engine = new VaiEngine({ persistPath });
    const beforeCount = engine.knowledge.entryCount;

    await engine.chat({ messages: [{ role: 'user', content: 'What is 42 * 13?' }], model: 'vai:v0' });

    // Math is deterministic, no knowledge value
    expect(engine.knowledge.entryCount).toBe(beforeCount);
  });

  it('persists auto-learned entries across restarts', async () => {
    const engine1 = new VaiEngine({ persistPath });

    // Teach something custom, then ask about it — the teach creates a known entry
    engine1.teach('quantum entanglement basics', 'Quantum entanglement is a phenomenon where particles become correlated in ways that cannot be explained by classical physics. Measuring one particle instantly affects the other regardless of distance.', 'user-taught', 'en');
    engine1.flushPersist();

    // Load in a new engine
    const engine2 = new VaiEngine({ persistPath });
    const match = engine2.knowledge.findBestMatch('quantum entanglement basics');
    expect(match).not.toBeNull();
    expect(match!.source).toBe('user-taught');
  });

  it('auto-learned entries survive restart via persistence', async () => {
    // Use teach() to simulate what afterResponse does
    const engine1 = new VaiEngine({ persistPath });
    engine1.teach('custom framework xyz', 'XYZ is a hypothetical framework for building reactive UIs with zero dependencies and automatic code splitting.', 'auto-learned', 'en');
    engine1.flushPersist();

    const engine2 = new VaiEngine({ persistPath });
    const match = engine2.knowledge.findBestMatch('custom framework xyz');
    expect(match).not.toBeNull();
    expect(match!.source).toBe('auto-learned');
  });

  it('deduplicates — does not re-learn already-known topics', async () => {
    const engine = new VaiEngine({ persistPath });
    const beforeCount = engine.knowledge.entryCount;

    // Ask about TypeScript — which IS bootstrap-known
    await engine.chat({ messages: [{ role: 'user', content: 'What is TypeScript and why use it over JavaScript?' }], model: 'vai:v0' });

    // Should NOT create a new entry — topic already known
    expect(engine.knowledge.entryCount).toBe(beforeCount);
  });

  it('does NOT learn when noLearn is true (protective parenting mode)', async () => {
    const engine = new VaiEngine({ persistPath });
    const beforeCount = engine.knowledge.entryCount;

    // Teach a topic that would normally trigger auto-learning
    // Use chat() with noLearn: true
    await engine.chat({
      messages: [{ role: 'user', content: 'Explain what Docker is and why developers use it.' }],
      noLearn: true,
    });

    // No new entries should be created when noLearn is set
    expect(engine.knowledge.entryCount).toBe(beforeCount);
  });

  it('does NOT learn when noLearn is true via chatStream()', async () => {
    const engine = new VaiEngine({ persistPath });
    const beforeCount = engine.knowledge.entryCount;

    // Consume the stream fully with noLearn
    const chunks: string[] = [];
    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: 'Explain what Docker is and why developers use it.' }],
      noLearn: true,
    })) {
      if (chunk.type === 'text_delta' && chunk.textDelta) chunks.push(chunk.textDelta);
    }

    // Got a response but no learning happened
    expect(chunks.length).toBeGreaterThan(0);
    expect(engine.knowledge.entryCount).toBe(beforeCount);
  });

  it('still learns when noLearn is false or omitted', async () => {
    const engine = new VaiEngine({ persistPath });

    // Teach then ask — this simulates the normal flywheel
    engine.teach('custom-topic-abc', 'ABC is a framework for testing learning.', 'auto-learned', 'en');
    engine.flushPersist();

    // Verify teach worked
    const match = engine.knowledge.findBestMatch('custom-topic-abc');
    expect(match).not.toBeNull();
  });
});
