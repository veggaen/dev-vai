/**
 * Honest Vai Quality Audit
 *
 * NOT a pass/fail test. This prints FULL answers so a human can judge.
 * Run: npx vitest run __tests__/honest-audit.test.ts --reporter=verbose
 */
import { describe, it } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

function makeEngine(): VaiEngine {
  const engine = new VaiEngine();
  // Simulate a user who taught Vai some stuff
  engine.train(`
Docker is a platform for containerizing applications. It packages code and dependencies
into images that run as containers. Docker Compose manages multi-container setups.
Key commands: docker build, docker run, docker-compose up.

Kubernetes orchestrates containers at scale. It manages pods (groups of containers),
services (networking), deployments (rolling updates), and ingress (external access).
kubectl is the CLI tool. Helm manages Kubernetes packages as charts.

React is a JavaScript library for building UIs with components and virtual DOM.
React hooks (useState, useEffect, useContext) manage state and side effects.
Next.js builds on React adding server-side rendering, file-based routing, and API routes.

TypeScript adds static types to JavaScript. It catches errors at compile time.
Key features: interfaces, generics, union types, type guards, and strict mode.
tsconfig.json configures the compiler.

PostgreSQL is a relational database with ACID transactions, JSON support, and
full-text search. It uses SQL for queries and supports indexes, views, and stored procedures.

MongoDB is a NoSQL document database storing flexible JSON-like documents.
It supports horizontal scaling through sharding and replica sets for availability.
Best for rapid prototyping and flexible schemas.

Git is version control. Key operations: commit, branch, merge, rebase, cherry-pick.
Git flow uses feature branches, develop, and main. GitHub adds pull requests and CI/CD.
  `);
  return engine;
}

async function ask(engine: VaiEngine, question: string, history: Array<{role: string; content: string}> = []) {
  const start = performance.now();
  const resp = await engine.chat({
    messages: [...history, { role: 'user' as const, content: question }],
  });
  const ms = Math.round(performance.now() - start);
  const a = resp.message.content;

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`🗣️  "${question}"`);
  console.log(`🤖  (${ms}ms, ${a.length} chars):\n`);
  console.log(a);

  // Quality signals
  const s: string[] = [];
  if (a.length < 20) s.push('⚠️ VERY SHORT');
  if (a.length < 50) s.push('⚠️ SHORT');
  if (a.includes('```')) s.push('💻 code');
  if (a.includes('|---|')) s.push('📊 table');
  if (a.includes('**')) s.push('✨ formatted');
  if (/don['']t know|not sure|no information/i.test(a)) s.push('🤷 uncertain');
  if (/teach me|learn more|tell me more/i.test(a)) s.push('🔄 asks-for-more');
  if (s.length) console.log(`  [${s.join(', ')}]`);

  return { answer: a, ms };
}

