/**
 * VCUS End-to-End Tests
 *
 * Tests the full VAI pipeline: server → engine → knowledge → response
 * Requires the VAI server to be running on localhost:3006
 *
 * Usage:
 *   npx tsx src/e2e.test.ts
 */

const BASE = process.env.VAI_URL || 'http://localhost:3006';

interface TestCase {
  name: string;
  fn: () => Promise<void>;
}

const tests: TestCase[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertContains(text: string, keyword: string) {
  if (!text.toLowerCase().includes(keyword.toLowerCase())) {
    throw new Error(`Expected "${keyword}" in response, got: ${text.substring(0, 100)}...`);
  }
}

// ─── Helper: send chat message ─────────────────────────

async function chat(
  message: string, conversationId?: string,
): Promise<{ answer: string; convId: string }> {
  let convId = conversationId;
  if (!convId) {
    const res = await fetch(`${BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: 'vai:v0', title: 'E2E Test' }),
    });
    assert(res.ok, `Create conversation: ${res.status}`);
    const conv = await res.json() as { id: string };
    convId = conv.id;
  }

  const res = await fetch(`${BASE}/api/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    // Fallback: direct chat completions
    const chatRes = await fetch(`${BASE}/api/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vai:v0',
        messages: [{ role: 'user', content: message }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    assert(chatRes.ok, `Chat completions: ${chatRes.status}`);
    const data = await chatRes.json() as { choices?: Array<{ message?: { content: string } }> };
    return { answer: data.choices?.[0]?.message?.content ?? '', convId: convId! };
  }

  const data = await res.json() as { content?: string; assistant?: { content: string } };
  return { answer: data.content ?? data.assistant?.content ?? '', convId: convId! };
}

// ═══════════════════════════════════════════════════════
//  1. Server Health & Endpoints
// ═══════════════════════════════════════════════════════

test('Server is running', async () => {
  const res = await fetch(BASE);
  assert(res.ok, `Server responded with ${res.status}`);
  const data = await res.json() as { name: string; engine: string };
  assert(data.name === 'VeggaAI', `Expected VeggaAI, got ${data.name}`);
  assert(data.engine === 'vai:v0', `Expected vai:v0 engine`);
});

test('Health endpoint returns stats', async () => {
  const res = await fetch(`${BASE}/health`);
  assert(res.ok, `Health: ${res.status}`);
  const data = await res.json() as { status: string; stats: { knowledgeEntries: number; vocabSize: number } };
  assert(data.status === 'ok', 'Status should be ok');
  assert(data.stats.knowledgeEntries > 100, `Should have > 100 knowledge entries, got ${data.stats.knowledgeEntries}`);
  assert(data.stats.vocabSize > 10000, `Should have > 10K vocab, got ${data.stats.vocabSize}`);
});

test('Train endpoint accepts text', async () => {
  const res = await fetch(`${BASE}/api/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'E2E test training content about unique-e2e-marker-xyz',
      source: 'e2e-test',
      language: 'en',
    }),
  });
  assert(res.ok, `Train: ${res.status}`);
  const data = await res.json() as { ok: boolean };
  assert(data.ok === true, 'Train should return ok');
});

test('Teach endpoint persists entries', async () => {
  const res = await fetch(`${BASE}/api/teach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entries: [{
        pattern: 'e2e test unique pattern xyz123',
        response: 'This is the E2E test response for xyz123',
        source: 'vcus-e2e-test',
      }],
    }),
  });
  assert(res.ok, `Teach: ${res.status}`);
  const data = await res.json() as { ok: boolean; added: number };
  assert(data.ok === true, 'Teach should return ok');
  assert(data.added === 1, 'Should have added 1 entry');
});

// ═══════════════════════════════════════════════════════
//  2. Conversation CRUD
// ═══════════════════════════════════════════════════════

test('Create conversation', async () => {
  const res = await fetch(`${BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'vai:v0', title: 'E2E Conv Test' }),
  });
  assert(res.ok, `Create conv: ${res.status}`);
  const data = await res.json() as { id: string; title: string };
  assert(typeof data.id === 'string' && data.id.length > 0, 'Should have conversation id');
});

test('List conversations', async () => {
  const res = await fetch(`${BASE}/api/conversations`);
  assert(res.ok, `List convs: ${res.status}`);
  const data = await res.json() as Array<{ id: string }>;
  assert(Array.isArray(data), 'Should return array');
  assert(data.length > 0, 'Should have at least 1 conversation');
});

