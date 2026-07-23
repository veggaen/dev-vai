import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db/client.js';
import { ChatService } from '../src/chat/service.js';
import { ModelRegistry } from '../src/models/adapter.js';
import type {
  ModelAdapter,
  ChatRequest,
  ChatResponse,
  ChatChunk,
  Message,
  SearchSource,
  TurnThinking,
} from '../src/models/adapter.js';

/**
 * Orchestrator-integrity audit lane (Master.md §8 / §12.5.3).
 *
 * The decline detector and verification arm are unit-tested in isolation
 * (`vai-fallback.test.ts`, `response-verification.test.ts`). This lane is the
 * thing that was missing: it drives the **real `ChatService` orchestrator**
 * end-to-end — entrance gate (decline/low-confidence → escalate) AND exit gate
 * (sanitize / calibrate / confident-wrong) — and scores it.
 *
 * It is fast + deterministic (in-process, scripted adapters, `:memory:` db) so
 * the orchestrator lever is measurable in CI without the Playwright desktop
 * stack and without a live local model. The scale runner
 * (`scripts/vai-scale-engine.mjs`) drives the bare engine and never constructs
 * a ChatService, so before this lane nothing measured the orchestrator path.
 */

/** Programmable vai:v0 stand-in: emits a configurable (confidence, text, sources) per turn. */
class ProgrammableVai implements ModelAdapter {
  readonly id = 'vai:v0';
  readonly displayName = 'Programmable Vai';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;
  next: { text: string; confidence?: number; sources?: SearchSource[] } = { text: 'ok' };
  streamCalls = 0;

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return { message: { role: 'assistant', content: this.next.text }, finishReason: 'stop', modelId: 'vai:v0' };
  }

  async *chatStream(_request: ChatRequest): AsyncIterable<ChatChunk> {
    this.streamCalls += 1;
    const { text, confidence, sources } = this.next;
    if (confidence !== undefined || (sources && sources.length > 0)) {
      yield { type: 'sources', sources: sources ?? [], confidence } as ChatChunk;
    }
    yield { type: 'text_delta', textDelta: text } as ChatChunk;
    yield { type: 'done', modelId: 'vai:v0' } as ChatChunk;
  }
}

class FixedFallback implements ModelAdapter {
  readonly id = 'mock:fallback';
  readonly displayName = 'Fixed Fallback';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;
  streamCalls = 0;
  next = 'FALLBACK ANSWER';
  queued: string[] = [];
  lastMessages: readonly Message[] = [];

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return { message: { role: 'assistant', content: this.next }, finishReason: 'stop', modelId: 'mock:fallback' };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    this.streamCalls += 1;
    this.lastMessages = request.messages;
    yield { type: 'text_delta', textDelta: this.queued.shift() ?? this.next } as ChatChunk;
    yield { type: 'done', modelId: 'mock:fallback' } as ChatChunk;
  }
}

interface OrchestratorScenario {
  readonly label: string;
  readonly prompt: string;
  readonly mode?: 'chat' | 'builder';
  readonly vai: { text: string; confidence?: number; sources?: SearchSource[] };
  /** Text the escalated fallback model returns (defaults to 'FALLBACK ANSWER'). */
  readonly fallbackText?: string;
  /** Ordered fallback outputs for scenarios that exercise the bounded builder repair pass. */
  readonly fallbackTexts?: readonly string[];
  readonly requireEvidence?: boolean;
  readonly expect: {
    readonly escalates: boolean;
    readonly verificationAction?: 'sanitize' | 'calibrate' | 'decline';
    /** Substring the final surfaced + persisted text must contain. */
    readonly finalContains?: string;
    /** Substring the final surfaced + persisted text must NOT contain (leakage). */
    readonly finalExcludes?: string;
  };
}

interface OrchestratorOutcome {
  escalated: boolean;
  fallbackStreamed: boolean;
  fallbackStreamCalls: number;
  verificationAction: string | null;
  finalText: string;
  persistedText: string;
  fallbackSystemText: string;
  thinking: TurnThinking | null;
}