describe('Honest Vai Audit — READ THE OUTPUT', () => {
  // ─── BASIC KNOWLEDGE RECALL ───────────────────────────────────
  describe('1. Basic Questions (can Vai recall what it was taught?)', () => {
    const engine = makeEngine();

    it('What is Docker?', async () => {
      await ask(engine, 'What is Docker?');
    });

    it('How do React hooks work?', async () => {
      await ask(engine, 'How do React hooks work?');
    });

    it('What is TypeScript?', async () => {
      await ask(engine, 'What is TypeScript?');
    });

    it('What is Git?', async () => {
      await ask(engine, 'What is Git?');
    });
  });

  // ─── COMPARATIVE / COMPOUND ───────────────────────────────────
  describe('2. Compound Questions (the hard ones)', () => {
    const engine = makeEngine();

    it('Docker vs Kubernetes — what is the difference?', async () => {
      await ask(engine, "What's the difference between Docker and Kubernetes?");
    });

    it('PostgreSQL vs MongoDB', async () => {
      await ask(engine, 'Compare PostgreSQL and MongoDB');
    });

    it('React vs Vue', async () => {
      await ask(engine, 'React vs Vue - which should I use?');
    });

    it('How are TypeScript and JavaScript related?', async () => {
      await ask(engine, 'How are TypeScript and JavaScript related?');
    });
  });

  // ─── HOW-TO / PRACTICAL ───────────────────────────────────────
  describe('3. How-To Questions (does Vai give actionable answers?)', () => {
    const engine = makeEngine();

    it('How do I deploy a Node.js app with Docker?', async () => {
      await ask(engine, 'How do I deploy a Node.js app with Docker?');
    });

    it('How do I set up TypeScript in a new project?', async () => {
      await ask(engine, 'How do I set up TypeScript in a new project?');
    });

    it('How do I create a REST API?', async () => {
      await ask(engine, 'How do I create a REST API?');
    });

    it('How do I use Git branches?', async () => {
      await ask(engine, 'How do I use Git branches?');
    });
  });

  // ─── CONVERSATIONAL FLOW ──────────────────────────────────────
  describe('4. Conversation Flow (does context carry?)', () => {
    const engine = makeEngine();
    const history: Array<{role: string; content: string}> = [];

    it('Initial question then follow-up', async () => {
      const r1 = await ask(engine, 'What is Docker?', history);
      history.push({ role: 'user', content: 'What is Docker?' });
      history.push({ role: 'assistant', content: r1.answer });

      console.log('\n  ===== NOW ASKING FOLLOW-UP =====');
      const r2 = await ask(engine, 'Can you explain that more simply?', history);
      history.push({ role: 'user', content: 'Can you explain that more simply?' });
      history.push({ role: 'assistant', content: r2.answer });

      console.log('\n  ===== ASKING FOR EXAMPLE =====');
      await ask(engine, 'Can you show me an example?', history);
    });
  });

  // ─── GRACEFUL HANDLING ─────────────────────────────────────────
  describe('5. Edge Cases (how does Vai handle weird input?)', () => {
    const engine = makeEngine();

    it('empty string', async () => {
      await ask(engine, '');
    });

    it('gibberish', async () => {
      await ask(engine, 'asdfghjkl qwerty zxcvbn');
    });

    it('just "help"', async () => {
      await ask(engine, 'help');
    });

    it('just "hi"', async () => {
      await ask(engine, 'hi');
    });

    it('question about something never taught', async () => {
      await ask(engine, 'What is quantum computing?');
    });

    it('very long question', async () => {
      await ask(engine, 'I am building a web application using React and TypeScript with a PostgreSQL database and I want to deploy it using Docker and Kubernetes but I am not sure where to start can you help me plan the architecture and the deployment pipeline?');
    });
  });

  // ─── FRESHNESS of bootstrapped knowledge ───────────────────────
  describe('6. Bootstrap Knowledge (does the built-in knowledge actually help?)', () => {
    // Fresh engine — NO training, only bootstrap knowledge
    const engine = new VaiEngine();

    it('What is React? (no training, only bootstrap)', async () => {
      await ask(engine, 'What is React?');
    });

    it('Docker vs Kubernetes? (no training, only bootstrap)', async () => {
      await ask(engine, "What's the difference between Docker and Kubernetes?");
    });

    it('PostgreSQL vs MongoDB? (no training, only bootstrap)', async () => {
      await ask(engine, 'Compare PostgreSQL and MongoDB');
    });

    it('What is containerization? (no training, only bootstrap)', async () => {
      await ask(engine, 'What is containerization?');
    });
  });

  // ─── REAL-WORLD QUESTIONS USERS ACTUALLY ASK ───────────────────
  describe('7. Real-World Questions (what users really type)', () => {
    const engine = makeEngine();

    it('"Why" question — Why should I use TypeScript?', async () => {
      await ask(engine, 'Why should I use TypeScript instead of JavaScript?');
    });

    it('Best practice question — React project structure', async () => {
      await ask(engine, 'What is the best way to structure a React project?');
    });

    it('Debugging question — Docker container crashing', async () => {
      await ask(engine, 'My Docker container keeps crashing, how do I debug it?');
    });

    it('Informal with typos — "whats typescript"', async () => {
      await ask(engine, 'whats typescript');
    });

    it('Compound in one message — "What is Docker and how do I set it up?"', async () => {
      await ask(engine, 'What is Docker and how do I set it up?');
    });

    it('Partial knowledge — "Compare React and Svelte"', async () => {
      await ask(engine, 'Compare React and Svelte');
    });
  });

  // ─── MORE FOLLOW-UP PATTERNS ──────────────────────────────────
  describe('8. Extended Follow-up Flow (more detail, what about...)', () => {
    const engine = makeEngine();
    const history: Array<{role: string; content: string}> = [];

    it('Ask about Kubernetes then ask for more detail', async () => {
      const r1 = await ask(engine, 'What is Kubernetes?', history);
      history.push({ role: 'user', content: 'What is Kubernetes?' });
      history.push({ role: 'assistant', content: r1.answer });

      console.log('\n  ===== ASKING FOR MORE DETAIL =====');
      const r2 = await ask(engine, 'Can you tell me more about that?', history);
      history.push({ role: 'user', content: 'Can you tell me more about that?' });
      history.push({ role: 'assistant', content: r2.answer });

      console.log('\n  ===== ASKING "WHAT ABOUT" =====');
      await ask(engine, 'What about security in Kubernetes?', history);
    });
  });

  // ─── PERSONALITY & NATURALNESS ──────────────────────────────────
  describe('9. Does Vai feel alive? (personality, edge cases, naturalness)', () => {
    const engine = makeEngine();

    it('Empty message — should acknowledge, not pretend to answer', async () => {
      await ask(engine, '');
    });

    it('Keyboard noise — should recognize gibberish', async () => {
      await ask(engine, 'asdfghjkl qwerty zxcvbn');
    });

    it('Vague question — "how do I get started?"', async () => {
      await ask(engine, 'how do I get started?');
    });

    it('Opinion question — "React vs Vue which should I pick?"', async () => {
      await ask(engine, 'React vs Vue - which should I use?');
    });

    it('Follow-up with no history — "can you explain more?"', async () => {
      await ask(engine, 'Can you explain that more simply?');
    });

    it('TS-JS relationship — leads with the analogy?', async () => {
      await ask(engine, 'How are TypeScript and JavaScript related?');
    });

    it('Git overview — does it explain WHY, not just WHAT?', async () => {
      await ask(engine, 'What is Git?');
    });

    it('Quantum computing — formatted or raw dump?', async () => {
      await ask(engine, 'What is quantum computing?');
    });
  });
});