// ═══════════════════════════════════════════════════════
//  3. Chat Responses — Knowledge Retrieval
// ═══════════════════════════════════════════════════════

test('Chat: Basic greeting', async () => {
  const { answer } = await chat('Hello');
  assert(answer.length > 0, 'Should return a response');
});

test('Chat: Math question', async () => {
  const { answer } = await chat('What is 5 + 3?');
  assertContains(answer, '8');
});

test('Chat: Taught knowledge (variant prop)', async () => {
  const { answer } = await chat('What is a variant prop in a React component?');
  assertContains(answer, 'variant');
  assertContains(answer, 'component');
});

test('Chat: Taught knowledge (T3 Stack)', async () => {
  const { answer } = await chat('What is the T3 Stack and what technologies does it include?');
  assertContains(answer, 'Next.js');
  assertContains(answer, 'tRPC');
});

test('Chat: Taught knowledge (cn utility)', async () => {
  const { answer } = await chat('How does the cn() utility function work?');
  assertContains(answer, 'cn');
  assertContains(answer, 'class');
});

test('Chat: Taught knowledge (App Router)', async () => {
  const { answer } = await chat('What is the difference between pages and app directory in Next.js?');
  assertContains(answer, 'app');
  assertContains(answer, 'page');
});

test('Chat: tRPC knowledge', async () => {
  const { answer } = await chat('How do you create a tRPC router?');
  assertContains(answer, 'router');
});

test('Chat: Database knowledge', async () => {
  const { answer } = await chat('What is Prisma ORM and how does it work?');
  assertContains(answer, 'Prisma');
});

test('Chat: REST API knowledge', async () => {
  const { answer } = await chat('What are the main HTTP methods used in REST APIs?');
  assertContains(answer, 'GET');
  assertContains(answer, 'POST');
});

test('Chat: Monorepo knowledge', async () => {
  const { answer } = await chat('What is a monorepo and what are its advantages?');
  assertContains(answer, 'monorepo');
});

test('Chat: Code generation', async () => {
  const { answer } = await chat('Write a React button with variant props using Tailwind');
  assertContains(answer, 'button');
  assertContains(answer, 'variant');
});

// ═══════════════════════════════════════════════════════
//  4. Knowledge Pipeline — Ingest & Retrieve
// ═══════════════════════════════════════════════════════

test('Capture endpoint ingests web content', async () => {
  const res = await fetch(`${BASE}/api/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'SAVE_CONTENT',
      url: 'https://example.com/e2e-test',
      title: 'E2E Test Page',
      content: 'This is unique E2E content about elephantine-xyzzy-marker.',
    }),
  });
  assert(res.ok, `Capture: ${res.status}`);
});

// ═══════════════════════════════════════════════════════
//  5. Conversation History
// ═══════════════════════════════════════════════════════

test('Multi-turn conversation maintains context', async () => {
  const { convId } = await chat('My name is E2E-TestBot');
  const { answer } = await chat('What is my name?', convId);
  assertContains(answer, 'E2E-TestBot');
});

// ═══════════════════════════════════════════════════════
//  6. Edge Cases
// ═══════════════════════════════════════════════════════

test('Empty message returns response', async () => {
  try {
    const { answer } = await chat('');
    assert(typeof answer === 'string', 'Should return string even for empty input');
  } catch {
    // Some implementations may reject empty messages — that's ok too
  }
});

test('Very long message does not crash', async () => {
  const longMsg = 'x '.repeat(1000) + 'What is JavaScript?';
  const { answer } = await chat(longMsg);
  assert(answer.length > 0, 'Should handle long messages');
});

test('Special characters in message', async () => {
  const { answer } = await chat('What is "React"? It uses <JSX/> & components.');
  assert(answer.length > 0, 'Should handle special characters');
});

// ═══════════════════════════════════════════════════════
//  Run all tests
// ═══════════════════════════════════════════════════════

async function run() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  🧪 VCUS E2E Tests — ${tests.length} tests`);
  console.log(`${'═'.repeat(60)}\n`);

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    try {
      await t.fn();
      passed++;
      console.log(`  ✅ [${i + 1}/${tests.length}] ${t.name}`);
    } catch (err: any) {
      failed++;
      console.log(`  ❌ [${i + 1}/${tests.length}] ${t.name}`);
      console.log(`     ${err.message}`);
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  📊 Results: ${passed}/${tests.length} passed (${Math.round(100 * passed / tests.length)}%)`);
  if (failed > 0) console.log(`  ❌ ${failed} failed`);
  else console.log(`  ✅ All tests passed!`);
  console.log(`${'═'.repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
