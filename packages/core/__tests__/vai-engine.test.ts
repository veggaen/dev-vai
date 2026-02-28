import { describe, it, expect, beforeEach } from 'vitest';
import { VaiEngine, VaiTokenizer, KnowledgeStore } from '../src/models/vai-engine.js';

describe('VaiTokenizer', () => {
  it('encodes and decodes text', () => {
    const tokenizer = new VaiTokenizer();
    const ids = tokenizer.encode('hello world');
    expect(ids.length).toBeGreaterThan(0);
    expect(tokenizer.vocabSize).toBeGreaterThan(4); // 4 special tokens + words
  });

  it('expands vocabulary with new words', () => {
    const tokenizer = new VaiTokenizer();
    const before = tokenizer.vocabSize;
    tokenizer.encode('this is a completely new sentence with unique words');
    expect(tokenizer.vocabSize).toBeGreaterThan(before);
  });

  it('exports and imports vocabulary', () => {
    const t1 = new VaiTokenizer();
    t1.encode('hello world foo bar');
    const exported = t1.exportVocab();

    const t2 = new VaiTokenizer();
    t2.importVocab(exported);
    expect(t2.vocabSize).toBe(t1.vocabSize);
  });
});

describe('KnowledgeStore', () => {
  let store: KnowledgeStore;

  beforeEach(() => {
    store = new KnowledgeStore();
  });

  it('learns from text and builds n-grams', () => {
    store.learn('the cat sat on the mat', 'test');
    expect(store.ngramCount).toBeGreaterThan(0);
  });

  it('generates text from n-grams', () => {
    // Feed it enough data to have some continuations
    store.learn('the quick brown fox jumps over the lazy dog', 'test');
    store.learn('the quick brown fox runs fast', 'test');
    const output = store.generateFromNgrams('the quick', 5);
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('brown'); // should predict "brown" after "the quick"
  });

  it('adds and finds knowledge entries', () => {
    store.addEntry('what is vai', 'VAI is VeggaAI', 'test');
    const match = store.findBestMatch('what is vai');
    expect(match).not.toBeNull();
    expect(match!.response).toBe('VAI is VeggaAI');
  });

  it('returns null for unrelated queries', () => {
    store.addEntry('what is vai', 'VAI is VeggaAI', 'test');
    const match = store.findBestMatch('quantum physics entanglement');
    expect(match).toBeNull();
  });

  it('exports and imports data', () => {
    store.learn('hello world this is a test', 'test');
    store.addEntry('hi', 'hello there', 'test');
    const data = store.exportData();

    const store2 = new KnowledgeStore();
    store2.importData(data);
    expect(store2.entryCount).toBe(1);
    expect(store2.ngramCount).toBe(store.ngramCount);
  });
});

describe('VaiEngine', () => {
  let engine: VaiEngine;

  beforeEach(() => {
    engine = new VaiEngine();
  });

  it('responds to greetings in English', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(response.message.content).toContain('VeggaAI');
    expect(response.finishReason).toBe('stop');
  });

  it('responds to greetings in Norwegian', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'hei' }],
    });
    expect(response.message.content).toContain('VeggaAI');
  });

  it('learns from training data and uses it', async () => {
    engine.train(
      'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript',
      'test-corpus',
      'en',
    );

    const stats = engine.getStats();
    expect(stats.ngramContexts).toBeGreaterThan(0);
    expect(stats.vocabSize).toBeGreaterThan(10);
  });

  it('streams responses word by word', async () => {
    const chunks: string[] = [];
    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: 'what are you' }],
    })) {
      if (chunk.type === 'text_delta' && chunk.textDelta) {
        chunks.push(chunk.textDelta);
      }
    }
    expect(chunks.length).toBeGreaterThan(1);
    const fullText = chunks.join('');
    expect(fullText).toContain('VeggaAI');
  });

  it('honestly says when it does not know something', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'explain quantum chromodynamics in detail' }],
    });
    // Should admit it hasn't learned enough
    expect(response.message.content).toMatch(/learn|train|teach|know/i);
  });

  it('reports stats accurately', () => {
    const stats = engine.getStats();
    expect(stats.vocabSize).toBeGreaterThan(0);
    expect(stats.knowledgeEntries).toBeGreaterThan(0); // bootstrap entries
  });

  // ─── BINARY DECODE TESTS ───────────────────────────────────────
  it('decodes binary sequences to ASCII', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: '01010010 01001001 01010011 01001011' }],
    });
    expect(response.message.content).toContain('RISK');
  });

  it('decodes binary with decode prefix', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'decode binary 01001000 01001001' }],
    });
    expect(response.message.content).toContain('HI');
  });

  // ─── CURRENT EVENTS TESTS ─────────────────────────────────────
  it('knows Circle K CEO is Alex Miller', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'who is the CEO of Circle K' }],
    });
    expect(response.message.content).toMatch(/alex\s+miller/i);
  });

  it('knows about Anthropic Pentagon situation', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'what happened with Anthropic and the Pentagon' }],
    });
    expect(response.message.content).toMatch(/pentagon|supply\s+chain|hegseth|contract/i);
  });

  it('knows about Hommersåk Norway', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'tell me about Hommersåk' }],
    });
    expect(response.message.content).toMatch(/norway|rogaland|sandnes|temperature/i);
  });

  // ─── ADVANCED CODE GENERATION TESTS ────────────────────────────
  it('generates TypeScript union types', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'create a TypeScript type PentagonStatus with variants: Active, UnderReview, Suspended, Terminated, Replaced' }],
    });
    expect(response.message.content).toContain('PentagonStatus');
    expect(response.message.content).toContain('typescript');
  });

  it('generates Rust enums with impl', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'create a Rust enum AnthropicAccess with variants: Allowed, Blocked, UnderReview' }],
    });
    expect(response.message.content).toContain('AnthropicAccess');
    expect(response.message.content).toContain('is_allowed');
    expect(response.message.content).toContain('rust');
  });

  it('generates C++ classes', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'create a C++ class SecurityGateway with private access control' }],
    });
    expect(response.message.content).toContain('SecurityGateway');
    expect(response.message.content).toContain('private');
    expect(response.message.content).toContain('cpp');
  });

  it('generates C access control programs', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'create a C program that checks access control' }],
    });
    expect(response.message.content).toContain('GRANTED');
    expect(response.message.content).toContain('DENIED');
  });

  // ─── SPEED TEST ────────────────────────────────────────────────
  it('streams responses in fast chunks', async () => {
    const start = Date.now();
    const chunks: string[] = [];
    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      if (chunk.type === 'text_delta' && chunk.textDelta) {
        chunks.push(chunk.textDelta);
      }
    }
    const elapsed = Date.now() - start;
    // Should complete in under 500ms for a short response (was ~15ms * wordCount before)
    expect(elapsed).toBeLessThan(500);
    expect(chunks.length).toBeGreaterThan(0);
  });
});
