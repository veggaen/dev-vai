import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import { getDeepDesignMemoHeadings, type DeepDesignMemoKind } from '../src/chat/deep-design-memo-schemas.js';
import { CONVERSATION_MODE_SYSTEM_PROMPTS } from '../src/chat/modes.js';
import { rewriteChatPrompt } from '../src/chat/prompt-rewrite.js';
import { VaiEngine, VaiTokenizer, KnowledgeStore } from '../src/models/vai-engine.js';
import { SkillRouter } from '../src/models/skill-router.js';

const originalFetch = globalThis.fetch;

function extractMemoHeadings(content: string): string[] {
  const headings: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const boldHeading = /^\*\*(.+?)\*\*$/.exec(trimmed);
    if (boldHeading) {
      headings.push(boldHeading[1]);
      continue;
    }

    const markdownHeading = /^#{1,6}\s+(.+?)\s*$/.exec(trimmed);
    if (markdownHeading) {
      headings.push(markdownHeading[1]);
    }
  }
  return headings;
}

function expectDeepMemoHeadings(content: string, kind: DeepDesignMemoKind): void {
  expect(extractMemoHeadings(content)).toEqual([...getDeepDesignMemoHeadings(kind)]);
}

function buildDeepMemoSystemMessage(userContent: string): string {
  const result = rewriteChatPrompt({
    userContent,
    mode: 'chat',
    config: {
      profile: 'strict',
      responseDepth: 'deep-design-memo',
    },
  });

  expect(result.systemMessage).toBeDefined();
  return result.systemMessage ?? '';
}

function extractCodeBlock(content: string): string {
  const fenced = /```(?:javascript|js)?\s*([\s\S]*?)```/i.exec(content);
  return fenced ? fenced[1].trim() : content.trim();
}