async function runScenario(scenario: OrchestratorScenario): Promise<OrchestratorOutcome> {
  const registry = new ModelRegistry();
  const vai = new ProgrammableVai();
  const fallback = new FixedFallback();
  registry.register(vai);
  registry.register(fallback);
  const svc = new ChatService(createDb(':memory:'), registry, {
    vaiFallbackChain: ['vai:v0', 'mock:fallback'],
    verification: scenario.requireEvidence ? { requireEvidenceForFactualClaims: true } : undefined,
    // This audit lane scores the legacy vai-first decline → escalate → verify
    // path; the primary-generative flip bypasses that arm for substantive turns.
    primaryGenerativeFlip: false,
  });
  vai.next = scenario.vai;
  if (scenario.fallbackText) fallback.next = scenario.fallbackText;
  if (scenario.fallbackTexts) fallback.queued = [...scenario.fallbackTexts];
  const convId = svc.createConversation('vai:v0', scenario.label, scenario.mode ?? 'chat');

  const chunks: ChatChunk[] = [];
  const priorCouncilFlag = process.env.VAI_COUNCIL_CODEGEN;
  process.env.VAI_COUNCIL_CODEGEN = '0';
  try {
    for await (const chunk of svc.sendMessage(convId, scenario.prompt)) {
      chunks.push(chunk);
    }
  } finally {
    if (priorCouncilFlag === undefined) {
      delete process.env.VAI_COUNCIL_CODEGEN;
    } else {
      process.env.VAI_COUNCIL_CODEGEN = priorCouncilFlag;
    }
  }

  const finalText = chunks
    .filter((c) => c.type === 'text_delta')
    .map((c) => c.textDelta)
    .join('');
  return {
    escalated: chunks.some((c) => c.type === 'fallback_notice'),
    fallbackStreamed: fallback.streamCalls > 0,
    fallbackStreamCalls: fallback.streamCalls,
    verificationAction: chunks.find((c) => c.type === 'verification')?.verification?.action ?? null,
    finalText,
    persistedText: svc.getMessages(convId).at(-1)?.content ?? '',
    fallbackSystemText: fallback.lastMessages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n'),
    thinking: chunks.find((c) => c.type === 'done')?.thinking ?? null,
  };
}