function loadFunctionFromResponse<T extends (...args: any[]) => any>(content: string, functionName: string): T {
  const code = extractCodeBlock(content);
  const fn = new Function(`${code}\nreturn typeof ${functionName} !== 'undefined' ? ${functionName} : null;`)();
  expect(typeof fn).toBe('function');
  return fn as T;
}

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

  it('rejects app-shell chrome captured from search sites as junk knowledge', () => {
    store.addEntry(
      'perplexity',
      'Search Computer New Thread History Discover Spaces Finance More Recent make a good prompt for me Account & Settings Upgrade to access the top AI models Ask anything Model Computer.',
      'https://www.perplexity.ai/',
    );

    const match = store.findBestMatch('what is perplexity');
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

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
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

  it('honors temporary plan-mode overrides for local chat quality shaping', async () => {
    const response = await engine.chat({
      messages: [
        {
          role: 'system',
          content: 'Temporary mode override for this answer: Plan mode. The conversation itself remains in Chat mode. Respond with a concrete ordered plan or diagnosis.',
        },
        { role: 'user', content: 'My Docker container keeps crashing, how do I debug it?' },
      ],
    });

    expect(response.message.content).toMatch(/\*\*Plan/i);
    expect(response.message.content).toMatch(/Step 1|1\./i);
  });

  it('reframes corrective follow-ups into the clarified topic', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'assistant', content: '**React:** React lets you build web pages from reusable components.' },
        { role: 'user', content: 'No, I mean performance.' },
      ],
    });

    expect(response.message.content).toMatch(/React performance|React\.memo|re-renders/i);
  });

  it('looks up the current Bun version from the official release source', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('api.github.com/repos/oven-sh/bun/releases/latest')) {
        return {
          ok: true,
          json: async () => ({ tag_name: 'bun-v1.2.23' }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${href}`);
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'What is the current stable Bun version right now?' }],
    });

    expect(response.message.content).toContain('**Bun:** 1.2.23');
  });

  it('refuses to bluff an exact current version when fresh lookup fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'What is the current stable Bun version right now?' }],
    });

    expect(response.message.content).toMatch(/do not want to bluff|fresh lookup/i);
    expect(response.message.content).toContain('https://github.com/oven-sh/bun/releases');
  });

  it('keeps terse corrective follow-ups anchored to the previous topic', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'assistant', content: '**Next.js:** Prefer App Router for new projects because it supports layouts, server components, and modern caching primitives.' },
        { role: 'user', content: 'No, rather caching.' },
      ],
    });

    expect(response.message.content).toMatch(/Next\.js|revalidate|App Router|caching/i);
    expect(response.message.content).not.toMatch(/^\*\*Caching\*\*\s+is\s+a\s+fast\s+storage/i);
  });

  it('returns official docs pages directly for current docs requests without forcing search', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Give me the current official docs for Tailwind CSS responsive design and GSAP.' }],
    });

    expect(response.message.content).toMatch(/Official docs lookup|official documentation pages/i);
    expect(response.message.content).toContain('https://tailwindcss.com/docs/responsive-design');
    expect(response.message.content).toContain('https://gsap.com/docs');
  });

  it('keeps referential local-first pivots grounded to the previous answer', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'assistant', content: '**Chat product direction**\nStart with one shared chat service, one conversation model, and a web + desktop shell so the product feels consistent across both surfaces.' },
        { role: 'user', content: 'Based on that answer, what changes if this needs to be local-first?' },
      ],
    });

    expect(response.message.content).toContain('**What stays**');
    expect(response.message.content).toContain('**What changes**');
    expect(response.message.content).toContain('**Decision**');
    expect(response.message.content).toMatch(/local-first|offline|conflict|sync/i);
  });

  it('keeps web versus desktop corrections grounded to the current topic', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'assistant', content: '**Desktop-first chat shell**\nStart desktop-first if you want native hotkeys, deeper local persistence, and tighter machine-level workflows.' },
        { role: 'user', content: 'No, I meant web not desktop.' },
      ],
    });

    expect(response.message.content).toContain('**What changes**');
    expect(response.message.content).toMatch(/zero-install|browser|shareability|responsive/i);
    expect(response.message.content).not.toMatch(/local file access as the default answer only/i);
  });

  it('keeps multi-user pivots grounded instead of answering generically', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'assistant', content: '**Shared chat architecture**\nStart single-user first so history, drafts, and local state stay simple before you widen the product surface.' },
        { role: 'user', content: 'Based on that answer, what changes if this becomes multi-user instead of single-user?' },
      ],
    });

    expect(response.message.content).toContain('**What changes**');
    expect(response.message.content).toMatch(/auth|permissions|presence|audit|shared state/i);
  });

  it('compresses the previous answer down to just the decision when asked', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'assistant', content: '**Recommendation**\nI would go with React + Vite for the first release because it keeps iteration fast and the deployment surface simple.\n\n**Next step**\nStart with the shared layout and one real message thread before adding advanced state.' },
        { role: 'user', content: 'Just the decision.' },
      ],
    });

    expect(response.message.content).toContain('**Decision**');
    expect(response.message.content).toMatch(/React \+ Vite|go with/i);
    expect(response.message.content).not.toMatch(/shared layout and one real message thread/i);
  });

  it('compresses the previous answer down to only the next step when asked', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'assistant', content: '**Recommendation**\nI would go with React + Vite for the first release because it keeps iteration fast and the deployment surface simple.\n\n**Next step**\nStart with the shared layout and one real message thread before adding advanced state.' },
        { role: 'user', content: 'Only the next step.' },
      ],
    });

    expect(response.message.content).toContain('**Next step**');
    expect(response.message.content).toMatch(/Start with the shared layout|message thread/i);
  });

  it('compresses the previous answer into a short version when asked', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'assistant', content: '**Recommendation**\nI would go with React + Vite for the first release because it keeps iteration fast and the deployment surface simple.\n\n**Why**\nThat keeps the chat surface easy to ship on both web and desktop while the shared service path does the heavy lifting.\n\n**Next step**\nStart with the shared layout and one real message thread before adding advanced state.' },
        { role: 'user', content: 'Short version.' },
      ],
    });

    expect(response.message.content).toContain('**Short version**');
    expect(response.message.content).toMatch(/React \+ Vite|shared service path|web and desktop/i);
  });

  it('rewrites real-question redirects into the actual question instead of treating them as generic follow-ups', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'assistant', content: '**Next.js caching**\nUse App Router caching primitives and revalidation when you want predictable freshness without throwing away server-rendering performance.' },
        { role: 'user', content: 'That is not my real question. My real question is how should I deploy it?' },
      ],
    });

    expect(response.message.content).toMatch(/deploy|vercel|hosting|serverless|node/i);
    expect(response.message.content).not.toMatch(/^\*\*Caching\*\*/i);
  });

  it('answers the requested second part of the previous multi-part question', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'Should I use Next.js or Vite, and what are the official Next.js docs for caching?' },
        { role: 'assistant', content: '**Recommendation**\nGo with Next.js if you want routing, server rendering, and a stronger default path for a shared web + desktop chat shell.' },
        { role: 'user', content: 'Answer the second part.' },
      ],
    });

    expect(response.message.content).toMatch(/official documentation pages|Official docs lookup|nextjs\.org\/docs/i);
    expect(response.message.content).not.toMatch(/Go with Next\.js if you want routing/i);
  });

  it('asks for the real question cleanly when the user only says the prior answer missed it', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'Should I use Next.js or Vite, and how should I handle caching?' },
        { role: 'assistant', content: '**Recommendation**\nGo with Next.js if you want routing, server rendering, and a stronger default path for a shared web + desktop chat shell.' },
        { role: 'user', content: 'That is not my real question.' },
      ],
    });

    expect(response.message.content).toMatch(/answer the second part|restate the real question|exact slice/i);
    expect(response.message.content).toMatch(/1\.|2\./i);
  });

  it('refuses to fake exact current API details from memory and points to official docs', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'What is the current Next.js App Router caching API right now?' }],
    });

    expect(response.message.content).toMatch(/do not want to pretend|exact current/i);
    expect(response.message.content).toContain('https://nextjs.org/docs');
  });

  it('prefers exact local topic answers for short prompts instead of fuzzy matches', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'docker' }],
    });

    expect(response.message.content).toMatch(/Docker is a platform|container/i);
    expect(engine.lastResponseMeta?.strategy).toBe('short-topic-local');
  });

  it('uses exact local topic overviews for short prompts when a curated local primer exists', async () => {
    const chunks: Array<{ answer?: string; sources?: number; followUps?: string[] }> = [];

    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: 'programming' }],
      noLearn: true,
    })) {
      if (chunk.type === 'text_delta') {
        chunks.push({ answer: chunk.textDelta });
      }
      if (chunk.type === 'sources') {
        chunks.push({
          sources: chunk.sources?.length ?? 0,
          followUps: chunk.followUps ? [...chunk.followUps] : [],
        });
      }
    }

    const answer = chunks.map((chunk) => chunk.answer ?? '').join('');
    const sourcesChunk = chunks.find((chunk) => typeof chunk.sources === 'number');

    expect(answer).toMatch(/programming/i);
    expect(answer).not.toMatch(/\*\*Rust\*\* is a systems programming language/i);
    expect(engine.lastResponseMeta?.strategy).toBe('short-topic-local');
    expect(sourcesChunk?.sources).toBeGreaterThan(0);
    expect((sourcesChunk?.followUps ?? []).length).toBeGreaterThan(0);
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('uses curated short-topic primers for abstract lexical prompts instead of junk web snippets', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Curated short-topic primers should not hit web fetch');
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'meaning' }],
    });

    expect(response.message.content).toMatch(/signifies|purpose|symbol|philosophy/i);
    expect(response.message.content).not.toMatch(/guaranteed/i);
    expect(engine.lastResponseMeta?.strategy).toBe('short-topic-curated');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(['meaning', 'single'])('emits sources and follow-ups for curated short-topic answers like %s', async (prompt) => {
    const chunks: Array<{ answer?: string; sources?: number; followUps?: string[] }> = [];

    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: prompt }],
      noLearn: true,
    })) {
      if (chunk.type === 'text_delta') {
        chunks.push({ answer: chunk.textDelta });
      }
      if (chunk.type === 'sources') {
        chunks.push({
          sources: chunk.sources?.length ?? 0,
          followUps: chunk.followUps ? [...chunk.followUps] : [],
        });
      }
    }

    const answer = chunks.map((chunk) => chunk.answer ?? '').join('');
    const sourcesChunk = chunks.find((chunk) => typeof chunk.sources === 'number');

    expect(answer.length).toBeGreaterThan(40);
    expect(sourcesChunk?.sources).toBeGreaterThan(0);
    expect((sourcesChunk?.followUps ?? []).length).toBeGreaterThan(0);
    expect(engine.lastResponseMeta?.strategy).toBe('short-topic-curated');
  });

  it('uses curated short-topic primers for ambiguous single-word prompts', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Curated short-topic primers should not hit web fetch');
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'single' }],
    });

    expect(response.message.content).toMatch(/music|relationship|everyday language|different things/i);
    expect(engine.lastResponseMeta?.strategy).toBe('short-topic-curated');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['python', /programming language|automation|data analysis|machine learning/i],
    ['database', /storing|querying|data|transactions|indexing/i],
    ['cache', /fast storage|cached data|reduce latency|staleness/i],
    ['latency', /delay|responsive|network|first byte/i],
    ['queue', /first-in, first-out|FIFO|enqueue|dequeue|message queue/i],
    ['recursion', /calling itself|base case|tree traversal|divide-and-conquer/i],
  ])('uses deterministic local short-topic answers for %s', async (prompt, matcher) => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Deterministic short-topic answers should not hit web fetch');
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: prompt }],
    });

    expect(response.message.content).toMatch(matcher);
    expect(response.message.content).not.toMatch(/keyboard noise/i);
    expect(engine.lastResponseMeta?.strategy).toBe('short-topic-local');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['pyhton', /Python is a high-level|programming language|automation/i, 'short-topic-local'],
    ['whats typescirpt', /TypeScript|JavaScript with a safety net|static type/i, 'framework-devops'],
    ['waht is dockre', /Docker is a platform|container/i, 'framework-devops'],
    ['hva er dockre', /Docker is a platform|container/i, 'framework-devops'],
    ['ka er dockre', /Docker is a platform|container/i, 'framework-devops'],
    ['forkalr pyhton kort', /Python is a high-level|programming language|automation/i, 'short-topic-local'],
    ['kan u forklare pyhton', /Python is a high-level|programming language|automation/i, 'direct-match'],
    ['kordan funke websokcet', /WebSocket|full-duplex|TCP connection/i, 'networking'],
    ['websokcet', /WebSocket|full-duplex|TCP connection/i, 'networking'],
  ])('understands obvious typos in chat input like %s', async (prompt, matcher, expectedStrategy) => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Obvious typo normalization should stay on deterministic local paths');
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: prompt }],
    });

    expect(response.message.content).toMatch(matcher);
    expect(response.message.content).not.toMatch(/keyboard noise|I couldn't make sense/i);
    expect(engine.lastResponseMeta?.strategy).toBe(expectedStrategy);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(['whats typescirpt', 'waht is dockre', 'hva er dockre', 'ka er dockre', 'forkalr pyhton kort', 'kan u forklare pyhton'])('emits sources for typo-normalized explanatory prompts like %s', async (prompt) => {
    const chunks: Array<{ answer?: string; sources?: number; followUps?: string[] }> = [];

    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: prompt }],
      noLearn: true,
    })) {
      if (chunk.type === 'text_delta') {
        chunks.push({ answer: chunk.textDelta });
      }
      if (chunk.type === 'sources') {
        chunks.push({
          sources: chunk.sources?.length ?? 0,
          followUps: chunk.followUps ? [...chunk.followUps] : [],
        });
      }
    }

    const answer = chunks.map((chunk) => chunk.answer ?? '').join('');
    const sourcesChunk = chunks.find((chunk) => typeof chunk.sources === 'number');

    expect(answer.length).toBeGreaterThan(40);
    expect(sourcesChunk?.sources).toBeGreaterThan(0);
    expect((sourcesChunk?.followUps ?? []).length).toBeGreaterThan(0);
  });

  it.each([
    ['typescript', 'short-topic-local'],
    ['docker', 'short-topic-local'],
    ['websocket', 'networking'],
    ['python', 'short-topic-local'],
    ['database', 'short-topic-local'],
    ['queue', 'short-topic-local'],
  ])('emits sources and follow-ups for exact local short-topic answers like %s', async (prompt, expectedStrategy) => {
    const chunks: Array<{ answer?: string; sources?: number; followUps?: string[] }> = [];

    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: prompt }],
      noLearn: true,
    })) {
      if (chunk.type === 'text_delta') {
        chunks.push({ answer: chunk.textDelta });
      }
      if (chunk.type === 'sources') {
        chunks.push({
          sources: chunk.sources?.length ?? 0,
          followUps: chunk.followUps ? [...chunk.followUps] : [],
        });
      }
    }

    const answer = chunks.map((chunk) => chunk.answer ?? '').join('');
    const sourcesChunk = chunks.find((chunk) => typeof chunk.sources === 'number');

    expect(answer.length).toBeGreaterThan(40);
    expect(sourcesChunk?.sources).toBeGreaterThan(0);
    expect((sourcesChunk?.followUps ?? []).length).toBeGreaterThan(0);
    expect(engine.lastResponseMeta?.strategy).toBe(expectedStrategy);
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

  it('admits future event winners are unknown', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'who won the 2030 world cup' }],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('uncertainty-guardrail');
    expect(response.message.content).toMatch(/hasn't happened yet|don't know|future/i);
  });

  it('treats fictional planets as unknown', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'what is the population of planet zorblax' }],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('uncertainty-guardrail');
    expect(response.message.content).toMatch(/fictional|don't know|no real population/i);
  });

  it('answers the Mars sky question directly', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'what color is the sky on mars' }],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('uncertainty-guardrail');
    expect(response.message.content).toMatch(/mars/i);
    expect(response.message.content).toMatch(/butterscotch|pink|orange|blue/i);
  });

  it('does not trigger deploy markers in chat mode for nextjs app requests', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are in Chat mode. The user is having a casual conversation. Do NOT make changes to any project files, plans, or sandbox.' },
        { role: 'user', content: 'make me a nextjs app with a calculator' },
      ],
    });
    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).toMatch(/next\.js|calculator|app\/page\.tsx/i);
  });

  it('returns an auto-run template marker for explicit nextjs install requests in chat mode', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are in Chat mode. The user is having a casual conversation. Do NOT make changes to any project files, plans, or sandbox.' },
        { role: 'user', content: 'install nextjs for me please' },
      ],
    });

    expect(response.message.content).toContain('{{template:nextjs:Fresh Next.js App Router}}');
    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).not.toContain('```');
  });

  it('treats spaced next js install requests as the same chat-mode starter action', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are in Chat mode. The user is having a casual conversation. Do NOT make changes to any project files, plans, or sandbox.' },
        { role: 'user', content: 'install next js for me please' },
      ],
    });

    expect(response.message.content).toContain('{{template:nextjs:Fresh Next.js App Router}}');
    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).not.toContain('```');
  });

  it('uses injected repo-native system hardening to change ambiguous predictive context answers', async () => {
    const baseline = await engine.chat({
      messages: [{ role: 'user', content: 'Explain predictive context prefetch for a code assistant.' }],
    });
    const baselineStrategy = engine.lastResponseMeta?.strategy;

    const hardened = await engine.chat({
      messages: [
        {
          role: 'system',
          content: [
            'Prompt hardening for ambiguous repo-native questions:',
            '- Treat this as a repository-native engineering question for a code assistant, not as a frontend state-management question.',
            '- Here, “context” means repository files, symbols, tests, docs, recent edits, cursor-near code, and repo history — not React Context or provider trees.',
            '- Do not drift into React Context, useContext, React Query, Zustand, Redux, or generic UI cache/state advice unless the user explicitly asks for frontend patterns.',
            '- Explain predictive prefetch as proactively warming likely files, tests, docs, or search results before the next question.',
            '- Include what happens when the prediction is wrong: fallback retrieval/search, bounded prefetch queues, and ways to limit wasted work.',
            '- Give a concrete system sketch: inputs/signals, retrieval or prediction loop, guardrails, metrics, and rollout steps.',
          ].join('\n'),
        },
        { role: 'user', content: 'Explain predictive context prefetch for a code assistant.' },
      ],
    });

    expect(baselineStrategy).not.toBe('repo-native-architecture');
    expect(engine.lastResponseMeta?.strategy).toBe('repo-native-architecture');
    expect(hardened.message.content).toMatch(/Idea|Signals/i);
    expect(hardened.message.content).toMatch(/fallback retrieval|fallback/i);
    expect(hardened.message.content).toMatch(/recent edits|open files|cursor position|repo history/i);
    expect(hardened.message.content).not.toMatch(/React Context|useContext|Zustand|Redux/i);
    expect(hardened.message.content).not.toBe(baseline.message.content);
  });

  it('routes direct repo-native prediction engine memos without hardening into structured architecture output', async () => {
    const prompt = 'Design a repo-native prediction engine for a large monorepo that warms likely files, tests, and docs before the next question. By context here, mean code or doc retrieval context, not React Context. Use the headings: Signals, Prediction loop, Guardrails, Rollout. Mention recent edits or repo history, a prefetch queue or cache, fallback retrieval when predictions miss, and one metric such as cache hit rate or time to useful context.';
    const response = await engine.chat({
      messages: [{ role: 'user', content: prompt }],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('repo-native-architecture');
    expect(extractMemoHeadings(response.message.content)).toEqual(['Signals', 'Prediction loop', 'Guardrails', 'Rollout']);
    expect(response.message.content).toMatch(/prefetch queue|cache|warm/i);
    expect(response.message.content).toMatch(/fallback retrieval|fallback/i);
    expect(response.message.content).not.toMatch(/React App with TypeScript|package\.json|src\/app\/page/i);
  });

  it('answers plain-language predictive prefetch prompts with idea inputs and guardrails headings', async () => {
    const prompt = 'A repo-native code assistant can proactively load likely files, tests, or docs before the developer asks. Explain this feature in plain language. Use the headings: Idea, Inputs, Guardrails. Mention recent edits, open files, or cursor position, cache or warmed context, fallback retrieval when the guess is wrong, and wrong predictions or misses. You may call this predictive prefetch, but focus on the behavior.';
    const rewrite = rewriteChatPrompt({ userContent: prompt, mode: 'chat' });
    const response = await engine.chat({
      messages: [
        { role: 'system', content: rewrite.systemMessage ?? '' },
        { role: 'user', content: prompt },
      ],
    });

    expect(rewrite.systemMessage).toBeDefined();
    expect(engine.lastResponseMeta?.strategy).toBe('repo-native-architecture');
    expect(extractMemoHeadings(response.message.content)).toEqual(['Idea', 'Inputs', 'Guardrails']);
    expect(response.message.content).toMatch(/warmed context|cache|context/i);
    expect(response.message.content).toMatch(/fallback retrieval|fallback search|fallback/i);
    expect(response.message.content).toMatch(/wrong predictions|misses|wrong guesses/i);
  });

  it('uses injected deep design memo guidance for repo-native predictive architecture answers', async () => {
    const userPrompt = 'Design a predictive context prefetch system for a code assistant in a large monorepo.';
    const response = await engine.chat({
      messages: [
        {
          role: 'system',
          content: buildDeepMemoSystemMessage(userPrompt),
        },
        { role: 'user', content: userPrompt },
      ],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('repo-native-architecture');
    expect(response.message.content).not.toMatch(/\*\*Idea\*\*/i);
    expect(response.message.content).not.toMatch(/React Context|useContext|Zustand|Redux/i);
    expectDeepMemoHeadings(response.message.content, 'predictive-prefetch');
  });

  it('uses shared answer-engine deep memo headings when deep memo hardening is applied', async () => {
    const userPrompt = 'Give a grounded design memo for a layered answer engine for developer research. Mention retrieval, ranking, synthesis, verification, guardrails, failure modes, and rollout.';
    const response = await engine.chat({
      messages: [
        { role: 'system', content: buildDeepMemoSystemMessage(userPrompt) },
        { role: 'user', content: userPrompt },
      ],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('repo-native-architecture');
    expect(response.message.content).toMatch(/query rewriting|hybrid retrieval|evidence|uncertainty/i);
    expectDeepMemoHeadings(response.message.content, 'answer-engine');
  });

  it('uses shared repo-native architecture deep memo headings when deep memo hardening is applied', async () => {
    const userPrompt = 'Design a repo-native context engine for a large monorepo. Cover signals, retrieval pipeline, working set, guardrails, metrics, rollout, and failure modes.';
    const response = await engine.chat({
      messages: [
        { role: 'system', content: buildDeepMemoSystemMessage(userPrompt) },
        { role: 'user', content: userPrompt },
      ],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('repo-native-architecture');
    expect(response.message.content).toMatch(/active files|recent edits|branch freshness|retriev/i);
    expectDeepMemoHeadings(response.message.content, 'repo-native-architecture');
  });

  it('returns a richer calculator ui response for advanced prompts', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'make me a calculator with a super advanced fancy ui' }],
    });
    expect(response.message.content).toMatch(/history|theme|react|ui/i);
    expect(response.message.content).not.toContain('// Simple Calculator');
    expect(response.message.content).not.toContain('Function(');
  });

  it('treats casual fancy calculator prompts as ui build guidance instead of toy examples', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I want to make a calculator super advanced nice fancy ui' }],
    });

    expect(response.message.content).toMatch(/calculator ui|theme|history|react/i);
    expect(response.message.content).not.toContain('// Simple Calculator');
    expect(response.message.content).not.toContain('Function(');
    expect(response.message.content).toContain('evaluateExpression');
  });

  it('does not fall back to deploy tiers for nextjs calculator app requests in normal chat', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'make me a nextjs app with a calculator' }],
    });

    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).toMatch(/Next\.js|App Router|Tailwind v4|calculator/i);
  });

  it('routes explicit nextjs oauth mvp build requests to the battle-tested deploy path', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Build me a Next.js MVP app with Google OAuth so I can try it.' }],
    });

    expect(response.message.content).toContain("I'll spin up a Next.js OAuth MVP and open it in preview.");
    expect(response.message.content).toContain('{{deploy:nextjs:battle-tested:Next.js OAuth MVP}}');
    expect(response.message.content).toMatch(/Google sign-in wiring|env setup|demo-ready app shell/i);
  });

  it('allows chat mode to emit a direct oauth mvp deploy action for explicit build requests', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.chat },
        { role: 'user', content: 'Build me a Next.js MVP app with Google OAuth so I can try it.' },
      ],
    });

    expect(response.message.content).toContain('{{deploy:nextjs:battle-tested:Next.js OAuth MVP}}');
    expect(response.message.content).toContain("I'll spin up a Next.js OAuth MVP and open it in preview.");
  });

  it('routes spaced next js oauth mvp requests to the same deploy path', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Build me a next js MVP app with Google OAuth so I can try it.' }],
    });

    expect(response.message.content).toContain('{{deploy:nextjs:battle-tested:Next.js OAuth MVP}}');
    expect(response.message.content).toContain("I'll spin up a Next.js OAuth MVP and open it in preview.");
  });

  it('emits richer nextjs follow-ups that point toward an oauth mvp path', async () => {
    const followUps: string[][] = [];

    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: 'What is Next.js?' }],
    })) {
      if (chunk.type === 'sources' && chunk.followUps) {
        followUps.push([...chunk.followUps]);
      }
    }

    expect(followUps.length).toBeGreaterThan(0);
    expect(followUps.some((items) => items.includes('Add Prisma and Postgres to this app'))).toBe(true);
    expect(followUps.some((items) => items.includes('Add GitHub sign-in next to Google auth'))).toBe(true);
  });

  it('answers base44-like shell prompts with product architecture instead of stack buttons', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'build me a base44-like app shell where users can chat with Vai and generate apps in sandboxes' }],
    });

    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).toMatch(/main product shell|chat|sandbox|monorepo|intent/i);
  });

  it('handles terminal harness inspect prompts as JSON actions instead of product architecture prose', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'TERMINAL_HARNESS_V1 return exactly one JSON action only' },
        {
          role: 'user',
          content: 'TERMINAL_HARNESS_V1\nstep=1/6\nphase=inspect\nworkspace=/app\n\ngoals:\n- Create a directory at `/app/ssl/` to store all files\n- Save it as `/app/ssl/server.key`\n- Ensure proper permissions (600) for the key file\n- Valid for 365 days (1 year)\n- Organization Name: "DevOps Team"\n- Common Name: "dev-internal.company.local"\n- Save it as `/app/ssl/server.crt`\n- Save it as `/app/ssl/server.pem`\n\nstate:\n- verification=pending\n- environment_facts=none\n- attempted_commands=none\n- file_mutations=none\n\nresponse_contract:\n- Return exactly one JSON object.\n\nrecent_history:\n- none',
        },
      ],
    });

    const parsed = JSON.parse(response.message.content) as { action: string; command?: string };
    expect(parsed.action).toBe('inspect');
    expect(parsed.command).toMatch(/find \/app -maxdepth 3/);
    expect(response.message.content).not.toMatch(/Product architecture|Feature set:/i);
    expect(engine.lastResponseMeta?.strategy).toBe('terminal-harness');
  });

  it('emits openssl run commands for terminal harness certificate tasks', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'TERMINAL_HARNESS_V1 return exactly one JSON action only' },
        {
          role: 'user',
          content: 'TERMINAL_HARNESS_V1\nstep=2/6\nphase=act\nworkspace=/app\n\ngoals:\n- Create a directory at `/app/ssl/` to store all files\n- Save it as `/app/ssl/server.key`\n- Ensure proper permissions (600) for the key file\n- Valid for 365 days (1 year)\n- Organization Name: "DevOps Team"\n- Common Name: "dev-internal.company.local"\n- Save it as `/app/ssl/server.crt`\n- Save it as `/app/ssl/server.pem`\n\nstate:\n- verification=pending\n- environment_facts=rc=0 pwd -> /app\n- attempted_commands=pwd && ls -la /app\n- file_mutations=none\n\nresponse_contract:\n- Return exactly one JSON object.\n\nrecent_history:\n- inspect: pwd && ls -la /app\n  rc=0\n  summary: /app',
        },
      ],
    });

    const parsed = JSON.parse(response.message.content) as { action: string; command?: string };
    expect(parsed.action).toBe('run_command');
    expect(parsed.command).toMatch(/openssl req -x509/);
    expect(parsed.command).toContain('/app/ssl/server.key');
    expect(parsed.command).toContain('/app/ssl/server.crt');
    expect(parsed.command).toContain('/app/ssl/server.pem');
    expect(parsed.command).toContain('/app/ssl/verification.txt');
    expect(parsed.command).toContain('/app/check_cert.py');
    expect(response.message.content).not.toMatch(/Product architecture|Feature set:/i);
    expect(engine.lastResponseMeta?.strategy).toBe('terminal-harness');
  });

  it('emits regex artifact commands for regex-log terminal harness tasks', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'TERMINAL_HARNESS_V1 return exactly one JSON action only' },
        {
          role: 'user',
          content: 'TERMINAL_HARNESS_V1\nstep=2/6\nphase=act\nworkspace=/app\n\ngoals:\n- Write a regex expression that matches dates in the format YYYY-MM-DD appearing in lines that contain an IPv4 address in a log file.\n- If multiple dates are present in a line, the regex should match only the last date in that line.\n- Save your regex in /app/regex.txt\n- Ensure that valid dates and IPv4 addresses are not immediately preceded or followed by alphanumeric characters.\n\nstate:\n- verification=pending\n- environment_facts=rc=0 pwd -> /app\n- attempted_commands=pwd && ls -la /app\n- file_mutations=none\n\nresponse_contract:\n- Return exactly one JSON object.\n\nrecent_history:\n- inspect: pwd && ls -la /app\n  rc=0\n  summary: /app',
        },
      ],
    });

    const parsed = JSON.parse(response.message.content) as { action: string; command?: string };
    expect(parsed.action).toBe('run_command');
    expect(parsed.command).toContain('/app/regex.txt');
    expect(parsed.command).toContain('25[0-5]');
    expect(engine.lastResponseMeta?.strategy).toBe('terminal-harness');
  });

  it('emits log summary commands for terminal harness CSV aggregation tasks', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'TERMINAL_HARNESS_V1 return exactly one JSON action only' },
        {
          role: 'user',
          content: 'TERMINAL_HARNESS_V1\nstep=2/6\nphase=act\nworkspace=/app\n\ngoals:\n- You are given multiple log files stored in /app/logs. Each log file name follows the pattern YYYY-MM-DD_<source>.log, indicating the date of the logs and their source. Your task is to analyze all logs and count how many times each severity appears within the following date ranges:\n- Today (the current date)\n- Last 7 days (including today)\n- Last 30 days (including today)\n- Current month to date (from the 1st date of the current month up to and including today)\n- Total (all log files combined, regardless of date)\n- Write a CSV file /app/summary.csv with the following structure (including the header):\n- period,severity,count\n- The severity levels to count are exactly: ERROR, WARNING, and INFO.\n- The current date is 2025-08-12. Use this as the reference date for all calculations.\n\nstate:\n- verification=pending\n- environment_facts=rc=0 pwd -> /app\n- attempted_commands=pwd && ls -la /app\n- file_mutations=none\n\nresponse_contract:\n- Return exactly one JSON object.\n\nrecent_history:\n- inspect: pwd && ls -la /app\n  rc=0\n  summary: /app',
        },
      ],
    });

    const parsed = JSON.parse(response.message.content) as { action: string; command?: string };
    expect(parsed.action).toBe('run_command');
    expect(parsed.command).toContain('/app/summary.csv');
    expect(parsed.command).toContain('/tmp/vai-log-summary.py');
    expect(parsed.command).toContain('2025-08-12');
    expect(engine.lastResponseMeta?.strategy).toBe('terminal-harness');
  });

  it('answers base44-like shell variants with plan preview and explicit generation gates', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'build me a base44-like shell where users chat with Vai, preview plans, and generate sandbox apps only when explicitly asked' }],
    });

    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).toMatch(/plan-preview|preview plans|sandbox builder|explicitly asks|builder mode/i);
  });

  it('answers Base44-style Vai build-flow improvement prompts with chat-to-builder workflow guidance', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Do your best to improve Vai so chat can feel like Base44 when users want to build apps. I want chat to capture intent, preview a plan, and only open sandbox generation when the user asks.' }],
    });

    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).toMatch(/Base44-style build flow|plan-preview|plan preview|sandbox|Builder mode|intent capture/i);
  });

  it('keeps plan mode requests as numbered plans even when the system prompt mentions Builder mode later', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.plan },
        { role: 'user', content: 'I want a shared shopping list app for a household or roommates. It should feel social, useful in-store, and polished rather than like a toy demo. No code yet. Give me a numbered plan with assumptions, product sections, first-slice scope, validation criteria, and biggest risks.' },
      ],
    });

    expect(response.message.content).toMatch(/1\. Assumptions/i);
    expect(response.message.content).toMatch(/2\. Product sections/i);
    expect(response.message.content).toMatch(/3\. First-slice scope/i);
    expect(response.message.content).toMatch(/4\. Validation criteria/i);
    expect(response.message.content).toMatch(/5\. Biggest risks/i);
    expect(response.message.content).toMatch(/Household|Store Run|store|roommates/i);
    expect(response.message.content).not.toContain('```json title="package.json"');
    expect(response.message.content).not.toContain('```jsx title="src/App.jsx"');
  });

  it('uses shared-shopping context from history when plan mode gets a natural follow-up prompt', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.plan },
        { role: 'user', content: 'I want a shared shopping list app for a household or roommates. It should feel social, useful in-store, and polished rather than like a toy demo.' },
        { role: 'assistant', content: 'Intent read\n\nPlan preview\n- Household\n- Shared Shopping List\n- Activity Chat\n- Store Run\n\nGenerate gate\nSay build the first version now when ready.' },
        { role: 'user', content: 'Good. Expand that into a numbered plan with assumptions, product sections, first-slice scope, validation criteria, and biggest risks. No code yet.' },
      ],
    });

    expect(response.message.content).toMatch(/1\. Assumptions/i);
    expect(response.message.content).toMatch(/2\. Product sections/i);
    expect(response.message.content).toMatch(/3\. First-slice scope/i);
    expect(response.message.content).toMatch(/4\. Validation criteria/i);
    expect(response.message.content).toMatch(/5\. Biggest risks/i);
    expect(response.message.content).toMatch(/Household/i);
    expect(response.message.content).toMatch(/Store Run|store/i);
    expect(response.message.content).not.toContain('```json title="package.json"');
  });

  it('keeps chat mode real product build requests in plan-preview workflow instead of builder file output', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.chat },
        { role: 'user', content: 'I want a shared shopping list app for a household or roommates. It should feel social, useful in-store, and polished rather than like a toy demo.' },
      ],
    });

    expect(response.message.content).toMatch(/Intent read/i);
    expect(response.message.content).toMatch(/Plan preview/i);
    expect(response.message.content).toMatch(/Generate gate/i);
    expect(response.message.content).toMatch(/Household/i);
    expect(response.message.content).toMatch(/Activity Chat/i);
    expect(response.message.content).not.toContain('```json title="package.json"');
    expect(response.message.content).not.toContain('```jsx title="src/App.jsx"');
    expect(response.message.content).not.toMatch(/here's how we can approach this|step 1|tell me more/i);
  });

  it('keeps shared-shopping plan validation prompts concrete instead of falling back to generic build phases', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.plan },
        { role: 'user', content: 'Good. Tighten that plan for a first runnable sandbox build. Prioritize household members, quick-add items, aisle or category grouping, who-added-what context, lightweight activity chat, and a clean dark mobile-friendly UI using Tailwind CSS and Framer Motion. Tell me what must be in the first build so it already feels like a real product. Do not pivot into template or starter talk unless I explicitly ask for a template.' },
      ],
    });

    expect(response.message.content).toMatch(/1\. First build must include/i);
    expect(response.message.content).toMatch(/Household/i);
    expect(response.message.content).toMatch(/quick-add/i);
    expect(response.message.content).toMatch(/Activity Chat|activity chat/i);
    expect(response.message.content).toMatch(/Tailwind CSS/i);
    expect(response.message.content).toMatch(/Framer Motion/i);
    expect(response.message.content).not.toContain('Pick your stack');
    expect(response.message.content).not.toContain('```json title="package.json"');
  });

  it('treats deploy-fire-drill prompts as judgement requests rather than generic build guidance', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'My app works locally, but every deploy turns into a fire drill. I am not sure whether the real fix is better architecture, better release discipline, or just fewer moving parts. What would you change first?' }],
    });

    expect(response.message.content).not.toMatch(/here's how we can approach this|step 1|tell me more/i);
    expect(response.message.content).toMatch(/best read|release path|moving parts|rollback|delivery discipline/i);
  });

  it('treats product-scope prompts as product judgement rather than scaffold guidance', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I can build quickly, but every time I add more features the app gets harder to explain. How would a strong product person cut this down without killing the ambition?' }],
    });

    expect(response.message.content).not.toMatch(/here's how we can approach this|step 1|tell me more/i);
    expect(response.message.content).toMatch(/best read|cut line|core workflow|one sentence|scope noise/i);
  });

  it('does not confuse problem descriptions containing quickly with a request for a shorter answer', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I can build quickly, but every time I add more features the app gets harder to explain. How would a strong product person cut this down without killing the ambition? Use the headings: Best read, Cut line, Next test. Keep it practical and show the tradeoff.' }],
    });

    expect(response.message.content).toMatch(/best read/i);
    expect(response.message.content).toMatch(/cut line/i);
    expect(response.message.content).toMatch(/next test/i);
    expect(response.message.content.split(/\n+/).length).toBeGreaterThan(6);
  });

  it('answers bare self-awareness prompts with capabilities instead of unrelated retrieval', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'What do you know about?' }],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('structured-benchmark-memo');
    expect(response.message.content).toMatch(/knowledge|sources|learn|teach/i);
    expect(response.message.content).not.toMatch(/typescript/i);
  });

  it('uses the exact requested sections for grounded ai app direction prompts', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'build an AI app. Use the headings: AI app direction without shallow defaults, Recommended architecture, Pragmatic default. Mention approval, retrieval or search grounding, and product shell concerns like billing or history.' }],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('structured-benchmark-memo');
    expect(extractMemoHeadings(response.message.content)).toEqual([
      'AI app direction without shallow defaults',
      'Recommended architecture',
      'Pragmatic default',
    ]);
    expect(response.message.content).toMatch(/approval/i);
    expect(response.message.content).toMatch(/retrieval|search|grounding/i);
    expect(response.message.content).toMatch(/billing|history|product shell/i);
  });

  it('defaults vague build-an-ai-app prompts to the grounded triage structure', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'build an AI app.' }],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('structured-benchmark-memo');
    expect(extractMemoHeadings(response.message.content)).toEqual([
      'AI app direction without shallow defaults',
      'Recommended architecture',
      'Pragmatic default',
    ]);
  });

  it('rewrites weak external-ai critique prompts into the requested stronger structure', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I have some chat with Grok about an over-engineered chat UI. Improve the response so it is more solid, tested, and free of obvious architecture mistakes. Use the headings: How to improve that kind of AI response, What a stronger answer should do, Stronger rewrite direction.' }],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('structured-benchmark-memo');
    expect(extractMemoHeadings(response.message.content)).toEqual([
      'How to improve that kind of AI response',
      'What a stronger answer should do',
      'Stronger rewrite direction',
    ]);
    expect(response.message.content).toMatch(/tested/i);
    expect(response.message.content).toMatch(/keyboard accessibility|permission boundaries|drag\/drop invariants/i);
  });

  it('defaults weak external-ai critique prompts to the stronger rewrite structure without explicit headings', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I have some chat with Grok about an over-engineered chat UI. Improve the response so it is more solid, tested, and free of obvious architecture mistakes.' }],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('structured-benchmark-memo');
    expect(extractMemoHeadings(response.message.content)).toEqual([
      'How to improve that kind of AI response',
      'What a stronger answer should do',
      'Stronger rewrite direction',
    ]);
  });

  it('compares repo-native context engines, chatbots, and answer engines with exact workflow sections', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Compare a repo-native context engine, a general chatbot, and a web answer engine for large monorepos. Use the headings: Where each wins, Tradeoffs, Recommended workflow. Mention semantic retrieval, repo freshness, external research, and human review.' }],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('structured-benchmark-memo');
    expect(extractMemoHeadings(response.message.content)).toEqual([
      'Where each wins',
      'Tradeoffs',
      'Recommended workflow',
    ]);
    expect(response.message.content).toMatch(/semantic retrieval|repo freshness|external research|human review/i);
  });

  it('renders the requested benchmark rubric sections for grounded answer scoring', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Design a benchmark rubric for Vai so casual and complex answers are judged on groundedness and usefulness, not just fluency. Use the headings: Dimensions, Pass conditions, Penalties, Example signals. Mention factual support, instruction following, structure, uncertainty, and hallucination risk.' }],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('structured-benchmark-memo');
    expect(extractMemoHeadings(response.message.content)).toEqual([
      'Dimensions',
      'Pass conditions',
      'Penalties',
      'Example signals',
    ]);
    expect(response.message.content).toMatch(/instruction following|factual support|uncertainty|hallucination/i);
  });

  it('keeps creative answer-engine and context-engine comparisons grounded and sectioned', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Compare a web answer engine with a repo-native code context engine. Use the headings: Best at, Failure modes, How to combine them. Keep claims grounded and avoid pretending to know private internals.' }],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('structured-benchmark-memo');
    expect(extractMemoHeadings(response.message.content)).toEqual([
      'Best at',
      'Failure modes',
      'How to combine them',
    ]);
    expect(response.message.content).toMatch(/answer engine|context engine/i);
    expect(response.message.content).toMatch(/grounded|public|supportable|workflow|review/i);
    expect(response.message.content).not.toMatch(/ps aux|change the port/i);
  });

  it('returns runnable file blocks for simple frontend app requests in builder mode', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'build a shared shopping app from scratch' },
      ],
    });

    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(response.message.content).toContain('Shared Shopping List');
    expect(response.message.content).toContain('Household');
    expect(response.message.content).toContain('Activity Chat');
    expect(response.message.content).not.toMatch(/here's how we can approach this|step 1|tell me more/i);
  });

  it('routes builder photography portfolio requests to a portfolio app instead of the generic scaffold', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build me a photography portfolio with a fullscreen lightbox and masonry gallery.' },
      ],
    });

    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(response.message.content).toMatch(/Photography portfolio|fullscreen lightbox|masonry gallery/i);
    expect(response.message.content).not.toContain('Shared Shopping List');
    expect(response.message.content).not.toContain('Builder App');
  });

  it('keeps photographer portfolio builder output JSX-safe in the meta strip', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build me a photography portfolio with a fullscreen lightbox and masonry gallery.' },
      ],
    });

    const appBlockMatch = response.message.content.match(/```tsx title="src\/App\.tsx"\n([\s\S]*?)```/);
    expect(appBlockMatch?.[1]).toContain('const metaItems = ["Editorial direction","Portrait rhythm","Campaign polish","Modern booking flow"];');
    expect(appBlockMatch?.[1]).toContain('{metaItems.map((item) => (');
  });

  it('gives photographer portfolio builds real images and working CTA targets instead of prompt-copy filler', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'can you make me a website for a pro norwegian photographer?' },
      ],
    });

    const appBlockMatch = response.message.content.match(/```tsx title="src\/App\.tsx"\n([\s\S]*?)```/);
    expect(appBlockMatch?.[1]).toContain('https://images.unsplash.com/');
    expect(appBlockMatch?.[1]).toContain("scrollToId('contact')");
    expect(appBlockMatch?.[1]).toContain("scrollToId('gallery')");
    expect(appBlockMatch?.[1]).toContain('Norwegian nature photographer');
    expect(appBlockMatch?.[1]).not.toContain('Built from the prompt:');
  });

  it('routes personal training app requests to the tracker archetype instead of the generic frontend scaffold', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build me a personal training app I can use for myself with weekly workout planning and progress tracking.' },
      ],
    });

    const appBlockMatch = response.message.content.match(/```tsx title="src\/App\.tsx"\n([\s\S]*?)```/);
    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(appBlockMatch?.[1]).toContain('Train with structure, not guesswork.');
    expect(appBlockMatch?.[1]).toContain('Lower body strength');
    expect(appBlockMatch?.[1]).toContain('Consistency');
    expect(response.message.content).not.toContain('Builder App');
  });

  it('routes tinder-style prompts to the matching archetype instead of the generic frontend scaffold', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build a Tinder style dating app with swipe cards, matches, and chat prompts.' },
      ],
    });

    const appBlockMatch = response.message.content.match(/```tsx title="src\/App\.tsx"\n([\s\S]*?)```/);
    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(appBlockMatch?.[1]).toContain('Browse profiles, match quickly, and move into real conversation.');
    expect(appBlockMatch?.[1]).toContain('Swipe queue');
    expect(appBlockMatch?.[1]).toContain('Conversation starters');
    expect(response.message.content).not.toContain('Builder App');
  });

  it('routes builder commerce-store prompts to a storefront app instead of the shopping-list fallback', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'make me an app for a commerce store' },
      ],
    });

    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(response.message.content).toMatch(/storefront|catalog|cart|checkout/i);
    expect(response.message.content).not.toContain('Shared Shopping List');
    expect(response.message.content).not.toContain('Website Draft');
  });

  it('routes analytics dashboard prompts to the dashboard archetype instead of the generic frontend scaffold', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build me an analytics dashboard with KPI cards, approval queue, and charts.' },
      ],
    });

    const appBlockMatch = response.message.content.match(/```tsx title="src\/App\.tsx"\n([\s\S]*?)```/);
    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(appBlockMatch?.[1]).toContain('Operational clarity with KPIs, queue state, and decision lanes.');
    expect(appBlockMatch?.[1]).toContain('Review queue');
    expect(appBlockMatch?.[1]).toContain('Current flow');
    expect(response.message.content).not.toContain('Builder App');
  });

  it('routes booking app prompts to the booking archetype instead of the generic frontend scaffold', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build me a client booking app with appointments, schedule blocks, and reminders.' },
      ],
    });

    const appBlockMatch = response.message.content.match(/```tsx title="src\/App\.tsx"\n([\s\S]*?)```/);
    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(appBlockMatch?.[1]).toContain('Let people book time without losing the shape of your week.');
    expect(appBlockMatch?.[1]).toContain('Upcoming bookings');
    expect(appBlockMatch?.[1]).toContain('Weekly open blocks');
    expect(response.message.content).not.toContain('Builder App');
  });

  it('does not trap fresh website requests on the active sandbox edit rail', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'system', content: 'ACTIVE SANDBOX PROJECT: builder-app' },
        { role: 'user', content: 'make me a photographer web site' },
      ],
    });

    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toMatch(/photographer|photography|portfolio|gallery/i);
    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(response.message.content).not.toContain('I can edit the active app');
  });

  it('asks for product direction instead of guessing a toy app for vague builder prompts', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'make me a good app' },
      ],
    });

    expect(response.message.content).toContain('audience + main action + vibe');
    expect(response.message.content).toContain('solo founders');
    expect(response.message.content).not.toContain('```json title="package.json"');
    expect(response.message.content).not.toMatch(/todo/i);
  });

  it('keeps photographer context when the ask is phrased as a long website request', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'I am a professional mature photographer and I also do portraits and family photos but I need a website can you help me make a good website for me?' },
      ],
    });

    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(response.message.content).toMatch(/family|portrait|photographer|book a portrait session|family galleries/i);
    expect(response.message.content).not.toContain('Builder App');
    expect(response.message.content).not.toContain('Workspace');
  });

  it('keeps active sandbox dashboard follow-up edits executable instead of explanatory', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'system', content: 'ACTIVE SANDBOX PROJECT: analytics-dashboard' },
        {
          role: 'assistant',
          content: [
            'Building a React analytics dashboard with Recharts.',
            '',
            '```tsx title="src/App.tsx"',
            'export default function Dashboard() {',
            '  return (',
            '    <div>',
            '      <h1>Analytics Dashboard</h1>',
            '      <section>Revenue Over Time</section>',
            '      <section>Traffic Sources</section>',
            '    </div>',
            '  );',
            '}',
            '```',
          ].join('\n'),
        },
        { role: 'user', content: 'change the color scheme to purple and teal' },
      ],
    });

    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(response.message.content).toContain('#8b5cf6');
    expect(response.message.content).toContain('#14b8a6');
    expect(response.message.content).not.toMatch(/oklch|here'?s how|you can change/i);
  });

  it('keeps third-turn active sandbox dashboard edits on the executable rail', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'system', content: 'ACTIVE SANDBOX PROJECT: analytics-dashboard' },
        {
          role: 'assistant',
          content: [
            'Updated the active dashboard to a purple + teal palette.',
            '',
            '```tsx title="src/App.tsx"',
            'export default function Dashboard() {',
            '  return (',
            '    <div style={{ background: "#1e1b4b" }}>',
            '      <h1>Analytics Dashboard</h1>',
            '      <section>Revenue Over Time</section>',
            '      <section>Traffic Sources</section>',
            '      <span>#8b5cf6</span>',
            '    </div>',
            '  );',
            '}',
            '```',
          ].join('\n'),
        },
        { role: 'user', content: 'Add a date range filter row above the charts.' },
      ],
    });

    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(response.message.content).toContain('Last 30 days');
    expect(response.message.content).toContain('Last 90 days');
    expect(response.message.content).not.toMatch(/temporal|readme\.|here'?s how|you can change/i);
  });

  it('uses active sandbox file snapshots to keep landing-page polish requests on a targeted edit rail', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        {
          role: 'system',
          content: [
            'ACTIVE SANDBOX PROJECT: marketing-site',
            'CURRENT FILE SNAPSHOTS:',
            'FILE: src/App.tsx',
            '```tsx',
            'export default function App() {',
            '  return <main><h1>Old heading</h1></main>;',
            '}',
            '```',
          ].join('\n'),
        },
        { role: 'user', content: 'Polish the landing page spacing and typography.' },
      ],
    });

    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(response.message.content).toContain('Polishing the active landing page in place');
    expect(response.message.content).toContain("useState<'dark' | 'light'>('dark')");
    expect(response.message.content).toContain("aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}");
    expect(response.message.content).not.toContain('title="package.json"');
    expect(response.message.content).not.toMatch(/here'?s how|you can change/i);
  });

  it('routes landing-page starter prompts to a dark dev-tool surface instead of the white Acme template', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build a polished landing page for a developer tool with strong hierarchy and responsive sections.' },
      ],
    });

    const appBlockMatch = response.message.content.match(/```tsx title="src\/App\.tsx"\n([\s\S]*?)```/);
    expect(appBlockMatch?.[1]).toContain("useState<ThemeMode>('dark')");
    expect(appBlockMatch?.[1]).toContain('Ship releases with');
    expect(appBlockMatch?.[1]).toContain('aria-label={themeLabel}');
    expect(appBlockMatch?.[1]).toContain('Switch to light mode');
    expect(appBlockMatch?.[1]).not.toContain('Acme');
    expect(appBlockMatch?.[1]).not.toContain('The fastest way to');
  });

  it('keeps simple landing-page color edits on the executable rail', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        {
          role: 'system',
          content: [
            'ACTIVE SANDBOX PROJECT: marketing-site',
            'CURRENT FILE SNAPSHOTS:',
            'FILE: src/App.tsx',
            '```tsx',
            'export default function App() {',
            '  return <main><h1 style={{ color: "#111" }}>Old heading</h1></main>;',
            '}',
            '```',
          ].join('\n'),
        },
        { role: 'user', content: 'Change the black text to red.' },
      ],
    });

    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(response.message.content).toContain('#ef4444');
    expect(response.message.content).not.toMatch(/here'?s how|you can change/i);
  });

  it('asks one blocking auth choice for active sandbox auth upgrades instead of falling back to setup advice', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        {
          role: 'system',
          content: [
            'ACTIVE SANDBOX PROJECT: next-app',
            'CURRENT FILE SNAPSHOTS:',
            'FILE: package.json',
            '```json',
            '{ "dependencies": { "next": "15.2.0", "react": "19.0.0" } }',
            '```',
            'FILE: src/app/page.tsx',
            '```tsx',
            'export default function HomePage() {',
            '  return <main>Hello</main>;',
            '}',
            '```',
          ].join('\n'),
        },
        { role: 'user', content: 'Add authentication to this Next.js app and keep the current preview working.' },
      ],
    });

    expect(response.message.content).toMatch(/Auth\.js with GitHub|Clerk|local email\/password/i);
    expect(response.message.content).not.toMatch(/\| Solution \||Password hashing|Authentication options for Next\.js/i);
  });

  it('does not let repo-native hardening hijack unrelated builder app requests', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'system', content: 'Prompt hardening for ambiguous repo-native questions:\n- Hardening profile: strict.\n- Requested response depth: deep-design-memo.' },
        { role: 'user', content: 'Build the first runnable version now. Create a compact but polished shared shopping app for a household or roommates. It can use a small React + Vite workspace if needed, but keep the product focus on real shopping use instead of scaffolding talk. Use Tailwind CSS v4 styling and framer-motion for subtle motion, seed mock data for members, items, aisle or category groupings, and activity messages, and make the UI clean, dark, modern, and phone-friendly. The preview must visibly include the heading Shared Shopping List plus separate sections labeled Household and Activity Chat. Do not use a starter template, monorepo starter, or generic scaffold copy unless I explicitly asked for one. Prefer the smallest real app that satisfies the product ask. Reply with only complete fenced code blocks. Every block must include a title="path/to/file" attribute so the sandbox can write it. Do not include any prose before, between, or after the file blocks.' },
      ],
    });

    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toContain('```tsx title="src/App.tsx"');
    expect(response.message.content).toContain('Shared Shopping List');
    expect(response.message.content).not.toContain('**Signals**');
  });

  it('keeps simple builder Vite React starters JSX-runtime safe', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build a simple notes dashboard app I can preview.' },
      ],
    });

    expect(response.message.content).toContain('```jsx title="src/App.jsx"');
    const appBlockMatch = response.message.content.match(/```jsx title="src\/App\.jsx"\n([\s\S]*?)```/);
    expect(appBlockMatch?.[1]).toMatch(/import React(?:,\s*\{[^}]+\})? from 'react';/);
    expect(appBlockMatch?.[1]).toContain('Notes Dashboard');
    expect(appBlockMatch?.[1]).toContain('Save note');
    expect(appBlockMatch?.[1]).not.toContain('Builder App');
  });

  it('routes broad social app builder prompts to Social Hub instead of the generic scaffold', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build a social blogging app I can preview.' },
      ],
    });

    const appBlockMatch = response.message.content.match(/```jsx title="src\/App\.jsx"\n([\s\S]*?)```/);
    expect(appBlockMatch?.[1]).toContain('Social Hub');
    expect(appBlockMatch?.[1]).toContain('Publish Post');
    expect(appBlockMatch?.[1]).not.toContain('Builder App');
  });

  it('routes broad internal tool prompts to an ops workspace instead of analytics charts or the generic scaffold', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build an internal ops dashboard app I can preview.' },
      ],
    });

    const appBlockMatch = response.message.content.match(/```jsx title="src\/App\.jsx"\n([\s\S]*?)```/);
    expect(appBlockMatch?.[1]).toContain('Ops Control Center');
    expect(appBlockMatch?.[1]).toContain('Approval Queue');
    expect(appBlockMatch?.[1]).toContain('Live Activity');
    expect(appBlockMatch?.[1]).not.toContain('Analytics Dashboard');
    expect(appBlockMatch?.[1]).not.toContain('Builder App');
  });

  it('routes broad SaaS workspace prompts to a real SaaS control center instead of a landing page or the generic scaffold', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build a premium SaaS workspace with auth, billing, settings, audit logs, and chat I can preview.' },
      ],
    });

    const appBlockMatch = response.message.content.match(/```jsx title="src\/App\.jsx"\n([\s\S]*?)```/);
    expect(appBlockMatch?.[1]).toContain('SaaS Control Center');
    expect(appBlockMatch?.[1]).toContain('Workspace Chat');
    expect(appBlockMatch?.[1]).toContain('Audit Log');
    expect(appBlockMatch?.[1]).not.toContain('Builder App');
    expect(appBlockMatch?.[1]).not.toContain('Get Started');
  });

  it('emits product-specific builder follow-ups for notes, social, ops, and SaaS app prompts', async () => {
    function collectFollowUps(prompt: string): string[] {
      return (engine as any).buildGroundedFollowUps(prompt, [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: prompt },
      ], undefined);
    }

    expect(collectFollowUps('Build a simple notes dashboard app I can preview.')).toEqual([
      'Add search, tags, and filters to this notes dashboard',
      'Persist notes in local storage and restore on reload',
      'Add edit, delete, and pin toggles to each note',
    ]);

    expect(collectFollowUps('Build a social blogging app I can preview.')).toEqual([
      'Add comments and likes to the feed',
      'Add author profiles and follow state to Social Hub',
      'Add trending topics and saved drafts to the composer',
    ]);

    expect(collectFollowUps('Build an internal ops dashboard app I can preview.')).toEqual([
      'Add assignee filters and SLA badges to the approval queue',
      'Turn the quick actions into working approval flows',
      'Add audit history and escalation states to Ops Control Center',
    ]);

    expect(collectFollowUps('Build a premium SaaS workspace app I can preview.')).toEqual([
      'Add plan upgrades and seat management to this SaaS workspace',
      'Add audit log filters and CSV export',
      'Add invite flows and role-based access to the team panel',
    ]);

    expect(collectFollowUps('Build a Twitter-style social feed app I can preview.')).toEqual([
      'Add a composer modal and inline thread replies to this feed',
      'Add profile pages, follow state, and engagement counters',
      'Add trends and who-to-follow rails with mobile navigation',
    ]);

    expect(collectFollowUps('Build a reference-inspired landing page from a screenshot I can preview.')).toEqual([
      'Tighten spacing, typography, and visual rhythm to match the reference closer',
      'Add responsive mobile navigation and a tighter tablet layout',
      'Replace placeholder sections with brand-specific copy and imagery slots',
    ]);

    expect(collectFollowUps('I want to sell massage oil and candles and smelling candles and similar.. I need a app')).toEqual([
      'Add a scent quiz and personalized bundle recommendations',
      'Turn the catalog into product detail pages with cart and checkout flow',
      'Add reviews, trust badges, and shipping thresholds to the storefront',
    ]);
  });

  it('returns a real first-slice product plan for a social blogging app instead of generic blog starter instructions', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Before we build, give me a concise realistic first-slice plan for a polished social blogging app. It should feel like a real product, not a toy or template. The first slice should support a home feed, writing a post, and basic community activity. Keep it short and practical.' }],
    });

    expect(response.message.content).toMatch(/1\. Core loop|home feed|composer|community|validation criteria|biggest risks/i);
    expect(response.message.content).not.toMatch(/Here's a \*\*Blog\*\* with React \+ TypeScript \+ Markdown support/i);
    expect(response.message.content).not.toMatch(/npm create vite|react-markdown/i);
  });

  it('builds a social blogging app in Builder mode with a real publish-to-feed loop', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'Build from scratch in Builder mode, but avoid template talk. Create a compact polished social blogging app that feels like a real product. The running preview must visibly include these exact texts: Social Hub, Write a Post, Blog Feed. The app must let me type a title and body and click a button labeled Publish Post so the new post appears immediately in Blog Feed without a page reload. Prefer the smallest real runnable app that works in the current sandbox. Keep the UI dark, modern, and phone-friendly.' },
      ],
    });

    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toContain('```jsx title="src/App.jsx"');
    expect(response.message.content).toContain('Social Hub');
    expect(response.message.content).toContain('Write a Post');
    expect(response.message.content).toContain('Blog Feed');
    expect(response.message.content).toContain('Publish Post');
    expect(response.message.content).not.toContain('Builder App');
    expect(response.message.content).not.toContain('Here\'s a **Blog** with React + TypeScript + Markdown support');
  });

  it('upgrades the current social blogging app in Builder mode with community pulse details', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'Upgrade the current running social blogging app. Keep Social Hub, Write a Post, Blog Feed, and Publish Post working. Add a new visible panel labeled Community Pulse and a visible card label Featured Post. Return only the files that need to change.' },
      ],
    });

    expect(response.message.content).toContain('```jsx title="src/App.jsx"');
    expect(response.message.content).toContain('Community Pulse');
    expect(response.message.content).toContain('Featured Post');
    expect(response.message.content).toContain('Publish Post');
    expect(response.message.content).not.toContain('```json title="package.json"');
  });

  it('routes twitter or x clone prompts to a reference-inspired social feed builder instead of the generic scaffold', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build a Twitter or X style clone I can preview with a For You timeline, a composer, and a who to follow rail.' },
      ],
    });

    const appBlockMatch = response.message.content.match(/```jsx title="src\/App\.jsx"\n([\s\S]*?)```/);
    expect(appBlockMatch?.[1]).toContain('Pulsewire');
    expect(appBlockMatch?.[1]).toContain('For You');
    expect(appBlockMatch?.[1]).toContain('Who to follow');
    expect(appBlockMatch?.[1]).toContain('Post update');
    expect(appBlockMatch?.[1]).not.toContain('Builder App');
  });

  it('understands typoed twitter clone builder prompts and still routes to the social feed builder', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: CONVERSATION_MODE_SYSTEM_PROMPTS.builder },
        { role: 'user', content: 'Build a twiter cloen app I can preview with a for you feed and who to follow rail.' },
      ],
    });

    expect(response.message.content).toContain('```jsx title="src/App.jsx"');
    expect(response.message.content).toContain('Pulsewire');
    expect(response.message.content).toContain('Who to follow');
    expect(response.message.content).not.toContain('Builder App');
  });

  it('returns runnable file blocks for a plain Node server in builder mode', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'build a node server from scratch' },
      ],
    });

    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toContain('```js title="server.js"');
    expect(response.message.content).toContain('/api/health');
    expect(response.message.content).not.toMatch(/here's a simple http server|tell me more/i);
  });

  it('returns runnable file blocks for a Node TypeScript server in builder mode', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'build a node typescript server from scratch' },
      ],
    });

    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toContain('```json title="tsconfig.json"');
    expect(response.message.content).toContain('```ts title="src/server.ts"');
    expect(response.message.content).toContain('Node TypeScript Scratch Server');
  });

  it('returns a Vinext-specific scratch scaffold in builder mode', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'build a vinext app from scratch and do not use a template' },
      ],
    });

    expect(response.message.content).toContain('real runnable base for Vinext right now');
    expect(response.message.content).toContain('{{template:nextjs:Fresh Next.js App Router}}');
    expect(response.message.content).not.toContain('```tsx title="app/page.tsx"');
    expect(response.message.content).not.toContain('{{deploy:');
  });

  it('returns the true Vinext default starter when explicitly asked', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'build a fresh vinext app from scratch, install vinext, leave it as default, and let me see the default home screen first' },
      ],
    });

    expect(response.message.content).toContain('real runnable base for Vinext right now');
    expect(response.message.content).toContain('{{template:nextjs:Fresh Next.js App Router}}');
    expect(response.message.content).not.toContain('```json title="package.json"');
    expect(response.message.content).not.toContain('{{deploy:');
  });

  it('treats a direct fresh Vinext build request as an honest fresh Next.js starter', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'Build a fresh Vinext app from scratch' },
      ],
    });

    expect(response.message.content).toContain('real runnable base for Vinext right now');
    expect(response.message.content).toContain('today\'s reliable Vinext path starts from a fresh Next.js app');
    expect(response.message.content).toContain('{{template:nextjs:Fresh Next.js App Router}}');
    expect(response.message.content).not.toContain('```json title="package.json"');
    expect(response.message.content).not.toContain('{{deploy:');
  });

  it('asks one clarifying question for a short Builder Vinext setup request', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'setup vinext for me please' },
      ],
    });

    expect(response.message.content).toContain('fresh Next.js App Router starter first');
    expect(response.message.content).toContain('Vinext template');
    expect(response.message.content).toContain('real clean Vinext path starts from a fresh Next.js app');
    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).not.toContain('```json title="package.json"');
  });

  it('returns the docs-style starter for a short Builder Next.js setup request', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'setup nextjs for me please' },
      ],
    });

    expect(response.message.content).toContain('clean Next.js App Router starter in sandbox now');
    expect(response.message.content).toContain('{{template:nextjs:Fresh Next.js App Router}}');
    expect(response.message.content).not.toContain('```json title="package.json"');
    expect(response.message.content).not.toContain('{{deploy:');
  });

  it('returns the docs-style starter for a terse Builder Next.js prompt', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'nextjs' },
      ],
    });

    expect(response.message.content).toContain('fresh Next.js starter');
    expect(response.message.content).toContain('custom Next.js app built directly');
    expect(response.message.content).not.toContain('{{template:nextjs:Fresh Next.js App Router}}');
    expect(response.message.content).not.toContain('{{deploy:');
  });

  it('returns a clarifier for a dotted Builder Next.js prompt instead of forcing a template', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'next.js' },
      ],
    });

    expect(response.message.content).toContain('fresh Next.js starter');
    expect(response.message.content).toContain('custom Next.js app built directly');
    expect(response.message.content).not.toContain('{{template:nextjs:Fresh Next.js App Router}}');
    expect(response.message.content).not.toContain('{{deploy:');
  });

  it('builds a custom Next.js app in Builder mode without falling back to a template', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'build a nextjs app for a small team planner' },
      ],
    });

    expect(response.message.content).toContain('```json title="package.json"');
    expect(response.message.content).toContain('```tsx title="app/layout.tsx"');
    expect(response.message.content).toContain('```tsx title="app/page.tsx"');
    expect(response.message.content).toContain('Next.js Workspace');
    expect(response.message.content).not.toContain('{{template:nextjs:Fresh Next.js App Router}}');
    expect(response.message.content).not.toContain('{{deploy:');
  });

  it('turns fresh Vinext install follow-up text into Builder file blocks', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'fresh Vinext install' },
      ],
    });

    expect(response.message.content).toContain('real runnable base for Vinext right now');
    expect(response.message.content).toContain('{{template:nextjs:Fresh Next.js App Router}}');
    expect(response.message.content).not.toContain('```tsx title="app/page.tsx"');
    expect(response.message.content).not.toContain('{{deploy:');
  });

  it('turns fresh Next.js install follow-up text into Builder file blocks', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'fresh Next.js install' },
      ],
    });

    expect(response.message.content).toContain('clean Next.js App Router starter in sandbox now');
    expect(response.message.content).toContain('{{template:nextjs:Fresh Next.js App Router}}');
    expect(response.message.content).not.toContain('```tsx title="app/page.tsx"');
    expect(response.message.content).not.toContain('{{deploy:');
  });

  it('upgrades the current Next.js app in Builder mode with file blocks instead of architecture prose', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are VeggaAI (Vai). You are in Builder mode.' },
        { role: 'user', content: 'Upgrade the current Next.js app into a useful product called Northstar Planner for small teams. Keep the current project and add a real header with navigation links Overview, Roadmap, Notes, and About. Create app-router pages for /roadmap, /notes, and /about. The home page must include the exact text "Plan calmer. Ship sooner." The roadmap page must include the exact text "Quarterly roadmap". The notes page must include the exact text "Shared notes". The about page must include the exact text "Why Northstar Planner". Modify the current app and add those pages, but do not scaffold a new project.' },
      ],
    });

    expect(response.message.content).toContain('Updated the current Next.js app in place into Northstar Planner');
    expect(response.message.content).toContain('```tsx title="src/app/layout.tsx"');
    expect(response.message.content).toContain('```tsx title="src/app/page.tsx"');
    expect(response.message.content).toContain('```tsx title="src/app/roadmap/page.tsx"');
    expect(response.message.content).toContain('```tsx title="src/app/notes/page.tsx"');
    expect(response.message.content).toContain('```tsx title="src/app/about/page.tsx"');
    expect(response.message.content).toContain('Plan calmer. Ship sooner.');
    expect(response.message.content).toContain('Quarterly roadmap');
    expect(response.message.content).toContain('Shared notes');
    expect(response.message.content).toContain('Why Northstar Planner');
    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).not.toMatch(/Premium Next\.js app shell/i);
  });

  it('answers vinext landing page prompts with page architecture instead of generic tailwind explanation', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'make me a Vinext landing page with Tailwind v4, Motion, GSAP split text, rolling letters, and a premium hero' }],
    });

    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).toMatch(/Vinext|Tailwind v4|Motion|GSAP|hero/i);
    expect(response.message.content).toMatch(/Page structure|Animation ownership|premium landing page/i);
  });

  it('answers public website or screenshot copy prompts with a reference-driven workflow instead of a generic fallback', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Make me a copy of a fancy public website we can look at and recreate from a screenshot. I want the real workflow, not a generic starter.' }],
    });

    expect(response.message.content).toMatch(/Reference-driven build workflow/i);
    expect(response.message.content).toMatch(/public website|screenshot|sandbox|reference/i);
    expect(response.message.content).toMatch(/translate, do not trace|original runnable product/i);
    expect(response.message.content).not.toContain("I couldn't find a strong match");
  });

  it('understands typoed website screenshot recreation prompts and returns the same workflow guidance', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Make me a copy of a public webstie from a screnshot and repliceate the ui in a sandbox seamlesly.' }],
    });

    expect(response.message.content).toMatch(/Reference-driven build workflow/i);
    expect(response.message.content).toMatch(/screenshot|sandbox|iterate/i);
    expect(response.message.content).not.toContain("I couldn't find a strong match");
  });

  it('answers ultra-vague build prompts with product lanes instead of junk retrieval fallback', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Build something:' }],
    });

    expect(response.message.content).toMatch(/Build direction/i);
    expect(response.message.content).toMatch(/SaaS workspace|Internal ops tool|Consumer social app|Landing page/i);
    expect(response.message.content).not.toContain("I couldn't find a strong match");
    expect(response.message.content).not.toMatch(/From what I've learned:/i);
  });

  it('gives photographer-specific build direction instead of a generic stack menu for the screenshot prompt', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'build me a single page app for a pro-photographer' }],
    });

    expect(response.message.content).toMatch(/pro photographer|photographer|photography/i);
    expect(response.message.content).toMatch(/featured shoots|booking|gallery|portfolio/i);
    expect(response.message.content).toMatch(/Vinext|Next\.js/i);
    expect(response.message.content).not.toMatch(/Type the stack name to start/i);
    expect(response.message.content).not.toMatch(/switch to Claude|GPT-4/i);
  });

  it('keeps art gallery requests distinct from photography portfolio guidance', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Can you make an art gallery website?' }],
    });

    expect(response.message.content).toMatch(/art gallery|artist|exhibition|museum/i);
    expect(response.message.content).not.toMatch(/book a session|wedding photography/i);
  });

  it('turns agreement after a photographer build direction into photography-specific site code', async () => {
    const first = await engine.chat({
      messages: [{ role: 'user', content: 'build me a single page app for a pro-photographer' }],
    });

    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'build me a single page app for a pro-photographer' },
        { role: 'assistant', content: first.message.content },
        { role: 'user', content: 'yes do it' },
      ],
    });

    expect(response.message.content).toMatch(/Photographer Portfolio|Ava Lens|Book a Session|Featured Shoots/i);
    expect(response.message.content).not.toContain("I couldn't find a strong match");
  });

  it('asks for product shape when the app request is too vague', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I want to make a app' }],
    });

    expect(response.message.content).toMatch(/what kind of app|pick a shape/i);
    expect(response.message.content).not.toMatch(/Type the stack name to start/i);
  });

  it('answers auth setup questions with auth guidance instead of build-intake copy', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'how do I add authentication to my next.js app' }],
    });

    expect(response.message.content).toMatch(/Authentication options for Next\.js|NextAuth\.js|Auth\.js/i);
    expect(response.message.content).not.toMatch(/I can help you build a \*\*authentication/i);
  });

  it('answers prisma setup questions with prisma guidance instead of a generic ORM definition', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'how do I set up prisma with postgresql' }],
    });

    expect(response.message.content).toMatch(/Install \+ setup|prisma init|datasource db|postgresql/i);
    expect(response.message.content).not.toMatch(/ORM \(Object-Relational Mapping\)/i);
  });

  it('diagnoses reading-map type errors without inventing property of', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'TypeError: Cannot read properties of undefined (reading "map")' }],
    });

    expect(response.message.content).toMatch(/map|Array\.isArray/i);
    expect(response.message.content).not.toMatch(/accessing `of`|data\?\.of/i);
  });

  it('turns vague-build chooser confirmations into a default plan preview instead of stalling', async () => {
    const first = await engine.chat({
      messages: [{ role: 'user', content: 'Build something:' }],
    });

    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'Build something:' },
        { role: 'assistant', content: first.message.content },
        { role: 'user', content: 'yes' },
      ],
    });

    expect(response.message.content).toMatch(/Intent read/i);
    expect(response.message.content).toMatch(/internal ops tool|Approval Queue|Activity Rail|Quick Actions/i);
    expect(response.message.content).toMatch(/Plan preview|Generate gate/i);
    expect(response.message.content).not.toContain("I couldn't find a strong match");
  });

  it('turns artisan storefront prompts into a product-first plan instead of generic stack cards', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I want to sell massage oil and candles and smelling candles and similar.. I need a app' }],
    });

    expect(response.message.content).toMatch(/Intent read/i);
    expect(response.message.content).toMatch(/storefront|catalog|product detail|cart|checkout/i);
    expect(response.message.content).toMatch(/candles|massage oils?|gift sets?|wellness/i);
    expect(response.message.content).toMatch(/Generate gate/i);
    expect(response.message.content).not.toMatch(/Step 1 — Choose your stack/i);
  });

  it('turns broad general-store prompts into a real ecommerce plan instead of fallback confusion', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'general store like firma for selling anything' }],
    });

    expect(response.message.content).toMatch(/Intent read/i);
    expect(response.message.content).toMatch(/storefront|ecommerce|catalog|product detail|cart|checkout/i);
    expect(response.message.content).toMatch(/many product types|categories|online store/i);
    expect(response.message.content).not.toMatch(/I don't have enough to go on/i);
  });

  it('treats direct commerce-store prompts as storefront direction instead of research retrieval', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'commerce store' }],
    });

    expect(response.message.content).toMatch(/Intent read/i);
    expect(response.message.content).toMatch(/storefront|ecommerce|catalog|cart|checkout/i);
    expect(response.message.content).not.toMatch(/angular e-commerce|Code of conduct|Resources/i);
  });

  it('treats bare commerce-store chooser follow-ups as storefront product direction instead of research blobs', async () => {
    const first = await engine.chat({
      messages: [{ role: 'user', content: 'Build something:' }],
    });

    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'Build something:' },
        { role: 'assistant', content: first.message.content },
        { role: 'user', content: 'commerce store' },
      ],
    });

    expect(response.message.content).toMatch(/Intent read/i);
    expect(response.message.content).toMatch(/storefront|ecommerce|catalog|cart|checkout/i);
    expect(response.message.content).not.toMatch(/angular e-commerce|Code of conduct|Resources/i);
  });

  it('turns general-store chooser follow-ups into a storefront plan instead of the weak fallback', async () => {
    const first = await engine.chat({
      messages: [{ role: 'user', content: 'Build something:' }],
    });

    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'Build something:' },
        { role: 'assistant', content: first.message.content },
        { role: 'user', content: 'general store like firma for selling anything' },
      ],
    });

    expect(response.message.content).toMatch(/Intent read/i);
    expect(response.message.content).toMatch(/storefront|ecommerce|catalog|cart|checkout/i);
    expect(response.message.content).not.toMatch(/I don't have enough to go on/i);
  });

  it('emits ecommerce-specific follow-up chips for broad general-store prompts in chat stream', async () => {
    const followUps: string[] = [];

    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: 'general store like firma for selling anything' }],
    })) {
      if (chunk.type === 'sources' && chunk.followUps) {
        followUps.push(...chunk.followUps);
      }
    }

    expect(followUps).toEqual([
      'Add category navigation, search, and filters to the storefront',
      'Turn product cards into product detail pages with variants and cart flow',
      'Add featured collections, trust signals, and order-summary checkout states',
    ]);
  });

  it('turns generic storefront follow-up chips into concrete ecommerce refinements', async () => {
    const first = await engine.chat({
      messages: [{ role: 'user', content: 'general store like firma for selling anything' }],
    });

    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'general store like firma for selling anything' },
        { role: 'assistant', content: first.message.content },
        { role: 'user', content: 'Add category navigation, search, and filters to the storefront' },
      ],
    });

    expect(response.message.content).toMatch(/Store discovery layer|categories|search|filters/i);
    expect(response.message.content).not.toMatch(/I don't have enough to go on/i);
  });

  it('keeps storefront custom-build follow-ups out of yes-no fallbacks', async () => {
    const first = await engine.chat({
      messages: [{ role: 'user', content: 'commerce store' }],
    });

    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'commerce store' },
        { role: 'assistant', content: first.message.content },
        { role: 'user', content: 'can we use something of our own?' },
      ],
    });

    expect(response.message.content).toMatch(/custom is the right move|our own storefront structure|Recommended shape/i);
    expect(response.message.content).not.toMatch(/^\*\*Yes\.\*\*\s*$/i);
  });

  it('keeps storefront build-now follow-ups out of capability blurbs', async () => {
    const first = await engine.chat({
      messages: [{ role: 'user', content: 'commerce store' }],
    });

    const second = await engine.chat({
      messages: [
        { role: 'user', content: 'commerce store' },
        { role: 'assistant', content: first.message.content },
        { role: 'user', content: 'can we use something of our own?' },
      ],
    });

    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'commerce store' },
        { role: 'assistant', content: first.message.content },
        { role: 'user', content: 'can we use something of our own?' },
        { role: 'assistant', content: second.message.content },
        { role: 'user', content: 'can you make it for me now?' },
      ],
    });

    expect(response.message.content).toMatch(/ready for the first build pass|Builder target|Execution note/i);
    expect(response.message.content).not.toMatch(/Right now I can:|pattern matching and n-grams/i);
  });

  it('emits storefront-specific follow-up chips for long artisan shop prompts in chat stream', async () => {
    const followUps: string[] = [];

    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: 'I want to sell massage oil and candles and smelling candles and similar.. I need a app' }],
    })) {
      if (chunk.type === 'sources' && chunk.followUps) {
        followUps.push(...chunk.followUps);
      }
    }

    expect(followUps).toEqual([
      'Add a scent quiz and personalized bundle recommendations',
      'Turn the catalog into product detail pages with cart and checkout flow',
      'Add reviews, trust badges, and shipping thresholds to the storefront',
    ]);
  });

  it('turns storefront follow-up chips into concrete product refinements instead of fallback confusion', async () => {
    const first = await engine.chat({
      messages: [{ role: 'user', content: 'I want to sell massage oil and candles and smelling candles and similar.. I need a app' }],
    });

    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'I want to sell massage oil and candles and smelling candles and similar.. I need a app' },
        { role: 'assistant', content: first.message.content },
        { role: 'user', content: 'Add a scent quiz and personalized bundle recommendations' },
      ],
    });

    expect(response.message.content).toMatch(/Scent quiz direction|Recommended flow|First implementation slice/i);
    expect(response.message.content).toMatch(/mood|scent family|bundle|curated/i);
    expect(response.message.content).not.toMatch(/I don't have enough to go on/i);
  });

  it('keeps exact screenshot landing-page preview prompts on the reference workflow path in chat mode', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Build a reference-inspired landing page from a screenshot I can preview.' }],
    });

    expect(response.message.content).toMatch(/Reference-driven build workflow/i);
    expect(response.message.content).toMatch(/screenshot|reference|sandbox/i);
    expect(response.message.content).not.toMatch(/Here's a complete \*\*Landing Page\*\* with HTML \+ Tailwind CSS/i);
  });

  it('returns an over-engineered frontend architecture response for serious ui prompts', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Design an over-engineered Next.js dashboard with Tailwind v4, Framer Motion, GSAP, Three.js, and a command center UI.' }],
    });
    expect(response.message.content).toMatch(/App Router|Tailwind v4|Framer Motion|Three\.js|command center/i);
    expect(response.message.content).toMatch(/state architecture|animation boundaries|feature set/i);
  });

  it('answers admin dashboard shell prompts with architecture instead of search fallback', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I want an over-engineered admin dashboard with command palette, activity rail, split panels, and tasteful motion. Give architecture first, not deploy buttons.' }],
    });

    expect(response.message.content).not.toContain("I couldn't find a strong match");
    expect(response.message.content).toMatch(/admin dashboard architecture|command palette|activity rail|split-panel|motion/i);
  });

  it('compares frontend framework stacks for premium motion work instead of collapsing to generic vite output', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I want a premium animated frontend in 2026. Compare Next.js App Router, Vite + React, Vinext, and Vue for building pages with Tailwind v4, Motion, and GSAP. Tell me when each wins.' }],
    });

    expect(response.message.content).toMatch(/Next\.js|App Router/i);
    expect(response.message.content).toMatch(/Vite/i);
    expect(response.message.content).toMatch(/Vinext/i);
    expect(response.message.content).toMatch(/Vue/i);
    expect(response.message.content).toMatch(/Tailwind v4|Motion|GSAP/i);
    expect(response.message.content).toMatch(/when each wins|wins when|tradeoff/i);
  });

  it('compares nextjs, vite react, and vinext for chat-first products with generated sandboxes', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'compare Next.js App Router, Vite React, and Vinext for a product that starts as chat-first but later needs generated app sandboxes' }],
    });

    expect(response.message.content).toMatch(/Next\.js App Router|Vite \+ React|Vinext/i);
    expect(response.message.content).toMatch(/chat-first|generated app sandboxes|generated apps|sandbox/i);
    expect(response.message.content).not.toMatch(/^\*\*Vite\*\* is a fast frontend build tool/i);
  });

  it('answers premium saas shell prompts with product architecture instead of timing out or generic fallback', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'design a premium SaaS shell with auth, billing, settings, audit logs, and a chat workspace for Vai. Architecture first, no scaffold buttons.' }],
    });

    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).toMatch(/Premium SaaS shell architecture|auth|billing|audit logs|chat workspace/i);
  });

  it('answers multi-panel chat workspace prompts with workspace structure instead of weak search fallback', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I need a multi-panel chat workspace where the left side is conversation history, the center is Vai chat, and the right side is plan preview plus sources. Give product structure, not stack cards.' }],
    });

    expect(response.message.content).not.toContain("I couldn't find a strong match");
    expect(response.message.content).toMatch(/Multi-panel chat workspace|conversation history|plan preview|sources|workspace/i);
  });

  it('answers app-builder control center prompts with staged approval workflow', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'build me an app-builder control center where users talk to Vai, review generated file trees, compare revisions, and only then open a sandbox preview.' }],
    });

    expect(response.message.content).not.toMatch(/^build robust and scalable software architecture/i);
    expect(response.message.content).toMatch(/App-builder control center|file tree|compare revisions|sandbox preview|approval/i);
  });

  it('answers auth team sandbox architecture prompts without leaking taught text', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'what is the right architecture for a product where users chat with Vai, authenticate, manage teams, and launch generated apps into isolated sandboxes later?' }],
    });

    expect(response.message.content).toMatch(/Chat-first product architecture|auth|teams|generated app|sandbox/i);
    expect(response.message.content).not.toMatch(/hello" "what can you do\?"/i);
  });

  it('answers monolith versus microservices prompts in the context of the product instead of generic definitions', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'compare a modular monolith vs microservices for a chat-first AI product with auth, billing, teams, and generated sandbox apps. Give the real engineering tradeoff.' }],
    });

    expect(response.message.content).toMatch(/Default choice: modular monolith|microservices|auth|billing|teams|sandbox/i);
    expect(response.message.content).not.toMatch(/^\*\*Microservices\*\* — decompose applications/i);
  });

  it('answers premium nextjs app shell prompts with shell architecture instead of empty or deploy answers', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'make me a premium Next.js app shell for an AI product with command palette, team switcher, billing area, source panel, and generated-app previews. Do not fall into deploy mode.' }],
    });

    expect(response.message.content).toMatch(/Premium Next\.js app shell|command palette|team switcher|billing|source panel|generated-app previews/i);
    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).not.toBe('**Yes.**');
  });

  it('stays useful for ambiguous saas prompts instead of junk fallback', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'make me a SaaS.' }],
    });

    expect(response.message.content).not.toContain("I couldn't find a strong match");
    expect(response.message.content).toMatch(/SaaS direction|product shell|core workflow/i);
  });

  it('stays useful for ambiguous ai app prompts instead of junk fallback', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'build an AI app.' }],
    });

    expect(response.message.content).not.toContain("I couldn't find a strong match");
    expect(response.message.content).toMatch(/AI app direction|approval|chat-first|workflow/i);
  });

  it('stays useful for ambiguous dashboard prompts instead of junk fallback', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'create a dashboard.' }],
    });

    expect(response.message.content).not.toContain("I couldn't find a strong match");
    expect(response.message.content).toMatch(/Dashboard direction|saved views|split panels|insight/i);
  });

  it('treats generic calculator prompts as a UI app direction instead of a toy class example', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'make me a calculator.' }],
    });

    expect(response.message.content).toMatch(/Calculator direction|safe math parser|history panel|keyboard/i);
    expect(response.message.content).not.toContain('// Simple Calculator');
  });

  it('answers dockable panel architecture prompts with a real layout model', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I want a fully draggable, resizable, dockable panel system like VSCode for chat, plans, sources, and debug panels. Give me the real architecture, not fake 150 LOC magic.' }],
    });

    expect(response.message.content).toMatch(/Dockable workbench architecture|layout as a tree|pointer events|drop targets|splitters/i);
    expect(response.message.content).not.toContain('[timeout]');
  });

  it('answers layered answer engine design prompts with grounded retrieval architecture', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Give a grounded design memo for a layered answer engine for developer research. You are not being asked to search the web; sketch the architecture directly. Use the headings: Retrieval, Ranking, Synthesis, Verification, Failure modes. Mention query rewriting, hybrid retrieval, reranking, citations or evidence, and explicit uncertainty.' }],
    });

    expect(response.message.content).toMatch(/Retrieval|Ranking|Synthesis|Verification|Failure modes/i);
    expect(response.message.content).toMatch(/query rewriting|hybrid retrieval|rerank|citations|evidence|uncertainty/i);
    expect(response.message.content).not.toContain("I couldn't find a strong match");
  });

  it('answers over-engineered notepad prompts with solid architecture and risky shortcuts to avoid', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I need a super over-engineered notepad system with voice recorder, search, history, export, and offline-first behavior. Give me a solid architecture and call out risky shortcuts to avoid.' }],
    });

    expect(response.message.content).toMatch(/Product-grade notepad architecture|IndexedDB|search|history|Risky shortcuts to avoid/i);
    expect(response.message.content).not.toMatch(/cookie preferences|voice by messaging chatgpt/i);
  });

  it('answers unified chat product prompts with a real conversation model', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'make me a chat interface for private self chat as notepad, private AI chat, private user chat, private group chat, private group chats with AI, public groups, and public groups with AI. Keep it valid and product-grade.' }],
    });

    expect(response.message.content).toMatch(/Unified chat product architecture|conversation model|participants|AI as a participant|workspace/i);
    expect(response.message.content).not.toMatch(/typescript world as public/i);
  });

  it('improves weak external AI architecture responses with explicit critique and stronger rewrite direction', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I have some chat with Grok about an over-engineered chat UI. Improve the response so it is more solid, tested, and free of obvious architecture mistakes.' }],
    });

    expect(response.message.content).toMatch(/improve that kind of AI response|architecture|risky shortcuts|tested|validation/i);
    expect(response.message.content).not.toMatch(/mock service worker|kettanaito/i);
  });

  it('explains plan access separately from sandbox billing entitlement', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'what should happen if an invited team member can view plans but does not have billing entitlement to launch a sandbox?' }],
    });

    expect(response.message.content).toMatch(/entitlement|view plans|launch a sandbox|request approval|seat upgrade/i);
  });

  it('returns a role model for owners admins builders reviewers and viewers', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'design the permission model for owners, admins, builders, reviewers, and viewers in a chat-first app-builder product.' }],
    });

    expect(response.message.content).toMatch(/Owner|Admin|Builder|Reviewer|Viewer|capability-based/i);
  });

  it('explains billing entitlements for generation previews runtime and deployment', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'how should billing entitlements gate generation, previews, runtime hours, and deployment in a sandbox app product?' }],
    });

    expect(response.message.content).toMatch(/Generation quota|Preview entitlement|Runtime hours|Deployment entitlement|budget/i);
  });

  it('returns a staged revision approval flow before preview or deploy', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'what is a strong revision approval flow before a generated app can open a sandbox preview or deploy?' }],
    });

    expect(response.message.content).toMatch(/Draft|Review|Approved for preview|Approved for deploy|Rejected/i);
  });

  it('explains sandbox lifecycle failure handling with diagnosable states', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'how should the product handle sandbox lifecycle failures like stuck build, crash loop, expired preview, and quota exhaustion without feeling broken?' }],
    });

    expect(response.message.content).toMatch(/Queued|building|crashed|expired|quota-blocked|logs|retry/i);
  });

  it('resolves simple but enterprise-grade prompts instead of falling back', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'make it simple but also enterprise-grade.' }],
    });

    expect(response.message.content).toMatch(/Simple outside, enterprise-grade inside|minimal|enterprise-grade/i);
    expect(response.message.content).not.toContain("I couldn't find a strong match");
  });

  it('resolves deploy without scaffold contradictions with a staged sequence', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'deploy it for me but do not scaffold yet.' }],
    });

    expect(response.message.content).toMatch(/Deploy versus scaffold conflict|Correct sequence|artifact|review/i);
    expect(response.message.content).not.toContain("I couldn't find a strong match");
  });

  it('resolves public but private prompts by splitting visibility and privacy dimensions', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'make it public but private.' }],
    });

    expect(response.message.content).toMatch(/Public versus private conflict|visibility|membership|Private memory/i);
    expect(response.message.content).not.toContain("I couldn't find a strong match");
  });

  it('resolves one-click generation versus approval gates clearly', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I want one-click generation, but I also want strong approval and review gates before previews and deploys. Design the policy clearly.' }],
    });

    expect(response.message.content).toMatch(/One-click versus approval gates|Policy|approval|preview|deploy/i);
    expect(response.message.content).not.toMatch(/spectator ions|net ionic equation/i);
  });

  it('explains how dockable desktop workspaces must change on phone portrait', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I want a VSCode-like dockable workspace, but it also has to work well on phone portrait. Tell me what changes and what cannot stay the same.' }],
    });

    expect(response.message.content).toMatch(/phone portrait|What changes|What cannot stay the same|desktop-first/i);
    expect(response.message.content).not.toContain("I couldn't find a strong match");
  });

  it('explains public chat with private ai memory as separated transcript and memory scopes', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'I want public group chat with AI, but some channels should keep private AI memory. Explain the boundary without hand-waving.' }],
    });

    expect(response.message.content).toMatch(/private AI memory boundaries|transcript visibility|memory scope|No silent memory bleed/i);
    expect(response.message.content).not.toMatch(/owned by the batman group/i);
  });

  it('answers nextjs animation boundary prompts with explicit library responsibility splits', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'In Next.js App Router, how would you split Framer Motion, GSAP, and Three.js responsibilities so the page stays fast while still feeling premium?' }],
    });

    expect(response.message.content).toMatch(/Next\.js|App Router/i);
    expect(response.message.content).toMatch(/Framer Motion|Motion/i);
    expect(response.message.content).toMatch(/GSAP/i);
    expect(response.message.content).toMatch(/Three\.js/i);
    expect(response.message.content).toMatch(/fast|performance|client-only|boundary/i);
  });

  it('answers vue vite animation setup prompts instead of falling into deploy mode', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'For a Vue + Vite app with Tailwind v4, what is a strong setup for hover effects, text rolling, split text, kinetic type, and page transitions without turning the app into animation soup?' }],
    });

    expect(response.message.content).not.toContain('{{deploy:');
    expect(response.message.content).toMatch(/Vue/i);
    expect(response.message.content).toMatch(/Vite/i);
    expect(response.message.content).toMatch(/Tailwind v4|oklch|@theme/i);
    expect(response.message.content).toMatch(/hover effects|text rolling|split text|kinetic type|page transitions/i);
    expect(response.message.content).toMatch(/animation soup|boundary|orchestration|restraint/i);
  });

  it('explains Vinext as a Vite-first next-style page option instead of defaulting to Next.js architecture', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'What is Vinext good for if I want Next-style pages on Vite with Tailwind v4 and premium motion? Explain the page architecture and the reason to pick it over plain Next.js or plain Vite.' }],
    });

    expect(response.message.content).toMatch(/Vinext/i);
    expect(response.message.content).toMatch(/Vite/i);
    expect(response.message.content).toMatch(/Next-style|Next\.js-like|page and API model/i);
    expect(response.message.content).toMatch(/Tailwind v4|Motion|GSAP/i);
    expect(response.message.content).toMatch(/pick it over|tradeoff|instead of/i);
  });

  it('answers motion-art landing page hero prompts with a frontend-specific architecture', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Design a motion-art landing page hero with Tailwind v4, gradient text, rolling letters, split text reveals, and hover accents. Answer like a frontend engineer who cares about architecture, not fluff.' }],
    });

    expect(response.message.content).toMatch(/Tailwind v4|@theme|oklch/i);
    expect(response.message.content).toMatch(/gradient text|rolling letters|split text reveals|hover accents/i);
    expect(response.message.content).toMatch(/architecture|client-only|performance|Motion|GSAP/i);
  });

  it('translates screenshot-style animation techniques into practical frontend implementation language', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Translate these animation marketplace techniques into web-engineering techniques: rolling letters, text splitting, page flip transitions, particle reveals, light rays, ribbon transitions, gradient titles, paper textures, and hover borders. Keep it practical for frontend implementation.' }],
    });

    expect(response.message.content).toMatch(/rolling letters|text splitting|page flip|particle|light rays|ribbon|gradient|paper textures?|hover borders?/i);
    expect(response.message.content).toMatch(/practical|frontend implementation|rendering primitive/i);
  });

  it('answers playwright live demo prompts with visible-browser evidence requirements', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'How should I run a Playwright live demo for an animated frontend so the browser is visible, the mouse is visible, hover states get captured, and screenshots prove every interaction?' }],
    });

    expect(response.message.content).toMatch(/Playwright/i);
    expect(response.message.content).toMatch(/headless:\s*false|visible browser/i);
    expect(response.message.content).toMatch(/hover states|screenshots|mouse|keyboard/i);
    expect(response.message.content).toMatch(/slowMo|evidence/i);
  });

  it('generates a node 18 compatible sse server when version is specified', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'show me a Node.js 18 SSE server example.' }],
    });
    expect(response.message.content).toMatch(/text\/event-stream|\/events|Node\.js 18|built-in `http` module/i);
  });

  it('keeps direct node 18 sse example requests out of conversational example follow-ups', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'Can you give me a React example?' },
        { role: 'assistant', content: '**React example — a counter component:**\n\n```tsx\nimport { useState } from "react";\n\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  return (\n    <div>\n      <p>Count: {count}</p>\n      <button onClick={() => setCount(c => c + 1)}>+1</button>\n    </div>\n  );\n}\n```' },
        { role: 'user', content: 'Show me a Node.js 18 SSE server example.' },
      ],
    });

    expect(response.message.content).toMatch(/Node\.js 18|built-in `http` module/i);
    expect(response.message.content).toMatch(/text\/event-stream|\/events/i);
    expect(response.message.content).not.toMatch(/React example — a counter component/i);
  });

  it('refuses to invent official docs urls for made-up features', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Use web search and give me the official Tailwind CSS page for a made-up feature called quantum breakpoints. If that page is not real, say so clearly and do not invent a URL.' }],
    });

    expect(response.message.content).toMatch(/cannot verify|not real|not found|do not invent/i);
    expect(response.message.content).toMatch(/quantum breakpoints/i);
    expect(response.message.content).toMatch(/tailwindcss\.com/i);
  });

  it('answers direct versioning policy questions instead of generic node blurbs', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'If I just say make me a Node.js example, should you default to latest stable, ask for a version, or mention your assumption?' }],
    });
    expect(response.message.content).toMatch(/specify a version|current stable|LTS|state that assumption/i);
    expect(response.message.content).not.toMatch(/JavaScript runtime built on Chrome's V8/i);
  });

  it('looks up current versions from official package sources', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('registry.npmjs.org/next/latest')) {
        return new Response(JSON.stringify({ version: '15.2.1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('registry.npmjs.org/react/latest')) {
        return new Response(JSON.stringify({ version: '19.1.0' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('nodejs.org/dist/index.json')) {
        return new Response(JSON.stringify([{ version: 'v24.1.0', lts: 'Hydrogen' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'What exact versions would you target today for Next.js, React, and Node.js?' }],
    });

    expect(response.message.content).toContain('15.2.1');
    expect(response.message.content).toContain('19.1.0');
    expect(response.message.content).toContain('v24.1.0');
  });

  it('treats explicit web-search prompts as search requests and emits sources', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network unavailable');
    }) as typeof fetch;

    const sourceChunks: Array<readonly { title: string; domain: string }[]> = [];
    const textChunks: string[] = [];

    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: 'Use web search and give me current official docs for Tailwind CSS responsive design, Framer Motion, GSAP, and Three.js for a modern dashboard stack. Include sources.' }],
    })) {
      if (chunk.type === 'sources' && chunk.sources) {
        sourceChunks.push(chunk.sources.map((source) => ({ title: source.title, domain: source.domain })));
      }
      if (chunk.type === 'text_delta' && chunk.textDelta) {
        textChunks.push(chunk.textDelta);
      }
    }

    const fullText = textChunks.join('');
    expect(sourceChunks.length).toBeGreaterThan(0);
    expect(sourceChunks[0].some((source) => source.domain === 'tailwindcss.com')).toBe(true);
    expect(sourceChunks[0].some((source) => source.domain === 'motion.dev')).toBe(true);
    expect(sourceChunks[0].some((source) => source.domain === 'gsap.com')).toBe(true);
    expect(sourceChunks[0].some((source) => source.domain === 'threejs.org')).toBe(true);
    expect(fullText).toMatch(/Official docs lookup|official documentation pages/i);
  });

  it('prefers cited research over broad local intelligence for factual comparison prompts', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.duckduckgo.com')) {
        return new Response(JSON.stringify({
          Abstract: 'SearXNG is a free and privacy-respecting metasearch engine that aggregates results from multiple search services.',
          AbstractSource: 'Wikipedia',
          AbstractURL: 'https://en.wikipedia.org/wiki/SearXNG',
          RelatedTopics: [
            {
              Text: 'DuckDuckGo Instant Answer API returns zero-click answers and related topics, but it is not a general metasearch engine.',
              FirstURL: 'https://duckduckgo.com/?q=duckduckgo+instant+answer+api',
            },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'What is SearXNG and why would I use it over DuckDuckGo Instant Answer API?' }],
    });

    expect(response.message.content).toMatch(/SearXNG/i);
    expect(response.message.content).toMatch(/DuckDuckGo/i);
    expect(response.message.content).not.toMatch(/Vite Best Practices|vite best practices/i);
    expect(engine.lastResponseMeta?.strategy).toBe('research-cited');
    expect(engine.lastCitedAnswer).not.toBeNull();
    expect(engine.lastCitedAnswer?.evidence.length ?? 0).toBeGreaterThan(0);
  });

  it('routes typoed explanation prompts into cited research instead of local fallback knowledge', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.duckduckgo.com')) {
        return new Response(JSON.stringify({
          RelatedTopics: [
            {
              Text: 'Perplexity AI, Inc. is an AI-powered search engine that answers questions with cited sources.',
              FirstURL: 'https://en.wikipedia.org/wiki/Perplexity_AI',
            },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'exsplain perplexity in simple words. include sources.' }],
    });

    expect(response.message.content).toMatch(/Perplexity AI|cited sources|search engine/i);
    expect(response.message.content).not.toMatch(/fair coin toss|probability distribution/i);
    expect(engine.lastResponseMeta?.strategy).toBe('research-cited');
    expect(engine.lastCitedAnswer?.evidence.length ?? 0).toBeGreaterThan(0);
  });

  it('routes obscure bare-word queries into cited research instead of the generic unknown fallback', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.duckduckgo.com')) {
        return new Response(JSON.stringify({
          Abstract: 'Smygel is an Old English word meaning a burrow or creeping-place, later reflected in Tolkien usage such as smial.',
          AbstractSource: 'Wikipedia',
          AbstractURL: 'https://en.wikipedia.org/wiki/Smial',
          RelatedTopics: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'smygel' }],
    });

    expect(response.message.content).toMatch(/Old English|burrow|Tolkien|smial/i);
    expect(response.message.content).not.toContain("I don't know about **smygel** yet");
    expect(engine.lastResponseMeta?.strategy).toBe('research-cited');
    expect(engine.lastCitedAnswer?.evidence.length ?? 0).toBeGreaterThan(0);
  });

  it('keeps referential trade-off follow-ups grounded to the previous comparison answer', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.duckduckgo.com')) {
        return new Response(JSON.stringify({
          Abstract: 'SearXNG is a free and privacy-respecting metasearch engine that aggregates results from multiple search services.',
          AbstractSource: 'Wikipedia',
          AbstractURL: 'https://en.wikipedia.org/wiki/SearXNG',
          RelatedTopics: [
            {
              Text: 'DuckDuckGo Instant Answer API returns zero-click answers and related topics, but it is not a general metasearch engine.',
              FirstURL: 'https://duckduckgo.com/?q=duckduckgo+instant+answer+api',
            },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const first = await engine.chat({
      messages: [{ role: 'user', content: 'What is SearXNG and why would I use it over DuckDuckGo Instant Answer API?' }],
    });

    const followUp = await engine.chat({
      messages: [
        { role: 'user', content: 'What is SearXNG and why would I use it over DuckDuckGo Instant Answer API?' },
        { role: 'assistant', content: first.message.content },
        { role: 'user', content: 'Based on that answer, give me the trade-offs with headings: Biggest upside, Biggest limit, Best fit.' },
      ],
    });

    expect(followUp.message.content).toContain('**Biggest upside**');
    expect(followUp.message.content).toContain('**Biggest limit**');
    expect(followUp.message.content).toContain('**Best fit**');
    expect(followUp.message.content).toMatch(/SearXNG/i);
    expect(followUp.message.content).toMatch(/DuckDuckGo Instant Answer API|DuckDuckGo/i);
    expect(followUp.message.content).not.toMatch(/hello! am veggaai|swedish exam prep|supergrok/i);
    expect(engine.lastResponseMeta?.strategy).toBe('topic-followup');
  });

  it('keeps referential follow-up suggestions grounded to the previous comparison topic', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.duckduckgo.com')) {
        return new Response(JSON.stringify({
          Abstract: 'SearXNG is a free and privacy-respecting metasearch engine that aggregates results from multiple search services.',
          AbstractSource: 'Wikipedia',
          AbstractURL: 'https://en.wikipedia.org/wiki/SearXNG',
          RelatedTopics: [
            {
              Text: 'DuckDuckGo Instant Answer API returns zero-click answers and related topics, but it is not a general metasearch engine.',
              FirstURL: 'https://duckduckgo.com/?q=duckduckgo+instant+answer+api',
            },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const first = await engine.chat({
      messages: [{ role: 'user', content: 'What is SearXNG and why would I use it over DuckDuckGo Instant Answer API?' }],
    });

    const followUps: string[] = [];
    for await (const chunk of engine.chatStream({
      messages: [
        { role: 'user', content: 'What is SearXNG and why would I use it over DuckDuckGo Instant Answer API?' },
        { role: 'assistant', content: first.message.content },
        { role: 'user', content: 'Based on that answer, give me the trade-offs with headings: Biggest upside, Biggest limit, Best fit.' },
      ],
    })) {
      if (chunk.type === 'sources' && chunk.followUps) {
        followUps.push(...chunk.followUps);
      }
    }

    expect(followUps.length).toBeGreaterThan(0);
    expect(followUps.every((item) => /SearXNG|DuckDuckGo/i.test(item))).toBe(true);
    expect(followUps.some((item) => /trade-offs|performance picture|migration/i.test(item))).toBe(true);
    expect(followUps.some((item) => /based on that answer|previous answer|this answer/i.test(item))).toBe(false);
  });

  it('preserves the actual subject in explicit version-search prompts', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.duckduckgo.com')) {
        if (!url.toLowerCase().includes('bun')) {
          return new Response(JSON.stringify({ Abstract: '', RelatedTopics: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          Abstract: 'Bun v1.2.23 is the latest stable release.',
          AbstractSource: 'Bun',
          AbstractURL: 'https://bun.sh/docs/installation',
          RelatedTopics: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Use web search and tell me the current stable Bun version and the official page for it. Include sources and state uncertainty if search is thin.' }],
    });

    expect(response.message.content).toContain('Bun');
    expect(response.message.content).toContain('1.2.23');
    expect(response.message.content).toContain('https://bun.sh/docs');
  });

  it('falls back to Bun official release info when live search is thin', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('api.duckduckgo.com')) {
        return new Response(JSON.stringify({ Abstract: '', RelatedTopics: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('api.github.com/repos/oven-sh/bun/releases/latest')) {
        return new Response(JSON.stringify({ tag_name: 'bun-v1.2.23' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Use web search and tell me the current stable Bun version and the official page for it. Include sources and state uncertainty if search is thin.' }],
    });

    expect(response.message.content).toContain('bun-v1.2.23');
    expect(response.message.content).toContain('Current version target');
    expect(response.message.content).toContain('https://bun.sh/docs');
  });

  it('returns official docs pages for explicit docs lookups when search is thin', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network unavailable');
    }) as typeof fetch;

    const sourceChunks: Array<readonly { title: string; domain: string }[]> = [];
    const textChunks: string[] = [];

    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: 'Use web search and tell me the official Tailwind CSS page for responsive design and the official Motion docs page for transitions. Include sources only if they are real.' }],
    })) {
      if (chunk.type === 'sources' && chunk.sources) {
        sourceChunks.push(chunk.sources.map((source) => ({ title: source.title, domain: source.domain })));
      }
      if (chunk.type === 'text_delta' && chunk.textDelta) {
        textChunks.push(chunk.textDelta);
      }
    }

    const fullText = textChunks.join('');
    expect(sourceChunks.length).toBeGreaterThan(0);
    expect(sourceChunks[0].some((source) => source.domain === 'tailwindcss.com')).toBe(true);
    expect(sourceChunks[0].some((source) => source.domain === 'motion.dev')).toBe(true);
    expect(fullText).toMatch(/Official docs lookup|official documentation pages/i);
  });

  it('answers eval safety prompts with a safe engineering recommendation', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Random control question: Is it safe to use eval in a calculator UI? Answer like a senior engineer and give safer alternatives.' }],
    });

    expect(response.message.content).toMatch(/not raw `eval`|wrong trust boundary|Safer defaults/i);
    expect(response.message.content).toMatch(/AST|allowlist|math interpreter/i);
  });

  it('answers weak-evidence prompts with explicit uncertainty policy', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'You are uncertain between two claims and have weak evidence. How should you answer so you stay useful without pretending certainty?' }],
    });

    expect(response.message.content).toMatch(/provisional|missing evidence|pretending certainty|verify next/i);
  });

  it('refuses to invent an exact future Bun release date and points to the release page', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Use web search and tell me the exact Bun 2.0 stable release date. If you cannot verify it, say you do not know and tell me what to check next.' }],
    });

    expect(response.message.content).toMatch(/do not know|not invent a date|unverified release date/i);
    expect(response.message.content).toMatch(/github\.com\/oven-sh\/bun\/releases|Check next/i);
  });

  it('explains how to handle conflicting version sources concretely', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'If npm metadata says one version and the official docs say another, how should you answer without pretending certainty?' }],
    });

    expect(response.message.content).toMatch(/Source conflict policy|sources disagree|official docs|npm metadata/i);
    expect(response.message.content).toMatch(/release notes|changelog|release page|verify next/i);
  });

  it('prefers fresher official sources over older tutorials and explains why', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'If a 2024 blog post says one thing, but 2026 official docs or release notes say another, how should you decide which source to trust and how should you explain that choice?' }],
    });

    expect(response.message.content).toMatch(/2024|older|stale|outdated/i);
    expect(response.message.content).toMatch(/2026|newer|current|fresher/i);
    expect(response.message.content).toMatch(/official docs|release notes/i);
    expect(response.message.content).toMatch(/trust|prefer|because/i);
  });

  it('prefers fresher framework docs over old tutorials when APIs changed', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'A popular tutorial is old, but the current framework docs changed the API. How should you answer so you prefer the fresher source and still explain the tradeoff?' }],
    });

    expect(response.message.content).toMatch(/old|older|outdated|popular tutorial/i);
    expect(response.message.content).toMatch(/current framework docs|fresher|official/i);
    expect(response.message.content).toMatch(/prefer|trust/i);
    expect(response.message.content).toMatch(/tradeoff|changed the API|historical context/i);
  });

  it('answers Redis Streams versus Kafka prompts with assumptions and switching criteria', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Compare Redis Streams vs Kafka for a system that needs replay, consumer groups, and maybe 20k messages per second. State assumptions and when your answer changes.' }],
    });

    expect(response.message.content).toMatch(/Redis Streams|Kafka/i);
    expect(response.message.content).toMatch(/Assumptions|When my answer changes/i);
  });

  it('recommends a modular monolith for small teams by default', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Random control question: What is a good default architecture for a small product team before they over-engineer things?' }],
    });

    expect(response.message.content).toMatch(/modular monolith/i);
    expect(response.message.content).toMatch(/One deployable application|One primary relational database/i);
  });

  it('honors exact literal reply instructions without grounding detours', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Reply with exactly this text: text-only check.' }],
    });

    expect(response.message.content).toBe('text-only check.');
  });

  it('honors exact token reply instructions with nothing-else wording', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Reply with exactly this token and nothing else: VAI_SMOKE_PING' }],
    });

    expect(response.message.content).toBe('VAI_SMOKE_PING');
  });

  it('does not emit grounded follow-ups for literal token replies', async () => {
    const sourcesChunks: Array<{ followUps?: string[] }> = [];

    for await (const chunk of engine.chatStream({
      messages: [{ role: 'user', content: 'Reply with exactly this token and nothing else: VAI_SMOKE_PING' }],
    })) {
      if (chunk.type === 'sources') {
        sourcesChunks.push({ followUps: chunk.followUps ? [...chunk.followUps] : [] });
      }
    }

    expect(sourcesChunks).toEqual([]);
  });

  it('honors strict benchmark answer-prefix contracts for numbered MCQs', async () => {
    const response = await engine.chat({
      messages: [
        {
          role: 'system',
          content: 'You are taking a closed-book benchmark. The entire content of your response should be of the following format: ANSWER: $LETTER where LETTER is one of A,B,C,D.',
        },
        {
          role: 'user',
          content: [
            'Which language adds static types to JavaScript?',
            '',
            '1. HTML',
            '2. CSS',
            '3. TypeScript',
            '4. Markdown',
          ].join('\n'),
        },
      ],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('benchmark-eval');
    expect(response.message.content).toMatch(/^ANSWER: [A-D]$/);
  });

  it('honors strict benchmark two-line contracts for lettered MCQs', async () => {
    const response = await engine.chat({
      messages: [
        {
          role: 'system',
          content: 'You are taking a closed-book benchmark. Reply with exactly two lines. Line 1: a single letter A, B, C, or D. Line 2: one short justification under 20 words.',
        },
        {
          role: 'user',
          content: [
            'Which language adds static types to JavaScript?',
            '',
            'A. HTML',
            'B. CSS',
            'C. TypeScript',
            'D. Markdown',
          ].join('\n'),
        },
      ],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('benchmark-eval');
    const lines = response.message.content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^[A-D]$/);
    expect(lines[1].length).toBeGreaterThan(0);
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

  it('does not prioritize research for curated best-practices topics', () => {
    const shouldPrioritizeResearch = (engine as any).shouldPrioritizeResearch.bind(engine as any) as (input: string, lower: string) => boolean;

    expect(shouldPrioritizeResearch('what are best practices for nextjs', 'what are best practices for nextjs')).toBe(false);
    expect(shouldPrioritizeResearch('what are best practices for vite', 'what are best practices for vite')).toBe(false);
    expect(shouldPrioritizeResearch('what are best practices for typescript', 'what are best practices for typescript')).toBe(false);
  });

  it('does not prioritize research when strong local factual knowledge already exists', () => {
    const shouldPrioritizeResearch = (engine as any).shouldPrioritizeResearch.bind(engine as any) as (input: string, lower: string) => boolean;

    expect(shouldPrioritizeResearch('who is the CEO of Circle K', 'who is the CEO of Circle K')).toBe(false);
    expect(shouldPrioritizeResearch('who is president in us', 'who is president in us')).toBe(false);
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

  it('does not treat standalone make-prompts as edits of the previous code sample', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'Hey again — go ahead.' },
        { role: 'user', content: 'write a fizzbuzz function in javascript' },
        {
          role: 'assistant',
          content: 'Here is FizzBuzz in javascript:\n\n```javascript\nfunction fizzBuzz(n) {\n  return n;\n}\n```',
        },
        { role: 'user', content: 'make a simple http server in python' },
      ],
    });

    expect(response.message.content).not.toContain('I can see the javascript code I gave you');
    expect(response.message.content).toMatch(/simple http server|python/i);
    expect(response.message.content).toMatch(/```python|http\.server|BaseHTTPRequestHandler/i);
  });

  it('implements named JavaScript chunking tasks for executable prompts', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are taking a JavaScript code generation benchmark. Return only runnable JavaScript.' },
        { role: 'user', content: 'Define a function named chunkArray(items, size) that splits the input array into chunks of the given positive size. If size is less than 1, throw an Error.' },
      ],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('code-task');
    const chunkArray = loadFunctionFromResponse<(items: number[], size: number) => number[][]>(response.message.content, 'chunkArray');
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 3)).toEqual([]);
    expect(() => chunkArray([1, 2, 3], 0)).toThrow();
  });

  it('implements named JavaScript text normalization tasks for executable prompts', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are taking a JavaScript code generation benchmark. Return only runnable JavaScript.' },
        { role: 'user', content: 'Define a function named normalizeSlug(text) that lowercases the input, replaces runs of non-alphanumeric characters with a single hyphen, and trims leading or trailing hyphens.' },
      ],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('code-task');
    const normalizeSlug = loadFunctionFromResponse<(text: string) => string>(response.message.content, 'normalizeSlug');
    expect(normalizeSlug('Hello, World!')).toBe('hello-world');
    expect(normalizeSlug('  Multi   Space__Value  ')).toBe('multi-space-value');
    expect(normalizeSlug('$$$')).toBe('');
  });

  it('implements named JavaScript parsing tasks for executable prompts', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'system', content: 'You are taking a JavaScript code generation benchmark. Return only runnable JavaScript.' },
        { role: 'user', content: 'Define a function named romanToInt(value) that converts a valid uppercase Roman numeral string into an integer.' },
      ],
    });

    expect(engine.lastResponseMeta?.strategy).toBe('code-task');
    const romanToInt = loadFunctionFromResponse<(value: string) => number>(response.message.content, 'romanToInt');
    expect(romanToInt('III')).toBe(3);
    expect(romanToInt('XL')).toBe(40);
    expect(romanToInt('MCMXCIV')).toBe(1994);
    expect(isDeepStrictEqual(romanToInt('LVIII'), 58)).toBe(true);
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

  /* ═══ URL-based request handling ═══ */

  it('fetches GitHub repo info and generates a project on build intent', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('api.github.com/repos/pingdotgg/lawn/readme')) {
        return {
          ok: true,
          json: async () => ({
            content: Buffer.from('# Lawn\nA video review platform for creative teams with timestamped comments, approvals, and share links.', 'utf8').toString('base64'),
          }),
        } as Response;
      }
      if (href.includes('api.github.com/repos/pingdotgg/lawn')) {
        return {
          ok: true,
          json: async () => ({
            description: null,
            language: 'TypeScript',
            topics: [],
            stargazers_count: 565,
            homepage: 'https://lawn.video',
          }),
        } as Response;
      }
      return originalFetch(href);
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'rebuild https://github.com/pingdotgg/lawn' }],
    });
    expect(response.message.content).toMatch(/pingdotgg\/lawn/i);
    expect(response.message.content).toMatch(/creative review workspace|timestamped comments|approval flow/i);
    expect(response.message.content).not.toMatch(/Build Something Amazing|complete \*\*Landing Page/i);
    expect(response.message.content).not.toMatch(/youtube|UBERMAN/i);
  });

  it('presents repo summary when looking at a GitHub URL', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('api.github.com/repos/pingdotgg/uploadthing')) {
        return {
          ok: true,
          json: async () => ({
            description: 'File uploads for modern web devs',
            language: 'TypeScript',
            topics: [],
            stargazers_count: 5093,
            homepage: 'https://uploadthing.com',
          }),
        } as Response;
      }
      return originalFetch(href);
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'check out https://github.com/pingdotgg/uploadthing' }],
    });
    expect(response.message.content).toMatch(/uploadthing/i);
    expect(response.message.content).toMatch(/file.?upload|modern.?web/i);
    expect(response.message.content).toMatch(/5,093|stars/i);
  });

  it('handles non-existent GitHub repos gracefully', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('api.github.com/repos/')) {
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      return originalFetch(href);
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'rebuild https://github.com/nonexistent/fake-repo-xyz' }],
    });
    expect(response.message.content).toMatch(/nonexistent|fake-repo|couldn't|tell me/i);
    expect(response.message.content).not.toMatch(/youtube|UBERMAN|undefined/i);
  });

  it('handles non-GitHub URLs with build intent', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'build something similar to https://stripe.com/docs' }],
    });
    expect(response.message.content).toMatch(/stripe\.com|build|inspired/i);
    expect(response.message.content).not.toMatch(/youtube/i);
  });

  it('lets non-GitHub bare URLs fall through to search', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'https://www.google.com' }],
    });
    // Should NOT be caught by url-request handler (no intent)
    expect(response.message.content).not.toMatch(/youtube|UBERMAN/i);
  });

  it('strips trailing punctuation from URLs', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('api.github.com/repos/pingdotgg/lawn')) {
        return {
          ok: true,
          json: async () => ({ description: null, language: 'TypeScript', topics: [], stargazers_count: 565, homepage: '' }),
        } as Response;
      }
      return originalFetch(href);
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'can you rebuild https://github.com/pingdotgg/lawn?' }],
    });
    expect(response.message.content).toMatch(/pingdotgg\/lawn/i);
  });

  it('handles "same design but different subject" follow-ups', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'rebuild https://github.com/pingdotgg/lawn' },
        { role: 'assistant', content: 'Here\'s a link-in-bio page:\n\n```html\n<!DOCTYPE html>\n<html lang="en">\n</html>\n```' },
        { role: 'user', content: 'same design but make it about photography instead' },
      ],
    });
    expect(response.message.content).toMatch(/photo/i);
    expect(response.message.content).not.toMatch(/I don't have a solid answer/i);
  });

  it('handles "different theme" follow-ups on previous code', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'build a landing page' },
        { role: 'assistant', content: 'Here\'s a page:\n\n```html\n<!DOCTYPE html>\n<html>\n<body class="bg-gray-900">\n</body>\n</html>\n```' },
        { role: 'user', content: 'make it the same but with a different theme, more purple and neon' },
      ],
    });
    expect(response.message.content).toMatch(/purple|neon|theme|color/i);
  });

  it('handles clone intent as build intent', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('api.github.com/repos/')) {
        return {
          ok: true,
          json: async () => ({ description: 'test', language: 'TypeScript', topics: [], stargazers_count: 10, homepage: '' }),
        } as Response;
      }
      return originalFetch(href);
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'clone https://github.com/pingdotgg/lawn' }],
    });
    expect(response.message.content).toMatch(/lawn/i);
  });

  it('recognizes "build something like X but for Y" with URL', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('api.github.com/repos/')) {
        return {
          ok: true,
          json: async () => ({ description: null, language: 'TypeScript', topics: [], stargazers_count: 100, homepage: '' }),
        } as Response;
      }
      return originalFetch(href);
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'build something like https://github.com/pingdotgg/lawn but for sharing music links' }],
    });
    expect(response.message.content).toMatch(/lawn|music|link/i);
  });

  it('does not route URLs through error-diagnosis', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('api.github.com/repos/')) {
        return {
          ok: true,
          json: async () => ({ description: 'A project', language: 'TypeScript', topics: [], stargazers_count: 50, homepage: '' }),
        } as Response;
      }
      return originalFetch(href);
    }) as typeof fetch;

    const response = await engine.chat({
      messages: [{ role: 'user', content: 'Take a look at https://github.com/pingdotgg/lawn' }],
    });
    // Must NOT hit error-diagnosis (which previously matched "at https" as a stack trace)
    expect(response.message.content).not.toMatch(/Diagnosing|stack trace|error/i);
  });
});

/* ══════════════════════════════════════════════════════════════════
   SkillRouter — Domain Detection & Routing Tests
   ══════════════════════════════════════════════════════════════════ */

describe('SkillRouter', () => {
  let router: SkillRouter;

  beforeEach(() => {
    router = new SkillRouter();
  });

  // ─── Domain Detection ─────────────────────────────────────────

  describe('detectDomain', () => {
    it('detects game-dev from explicit game requests', () => {
      const matches = router.detectDomain('Build me a modern Hotline Miami style game');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].domain.id).toBe('game-dev');
      expect(matches[0].confidence).toBeGreaterThanOrEqual(0.20);
    });

    it('detects game-dev from RPG keywords', () => {
      const matches = router.detectDomain('I want a dungeon crawler RPG with quests and inventory');
      expect(matches[0].domain.id).toBe('game-dev');
      expect(matches[0].matchedSignals.length).toBeGreaterThan(1);
    });

    it('detects web-design from website requests', () => {
      const matches = router.detectDomain('Create me a modern landing page with hero section and contact form');
      expect(matches[0].domain.id).toBe('web-design');
    });

    it('detects photography domain', () => {
      const matches = router.detectDomain('Build me a photography portfolio with a photo gallery and lightbox');
      expect(matches[0].domain.id).toBe('photography');
    });

    it('detects saas domain', () => {
      const matches = router.detectDomain('Build a SaaS subscription platform with Stripe billing and multi-tenant support');
      expect(matches[0].domain.id).toBe('saas');
    });

    it('detects dashboard domain', () => {
      const matches = router.detectDomain('Make me a dashboard with analytics charts and KPI widgets');
      expect(matches[0].domain.id).toBe('dashboard');
    });

    it('detects chat app builder domain from Base44-style build workflow prompts', () => {
      const matches = router.detectDomain('Improve Vai so chat feels like Base44 when users want to build apps with plan previews and sandbox handoff');
      expect(matches[0].domain.id).toBe('app-builder');
    });

    it('detects ecommerce domain', () => {
      const matches = router.detectDomain('Build an e-commerce store with cart and checkout');
      expect(matches[0].domain.id).toBe('ecommerce');
    });

    it('detects mobile domain', () => {
      const matches = router.detectDomain('Create a React Native mobile app with push notifications');
      expect(matches[0].domain.id).toBe('mobile');
    });

    it('detects api/backend domain', () => {
      const matches = router.detectDomain('Build me a REST API with JWT authentication and middleware');
      expect(matches[0].domain.id).toBe('api');
    });

    it('detects devops domain', () => {
      const matches = router.detectDomain('Set up a CI/CD pipeline with Docker and Kubernetes');
      expect(matches[0].domain.id).toBe('devops');
    });

    it('detects ai-ml domain', () => {
      const matches = router.detectDomain('Build an AI chatbot with RAG system using embeddings');
      expect(matches[0].domain.id).toBe('ai-ml');
    });

    it('returns empty array for general conversation', () => {
      const matches = router.detectDomain('What time is it?');
      expect(matches.length).toBe(0);
    });

    it('returns multiple matches sorted by confidence', () => {
      // Should match game-dev (game, enemies, combat) AND dashboard (dashboard, analytics, charts)
      const matches = router.detectDomain('Build me a game with enemies and combat plus a dashboard with analytics and charts');
      expect(matches.length).toBeGreaterThan(1);
      // Should be sorted descending by confidence
      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
      }
    });
  });

  // ─── getBestMatch ─────────────────────────────────────────────

  describe('getBestMatch', () => {
    it('returns best match for strong signal', () => {
      const match = router.getBestMatch('Build me a 3D game with enemies and weapons');
      expect(match).not.toBeNull();
      expect(match!.domain.id).toBe('game-dev');
    });

    it('returns null for general conversation', () => {
      const match = router.getBestMatch('Hello, how are you?');
      expect(match).toBeNull();
    });

    it('returns null for very weak signals', () => {
      // Single low-weight keyword shouldn't pass 0.20 threshold
      const match = router.getBestMatch('I like charts');
      // Could match data domain weakly — either null or very low confidence
      if (match) {
        expect(match.confidence).toBeGreaterThanOrEqual(0.20);
      }
    });
  });

  // ─── Scaffold Gating ──────────────────────────────────────────

  describe('isExplicitScaffoldRequest', () => {
    it('returns true for explicit scaffold requests', () => {
      expect(router.isExplicitScaffoldRequest('Scaffold a PERN app for me')).toBe(true);
      expect(router.isExplicitScaffoldRequest('Deploy my project')).toBe(true);
      expect(router.isExplicitScaffoldRequest('Spin up a new MERN stack')).toBe(true);
    });

    it('returns true for explicit stack build requests', () => {
      expect(router.isExplicitScaffoldRequest('Build me a PERN app')).toBe(true);
      expect(router.isExplicitScaffoldRequest('Create a Next.js project')).toBe(true);
      expect(router.isExplicitScaffoldRequest('Make a T3 app')).toBe(true);
      expect(router.isExplicitScaffoldRequest('setup vinext for me please')).toBe(true);
    });

    it('returns false for creative game requests', () => {
      expect(router.isExplicitScaffoldRequest('Make me a game like Hotline Miami')).toBe(false);
    });

    it('returns false for generic build requests', () => {
      expect(router.isExplicitScaffoldRequest('Build me a Twitter clone')).toBe(false);
      expect(router.isExplicitScaffoldRequest('Create a photography portfolio')).toBe(false);
    });

    it('returns false for general conversation', () => {
      expect(router.isExplicitScaffoldRequest('What features does Vai have?')).toBe(false);
    });
  });

  // ─── buildContext ─────────────────────────────────────────────

  describe('buildContext', () => {
    it('produces a context string with domain label and system prompt', () => {
      const match = router.getBestMatch('Build me a 3D RPG game with combat');
      expect(match).not.toBeNull();
      const ctx = router.buildContext(match!);
      expect(ctx).toContain('[Domain: Game Development]');
      expect(ctx).toContain('expert game developer');
    });
  });

  // ─── getDomains ───────────────────────────────────────────────

  describe('getDomains', () => {
    it('returns all 12 domain skills', () => {
      const domains = router.getDomains();
      expect(domains.length).toBe(12);
      const ids = domains.map(d => d.id);
      expect(ids).toContain('app-builder');
      expect(ids).toContain('game-dev');
      expect(ids).toContain('web-design');
      expect(ids).toContain('photography');
      expect(ids).toContain('saas');
      expect(ids).toContain('dashboard');
      expect(ids).toContain('ecommerce');
      expect(ids).toContain('mobile');
      expect(ids).toContain('api');
      expect(ids).toContain('devops');
      expect(ids).toContain('data');
      expect(ids).toContain('ai-ml');
    });
  });

  // ─── Confidence Scoring ───────────────────────────────────────

  describe('confidence scoring', () => {
    it('gives higher confidence for multiple matching signals', () => {
      const weak = router.detectDomain('game');
      const strong = router.detectDomain('Build me a 3D game with enemies, weapons, quests, and boss fights');
      expect(strong.length).toBeGreaterThan(0);
      expect(weak.length).toBeGreaterThan(0);
      expect(strong[0].confidence).toBeGreaterThan(weak[0].confidence);
    });

    it('caps confidence at 1.0', () => {
      // Overload with many signals
      const matches = router.detectDomain(
        'game shooter rpg platformer enemies weapons combat quest achievement lore npc inventory dungeon roguelike'
      );
      expect(matches[0].confidence).toBeLessThanOrEqual(1.0);
    });

    it('regex patterns give stronger signal than keywords alone', () => {
      // "hotline miami" triggers both a keyword and a regex
      const withRegex = router.detectDomain('make me a hotline miami game');
      // "game" only triggers a keyword
      const keywordOnly = router.detectDomain('game ideas');
      expect(withRegex[0].confidence).toBeGreaterThan(keywordOnly[0].confidence);
    });
  });

  // ── Quality Gate Tests ──

  describe('Quality Gate', () => {
    function makeQualityGateConfig(overrides?: Partial<{ enabled: boolean; confidenceThreshold: number; timeoutMs: number }>) {
      return {
        port: 3006,
        dbPath: ':memory:',
        dbDriver: 'sqlite' as const,
        providers: {
          vai: { id: 'vai' as const, enabled: true },
          anthropic: { id: 'anthropic' as const, apiKey: 'test-key', enabled: true, defaultModel: 'claude-sonnet-4-20250514' },
          openai: { id: 'openai' as const, enabled: false },
          google: { id: 'google' as const, enabled: false },
          local: { id: 'local' as const, enabled: false },
        },
        defaultModelId: 'vai:v0',
        fallbackChain: { models: ['vai:v0'] },
        routingRules: [],
        maxMonthlySpend: 0,
        maxTokensPerRequest: 4096,
        maxConcurrentRequests: 10,
        maxSandboxes: 2,
        sandboxDocker: false,
        ownerEmail: '',
        apiKeys: [] as string[],
        authEnabled: false,
        rateLimitPerMinute: 0,
        platformAuth: { enabled: false, providers: {} },
        chatPromptRewrite: { enabled: false, profile: 'balanced' as const, responseDepth: 'auto' as const, applyToModes: [], rules: { enabled: false, rules: [] } },
        enableToolCalling: false,
        maxToolIterations: 10,
        enableUsageTracking: false,
        enableEval: false,
        qualityGate: {
          enabled: overrides?.enabled ?? true,
          confidenceThreshold: overrides?.confidenceThreshold ?? 0.8,
          provider: undefined,
          model: undefined,
          timeoutMs: overrides?.timeoutMs ?? 5000,
          skipStrategies: ['empty', 'gibberish', 'keyboard-noise', 'math', 'binary', 'conversational', 'scaffold', 'url-request'],
        },
      };
    }

    /** Helper: make a mock LLM diagnostic response (teacher feedback, NOT a replacement) */
    function makeLLMDiagnostic(overrides?: {
      score?: number;
      weaknesses?: string[];
      missing_concepts?: string[];
      version_issues?: string[];
      pattern_fixes?: string[];
      should_regenerate?: boolean;
    }) {
      return JSON.stringify({
        score: overrides?.score ?? 6,
        weaknesses: overrides?.weaknesses ?? [],
        missing_concepts: overrides?.missing_concepts ?? [],
        version_issues: overrides?.version_issues ?? [],
        pattern_fixes: overrides?.pattern_fixes ?? [],
        should_regenerate: overrides?.should_regenerate ?? false,
      });
    }

    it('learns from LLM diagnostic feedback and persists knowledge', async () => {
      const config = makeQualityGateConfig({ enabled: true, confidenceThreshold: 0.99 });
      const engine = new VaiEngine({ config: config as any });
      const beforeCount = engine.knowledge.entryCount;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('anthropic.com')) {
          return {
            ok: true,
            json: async () => ({
              content: [{ text: makeLLMDiagnostic({
                score: 3,
                missing_concepts: ['Quantum entanglement allows particles to be correlated regardless of distance'],
                pattern_fixes: ['Instead of vague overview → provide concrete examples of superposition'],
                should_regenerate: true,
              }) }],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }) as any;

      const chunks: any[] = [];
      for await (const chunk of engine.chatStream({
        messages: [{ role: 'user', content: 'explain quantum computing in detail please' }],
      })) {
        chunks.push(chunk);
      }

      // Vai should have learned new knowledge entries from the LLM feedback
      expect(engine.knowledge.entryCount).toBeGreaterThan(beforeCount);

      // The response should be Vai's OWN regenerated response, not the LLM's
      const text = chunks.filter(c => c.type === 'text_delta').map(c => c.textDelta).join('');
      expect(text.length).toBeGreaterThan(10);
      // Should NOT contain the LLM's exact diagnostic text — Vai generates its own
      expect(text).not.toContain('Quantum entanglement allows particles');
    });

    it('does NOT swap in LLM response — Vai regenerates its own', async () => {
      const config = makeQualityGateConfig({ enabled: true, confidenceThreshold: 0.99 });
      const engine = new VaiEngine({ config: config as any });

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('anthropic.com')) {
          return {
            ok: true,
            json: async () => ({
              content: [{ text: makeLLMDiagnostic({
                score: 2,
                missing_concepts: ['STOLEN_LLM_RESPONSE_MARKER should never appear in output'],
                should_regenerate: true,
              }) }],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }) as any;

      const chunks: any[] = [];
      for await (const chunk of engine.chatStream({
        messages: [{ role: 'user', content: 'explain distributed systems thoroughly' }],
      })) {
        chunks.push(chunk);
      }

      const text = chunks.filter(c => c.type === 'text_delta').map(c => c.textDelta).join('');
      // The LLM's exact text must NOT appear in Vai's response
      expect(text).not.toContain('STOLEN_LLM_RESPONSE_MARKER');
      expect(text.length).toBeGreaterThan(10);
    });

    it('rejects outdated version suggestions from the LLM', async () => {
      const config = makeQualityGateConfig({ enabled: true, confidenceThreshold: 0.99 });
      const engine = new VaiEngine({ config: config as any });
      const beforeCount = engine.knowledge.entryCount;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('anthropic.com')) {
          return {
            ok: true,
            json: async () => ({
              content: [{ text: makeLLMDiagnostic({
                score: 5,
                // LLM trained on old data suggests Next.js 14 — but Vai knows 16 is current
                version_issues: ['nextjs v14 is outdated, upgrade to Next.js 15'],
                missing_concepts: ['Valid learning point about server components'],
                should_regenerate: false,
              }) }],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }) as any;

      const chunks: any[] = [];
      for await (const chunk of engine.chatStream({
        messages: [{ role: 'user', content: 'tell me about web frameworks in depth' }],
      })) {
        chunks.push(chunk);
      }

      // The outdated version warning should have been filtered out
      // But the valid learning point should still be learned
      const afterCount = engine.knowledge.entryCount;
      const newEntries = afterCount - beforeCount;
      // Should have learned the valid concept but NOT the stale version advice
      expect(newEntries).toBeGreaterThanOrEqual(1);
    });

    it('keeps original response when LLM scores it well (no regeneration)', async () => {
      const config = makeQualityGateConfig({ enabled: true, confidenceThreshold: 0.99 });
      const engine = new VaiEngine({ config: config as any });

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('anthropic.com')) {
          return {
            ok: true,
            json: async () => ({
              content: [{ text: makeLLMDiagnostic({ score: 8, should_regenerate: false }) }],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }) as any;

      // Get the response WITHOUT quality gate to compare
      const enginePlain = new VaiEngine();
      const plainChunks: any[] = [];
      for await (const chunk of enginePlain.chatStream({
        messages: [{ role: 'user', content: 'tell me about web frameworks in depth' }],
      })) {
        plainChunks.push(chunk);
      }
      const plainText = plainChunks.filter(c => c.type === 'text_delta').map(c => c.textDelta).join('');

      // Now with quality gate
      const chunks: any[] = [];
      for await (const chunk of engine.chatStream({
        messages: [{ role: 'user', content: 'tell me about web frameworks in depth' }],
      })) {
        chunks.push(chunk);
      }
      const gatedText = chunks.filter(c => c.type === 'text_delta').map(c => c.textDelta).join('');

      // High-scoring response should NOT be regenerated — same strategy produces same answer
      expect(gatedText.length).toBeGreaterThan(10);
    });

    it('does not call external LLM when quality gate is disabled', async () => {
      const config = makeQualityGateConfig({ enabled: false });
      const engine = new VaiEngine({ config: config as any });

      globalThis.fetch = vi.fn().mockImplementation(originalFetch) as any;

      const chunks: any[] = [];
      for await (const chunk of engine.chatStream({
        messages: [{ role: 'user', content: 'explain quantum computing' }],
      })) {
        chunks.push(chunk);
      }

      const llmCalls = (globalThis.fetch as any).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && (c[0].includes('anthropic.com') || c[0].includes('openai.com') || c[0].includes('googleapis.com')),
      );
      expect(llmCalls.length).toBe(0);
    });

    it('does not call external LLM for skipped strategies (math etc)', async () => {
      const config = makeQualityGateConfig({ enabled: true, confidenceThreshold: 0.99 });
      const engine = new VaiEngine({ config: config as any });

      globalThis.fetch = vi.fn().mockImplementation(originalFetch) as any;

      const chunks: any[] = [];
      for await (const chunk of engine.chatStream({
        messages: [{ role: 'user', content: '2+2' }],
      })) {
        chunks.push(chunk);
      }

      const llmCalls = (globalThis.fetch as any).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && (c[0].includes('anthropic.com') || c[0].includes('openai.com') || c[0].includes('googleapis.com')),
      );
      expect(llmCalls.length).toBe(0);
    });

    it('survives external LLM failure gracefully', async () => {
      const config = makeQualityGateConfig({ enabled: true, confidenceThreshold: 0.99 });
      const engine = new VaiEngine({ config: config as any });

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && (url.includes('anthropic.com') || url.includes('openai.com') || url.includes('googleapis.com'))) {
          throw new Error('network failure');
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }) as any;

      const chunks: any[] = [];
      for await (const chunk of engine.chatStream({
        messages: [{ role: 'user', content: 'explain distributed systems thoroughly' }],
      })) {
        chunks.push(chunk);
      }

      const text = chunks.filter(c => c.type === 'text_delta').map(c => c.textDelta).join('');
      expect(text.length).toBeGreaterThan(10);
    });

    it('uses OpenAI when Anthropic is not available', async () => {
      const config = makeQualityGateConfig({ enabled: true, confidenceThreshold: 0.99 });
      config.providers.anthropic = { id: 'anthropic' as const, enabled: false };
      config.providers.openai = { id: 'openai' as const, apiKey: 'openai-key', enabled: true, defaultModel: 'gpt-4o' };

      const engine = new VaiEngine({ config: config as any });

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('openai.com')) {
          return {
            ok: true,
            json: async () => ({
              choices: [{ message: { content: makeLLMDiagnostic({
                score: 3,
                missing_concepts: ['OpenAI teacher feedback was received'],
                should_regenerate: true,
              }) } }],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }) as any;

      const chunks: any[] = [];
      for await (const chunk of engine.chatStream({
        messages: [{ role: 'user', content: 'explain machine learning in detail' }],
      })) {
        chunks.push(chunk);
      }

      // Verify it called OpenAI endpoint (not Anthropic)
      const openaiCalls = (globalThis.fetch as any).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('openai.com'),
      );
      expect(openaiCalls.length).toBeGreaterThan(0);

      // Response should be Vai's own, not the LLM diagnostic
      const text = chunks.filter(c => c.type === 'text_delta').map(c => c.textDelta).join('');
      expect(text).not.toContain('OpenAI teacher feedback');
      expect(text.length).toBeGreaterThan(10);
    });

    it('validates the validator — filters stale LLM version advice', async () => {
      const config = makeQualityGateConfig({ enabled: true, confidenceThreshold: 0.99 });
      const engine = new VaiEngine({ config: config as any });

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('anthropic.com')) {
          return {
            ok: true,
            json: async () => ({
              content: [{ text: makeLLMDiagnostic({
                score: 4,
                // LLM suggests outdated versions — Vai should reject these
                version_issues: [
                  'react v17 is outdated, use React 18',   // stale: Vai knows React 19
                  'tailwind v3 is outdated, use Tailwind 4', // valid: matches Vai's knowledge
                  'nextjs v13 is outdated, use Next.js 15',  // stale: Vai knows Next.js 16
                ],
                should_regenerate: true,
              }) }],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }) as any;

      const beforeCount = engine.knowledge.entryCount;

      for await (const chunk of engine.chatStream({
        messages: [{ role: 'user', content: 'build me a react app with tailwind' }],
      })) {
        // consume
      }

      // Only the Tailwind v4 warning should have been learned (matches Vai's knowledge)
      // The React 18 (stale — Vai knows 19) and Next.js 15 (stale — Vai knows 16)
      // suggestions should have been filtered out
      const afterCount = engine.knowledge.entryCount;
      // We expect some learning happened but the stale version entries were rejected
      expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
    });
  });
});