const SCENARIOS: readonly OrchestratorScenario[] = [
  {
    label: 'novel decline wording escalates to the fallback model',
    prompt: 'Help me with the migration',
    vai: { text: "Honestly i don't know enough about that to give a real answer.", confidence: 0.8 },
    expect: { escalates: true, finalContains: 'FALLBACK ANSWER' },
  },
  {
    label: 'low confidence escalates even when the text reads like an answer',
    prompt: 'Help me choose a database',
    vai: { text: 'A tentative partial take on the tradeoffs.', confidence: 0.2 },
    expect: { escalates: true, finalContains: 'FALLBACK ANSWER' },
  },
  {
    label: 'high-confidence clean answer passes through with no escalation, no verdict',
    prompt: 'Name a variable for pending invoices',
    vai: { text: 'Use `pendingInvoices` for pending invoices; it is descriptive and plural.', confidence: 0.9 },
    expect: { escalates: false, finalContains: 'pendingInvoices' },
  },
  {
    label: 'scaffolding leak is sanitized out of the surfaced + persisted text',
    prompt: 'Help me with caching',
    vai: { text: '[scratch] thinking out loud about the next turn\nUse a connection pool with a TTL.', confidence: 0.9 },
    expect: { escalates: false, verificationAction: 'sanitize', finalContains: 'connection pool', finalExcludes: 'scratch' },
  },
  {
    label: 'thin confidence is calibrated, not presented as certainty',
    prompt: 'Should I shard the orders table by tenant id?',
    vai: { text: 'You should shard the orders table by tenant id.', confidence: 0.5 },
    expect: { escalates: false, verificationAction: 'calibrate', finalContains: 'shard the orders table' },
  },
  {
    label: 'confident-but-unsupported factual claim is calibrated (no confident-wrong leak)',
    prompt: 'Does Tesla manufacture smartphones?',
    vai: { text: 'Yes, Tesla manufactures smartphones.', confidence: 0.7 },
    requireEvidence: true,
    expect: { escalates: false, verificationAction: 'calibrate', finalContains: 'Tesla manufactures smartphones' },
  },
  {
    // Surfaced by the live trace: asked about Zorblax-7/Flimsy, the engine
    // confidently answered about Rust. The topical-mismatch detector escalates
    // it instead of leaking the article-hijack.
    label: 'confident-wrong about a different named entity escalates (article-hijack)',
    prompt: "what's your honest take on the Zorblax-7 concurrency model in the Flimsy programming language?",
    vai: {
      text: 'Rust is a systems programming language focused on safety, speed, and concurrency, created by Mozilla, with an ownership system, zero-cost abstractions, and fearless concurrency across threads in production systems today.',
      confidence: 0.8,
    },
    expect: { escalates: true, finalContains: 'FALLBACK ANSWER' },
  },
  {
    // FP guard: a genuine on-topic answer that echoes the asked subject must NOT escalate.
    label: 'genuine on-topic answer about the asked entity passes (no false escalation)',
    prompt: 'How does Rust handle concurrency safely?',
    vai: {
      text: 'Rust handles concurrency safely through its ownership and borrow checker, so data races are caught at compile time; prefer channels or Arc<Mutex<T>> depending on contention and sharing needs in your services.',
      confidence: 0.8,
    },
    expect: { escalates: false, finalContains: 'ownership' },
  },
  {
    // Builder Mode 2.0: a generic scaffold that doesn't satisfy the request escalates
    // to the generative module instead of shipping boilerplate as "done".
    label: 'builder scaffold that misses the request escalates (Builder 2.0)',
    // A builder-mode brief without an explicit execute-now verb still exercises
    // the preliminary artifact gate. Explicit execution requests deliberately
    // bypass this draft and go straight to the capable builder arm.
    prompt: 'Shared shopping list app with household members, grouped items, and an activity feed.',
    mode: 'builder',
    vai: {
      text: '```json title="package.json"\n{"name":"my-app","type":"module","scripts":{"dev":"vite"}}\n```\n```tsx title="src/App.tsx"\nexport default function App() { return <div>Hello</div>; }\n```',
      confidence: 0.9,
    },
    fallbackText: 'FALLBACK ANSWER',
    expect: { escalates: true, finalContains: 'FALLBACK ANSWER' },
  },
  {
    // Builder Mode 2.0 precision: a builder artifact that DOES satisfy the request is kept (no escalation).
    label: 'satisfying builder artifact is kept (no false escalation)',
    // Keep this as a builder brief (not an execute-now command) so the
    // preliminary-artifact satisfaction gate is the behavior under test.
    prompt: 'Shared shopping list app with household members, grouped items, and an activity feed.',
    mode: 'builder',
    vai: {
      text: '```tsx title="src/App.tsx"\n// shared shopping list; household members add grouped items; activity feed shows changes\nexport default function App(){ return <ShoppingList household={members} activity={feed} items={grouped} />; }\n```',
      confidence: 0.9,
    },
    expect: { escalates: false, finalContains: 'ShoppingList' },
  },
  {
    // Fallback-Arm Verification (§12.5.3): the escalated local model itself
    // confidently answers about a different entity → calibrated, not leaked.
    label: 'confident-wrong from the fallback model is calibrated on the way out',
    prompt: "what's your honest take on the Zorblax-7 concurrency model in the Flimsy programming language?",
    vai: { text: "I don't have a confident answer for that yet.", confidence: 0.3 },
    fallbackText:
      'Rust is a systems programming language created by Mozilla, focused on safety and concurrency, with an ownership model and zero-cost abstractions used across production server systems today.',
    expect: { escalates: true, verificationAction: 'calibrate', finalContains: 'Rust is a systems programming language' },
  },
];

describe('orchestrator-integrity audit lane', () => {
  it('scores the live decline → escalate → verify path at 100% across the labeled pool', async () => {
    const results: Array<{ scenario: OrchestratorScenario; outcome: OrchestratorOutcome; pass: boolean; why: string[] }> = [];

    for (const scenario of SCENARIOS) {
      const outcome = await runScenario(scenario);
      const why: string[] = [];

      if (outcome.escalated !== scenario.expect.escalates) {
        why.push(`escalates: got ${outcome.escalated}, want ${scenario.expect.escalates}`);
      }
      if (scenario.expect.escalates && !outcome.fallbackStreamed) {
        why.push('escalation fired but fallback model never streamed');
      }
      if (scenario.expect.verificationAction && outcome.verificationAction !== scenario.expect.verificationAction) {
        why.push(`verificationAction: got ${outcome.verificationAction}, want ${scenario.expect.verificationAction}`);
      }
      if (scenario.expect.finalContains && !outcome.finalText.includes(scenario.expect.finalContains)) {
        why.push(`finalText missing "${scenario.expect.finalContains}" (got "${outcome.finalText.slice(0, 80)}")`);
      }
      if (scenario.expect.finalExcludes && outcome.finalText.toLowerCase().includes(scenario.expect.finalExcludes.toLowerCase())) {
        why.push(`finalText leaked "${scenario.expect.finalExcludes}"`);
      }
      // The persisted record must always match what the user actually saw — and
      // must never contain a stripped leak.
      if (scenario.expect.finalExcludes && outcome.persistedText.toLowerCase().includes(scenario.expect.finalExcludes.toLowerCase())) {
        why.push(`persisted record leaked "${scenario.expect.finalExcludes}"`);
      }

      results.push({ scenario, outcome, pass: why.length === 0, why });
    }

    const failures = results.filter((r) => !r.pass);
    const report = failures.map((r) => `  ✗ ${r.scenario.label}: ${r.why.join('; ')}`).join('\n');
    expect(failures, `orchestrator-integrity failures:\n${report}`).toEqual([]);

    // Aggregate scoreboard (mirrors the entrance/exit gate metrics).
    const escalationCases = results.filter((r) => r.scenario.expect.escalates);
    const escalationRecall = escalationCases.filter((r) => r.outcome.escalated && r.outcome.fallbackStreamed).length / escalationCases.length;
    const noEscalateCases = results.filter((r) => !r.scenario.expect.escalates);
    const escalationPrecision = noEscalateCases.filter((r) => !r.outcome.escalated).length / noEscalateCases.length;

    expect(escalationRecall).toBe(1);
    expect(escalationPrecision).toBe(1);
  });

  it('gives an escalated builder arm a concise file-output recovery contract and an inspectable trace', async () => {
    const outcome = await runScenario({
      label: 'builder fallback contract and trace',
      prompt: 'Build a shared shopping list app with household members, grouped items, and an activity feed.',
      mode: 'builder',
      vai: {
        text: '```tsx title="src/App.tsx"\nexport default function App() { return <div>Hello</div>; }\n```',
        confidence: 0.9,
      },
      fallbackText: [
        '```tsx title="src/App.tsx"',
        "import { useState } from 'react';",
        'export default function App() {',
        "  const [items, setItems] = useState(['Coffee', 'Rice']);",
        "  const addItem = () => setItems((current) => [...current, 'New item']);",
        '  return <main className="shopping-shell"><header><p>Household members</p><h1>Shared Shopping List</h1></header><section className="grouped-items"><h2>Grouped items</h2>{items.map((item) => <button key={item}>{item}</button>)}</section><aside className="activity-feed"><h2>Activity feed</h2><p>ShoppingList updated by the household.</p></aside><button className="primary-action" onClick={addItem}>Add item</button></main>;',
        '}',
        '```',
        '```css title="src/styles.css"',
        ':root { font-family: Inter, sans-serif; background: #0f172a; color: #f8fafc; }',
        '* { box-sizing: border-box; }',
        'body { margin: 0; min-height: 100vh; }',
        '.shopping-shell { width: min(900px, 92vw); margin: 0 auto; padding: 3rem; }',
        'header { display: grid; gap: .5rem; }',
        'h1 { font-size: 2.5rem; }',
        '.grouped-items { display: grid; gap: .75rem; }',
        '.activity-feed { margin-top: 2rem; padding: 1rem; }',
        'button { border: 0; border-radius: .75rem; padding: .8rem 1rem; }',
        '.primary-action { margin-top: 1.5rem; background: #38bdf8; }',
        'button:hover, button:focus { transform: translateY(-1px); }',
        '```',
      ].join('\n'),
      expect: { escalates: true, finalContains: 'ShoppingList' },
    });

    expect(outcome.fallbackSystemText).toMatch(/escalated Builder Mode recovery turn/i);
    expect(outcome.fallbackSystemText).toMatch(/title="path\/to\/file"/i);
    expect(outcome.fallbackSystemText).toMatch(/do not stop at a generic scaffold/i);
    expect(outcome.fallbackSystemText).not.toMatch(/correct package\.json for next\.js/i);
    expect(outcome.fallbackSystemText.length).toBeLessThan(2_000);
    expect(outcome.thinking?.intent).toBe('build');
    expect(outcome.thinking?.strategyChain).toEqual([
      // Explicit execution requests skip the preliminary deterministic draft,
      // so this is a direct capable-model handoff rather than a rejected draft.
      'fallback:low-confidence',
      'escalate:mock:fallback',
      'verify:builder-satisfied',
    ]);
    expect(outcome.thinking?.processTrace?.at(-1)?.stage).toBe('tracked:fallback:verify:builder-satisfied');
  }, 20_000);

  it('records the exit-gate verdict in the synthetic trace for calibrated fallback answers', async () => {
    const outcome = await runScenario({
      label: 'fallback calibration trace',
      prompt: "what's your honest take on the Zorblax-7 concurrency model in the Flimsy programming language?",
      vai: { text: "I don't have a confident answer for that yet.", confidence: 0.3 },
      fallbackText:
        'Rust is a systems programming language created by Mozilla, focused on safety and concurrency, with an ownership model and zero-cost abstractions used across production server systems today.',
      expect: { escalates: true, verificationAction: 'calibrate', finalContains: 'Rust is a systems programming language' },
    });

    expect(outcome.thinking?.strategyChain).toContain('verify:calibrate:contradicted');
    expect(outcome.thinking?.processTrace?.at(-1)?.stage).toBe('tracked:fallback:verify:calibrate:contradicted');
  });

  it('repairs one weak builder fallback once and keeps the stronger standalone artifact', async () => {
    const outcome = await runScenario({
      label: 'bounded builder fallback repair',
      prompt: 'Build a focus planner with pomodoro sessions, a task list, and a streak counter.',
      mode: 'builder',
      vai: {
        text: '```tsx title="src/App.tsx"\nexport default function App() { return <div>Hello</div>; }\n```',
        confidence: 0.9,
      },
      fallbackTexts: [
        '```html\n<!doctype html><html><body><h1>Focus Planner</h1><section>Task list</section><output>Streak counter</output></body></html>\n```',
        [
          '```html title="index.html"',
          '<!doctype html><html><head><style>',
          ':root{font-family:Inter,sans-serif;background:#111827;color:#f9fafb}',
          '*{box-sizing:border-box}',
          'body{margin:0;min-height:100vh}',
          'main{width:min(760px,92vw);margin:auto;padding:3rem}',
          'header{display:grid;gap:.5rem}',
          'section{margin-top:1rem;padding:1rem;background:#1f2937}',
          'h1{font-size:2.5rem}',
          'button{border:0;border-radius:.75rem;padding:.75rem 1rem}',
          '.tasks{display:grid;gap:.75rem}',
          'output{display:block;margin-top:1rem}',
          'button:hover,button:focus{background:#38bdf8}',
          '</style></head><body><main><header><h1>Focus Planner</h1></header><section>Pomodoro sessions <button>Start session</button></section><section class="tasks">Task list <button>Add task</button></section><output>Streak counter</output></main></body></html>',
          '```',
        ].join('\n'),
      ],
      expect: { escalates: true, finalContains: 'Streak counter' },
    });

    expect(outcome.fallbackStreamCalls).toBe(2);
    expect(outcome.finalText).toContain('```html title="index.html"');
    expect(outcome.thinking?.strategyChain).toContain('verify:builder-retry-satisfied');
  });
});
