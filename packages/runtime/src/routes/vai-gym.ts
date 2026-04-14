/**
 * Vai Gymnasium Routes — /api/vai/*
 *
 * Server-side routes for grading and generating training scenarios.
 * Proxies to Anthropic Claude API so the client never exposes the API key.
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import type { FastifyInstance } from 'fastify';
import { executePipeline } from '@vai/core';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-5-20250514';

function getApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? null;
}

/* ── Grading system prompt ─────────────────────────────────────── */

const GRADING_SYSTEM = `You are a strict grading system for an AI training gymnasium. You grade responses on a 0-100 scale across 6 dimensions. Be honest and demanding — this AI is trying to become world-class.

Return ONLY valid JSON (no markdown, no backticks, no explanation) in this exact format:
{"scores":{"accuracy":0-100,"compression":0-100,"foundation-fit":0-100,"anti-pattern-avoidance":0-100,"vetle-alignment":0-100,"actionability":0-100},"overall":0-100,"feedback":"2-3 sentences of specific, actionable feedback","anti_patterns_triggered":["list of anti-pattern IDs triggered, or empty array"],"strengths":["1-2 specific things done well"],"improvements":["1-2 specific things to improve"]}`;

/* ── Foundation data (needed for generation prompt) ─────────────── */

const FOUNDATIONS_MAP: Record<string, { name: string; desc: string }> = {
  'first-principles': { name: 'First-Principles Reasoning', desc: 'Decompose to fundamentals. Never pattern-match from past answers.' },
  'calibrated-uncertainty': { name: 'Calibrated Uncertainty', desc: 'Know what you know. Express confidence honestly. Never bullshit.' },
  'meta-learning': { name: 'Meta-Learning', desc: 'Extract generalizable patterns from every interaction.' },
  'reading-between-lines': { name: 'Reading Between the Lines', desc: "Understand what's NOT said. The question behind the question." },
  'precision-communication': { name: 'Precision Communication', desc: 'Say exactly what you mean. No more, no less.' },
  'right-question': { name: 'Asking the Right Question', desc: 'The quality of answers is bounded by question quality.' },
  'compression': { name: 'Compression & Abstraction', desc: 'Shortest accurate answer wins. Find the skeleton of any problem.' },
  'systems-thinking': { name: 'Systems Thinking', desc: 'Every change affects other things. Map the blast radius.' },
  'taste-judgment': { name: 'Taste & Judgment', desc: "Know when something is 'right' vs 'works'. The $10 vs $100M difference." },
  'intellectual-honesty': { name: 'Intellectual Honesty', desc: "Seek evidence you're wrong. Update beliefs. Never motivated reasoning." },
  'adaptive-depth': { name: 'Adaptive Depth', desc: 'Calibrate response depth to question complexity. Simple question = short answer.' },
  'proactive-reframing': { name: 'Proactive Reframing', desc: 'Address the stated question AND offer a better framing when the original is suboptimal.' },
  'epistemic-transparency': { name: 'Epistemic Transparency', desc: 'Match confidence markers to actual certainty. Never fake certainty.' },
  'narrative-coherence': { name: 'Narrative Coherence', desc: 'Maintain context across turns. Build on prior conversation, never lose the thread.' },
  'teaching-velocity': { name: 'Teaching Velocity', desc: 'Help the user need you less over time. Transfer understanding, not just answers.' },
};

/* ── Generation system prompt ──────────────────────────────────── */

const GENERATION_SYSTEM = `You generate training scenarios for an AI apprentice called Vai. Vai serves a developer named Vegga who builds SaaS frameworks, websites, game servers, and tools. The scenarios must be realistic software development situations.

Return ONLY valid JSON (no markdown, no backticks):
{"situation":"The prompt Vegga gives Vai (1-2 sentences, realistic)","hidden_need":"What Vegga actually needs (the question behind the question)","ideal_traits":["3-4 traits the ideal response should have"],"anti_pattern_traps":["1-2 anti-pattern IDs from: bullshitter, hedger, template-matcher, sycophant, over-generator, literal-interpreter"],"grading_rubric":"How to score responses (2-3 sentences)"}`;

/* ── Anthropic API call helper ─────────────────────────────────── */

async function callAnthropic(system: string, userMessage: string, apiKey: string): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
  }

  const data = await res.json() as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? '';
  return text.replace(/```json|```/g, '').trim();
}

/* ── Route registration ────────────────────────────────────────── */

interface GradeBody {
  scenario: {
    situation: string;
    hidden_need: string;
    foundation: string;
    anti_pattern_traps: string[];
    ideal_traits: string[];
    grading_rubric: string;
  };
  response: string;
}

interface GenerateBody {
  foundation: string;
  difficulty: string;
}

interface TrainBody {
  foundation?: string;
  difficulty?: string;
  response?: string; // If provided, also grade it
}

export function registerVaiGymRoutes(app: FastifyInstance) {
  /**
   * POST /api/vai/grade — Grade a response against a scenario
   */
  app.post<{ Body: GradeBody }>('/api/vai/grade', async (request, reply) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return reply.status(500).send({ error: 'ANTHROPIC_API_KEY not set' });
    }

    const { scenario, response } = request.body;
    if (!scenario || !response) {
      return reply.status(400).send({ error: 'Missing scenario or response' });
    }

    const userMessage = `Grade this response to a training scenario.

SCENARIO: ${scenario.situation}
HIDDEN NEED: ${scenario.hidden_need}
TARGET FOUNDATION: ${scenario.foundation}
ANTI-PATTERN TRAPS: ${scenario.anti_pattern_traps.join(', ')}
IDEAL TRAITS: ${scenario.ideal_traits.join('; ')}
GRADING RUBRIC: ${scenario.grading_rubric}

RESPONSE TO GRADE:
${response}

Grade strictly. 70+ is good. 85+ is excellent. 95+ is exceptional. Most responses should score 50-80.`;

    try {
      const text = await callAnthropic(GRADING_SYSTEM, userMessage, apiKey);
      const grade = JSON.parse(text);
      return grade;
    } catch (err) {
      console.error('[VaiGym] Grading failed:', err);
      return reply.status(500).send({ error: 'Grading failed', detail: String(err) });
    }
  });

  /**
   * POST /api/vai/generate — Generate a custom training scenario
   */
  app.post<{ Body: GenerateBody }>('/api/vai/generate', async (request, reply) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return reply.status(500).send({ error: 'ANTHROPIC_API_KEY not set' });
    }

    const { foundation, difficulty } = request.body;
    if (!foundation || !difficulty) {
      return reply.status(400).send({ error: 'Missing foundation or difficulty' });
    }

    const f = FOUNDATIONS_MAP[foundation];
    if (!f) {
      return reply.status(400).send({ error: `Unknown foundation: ${foundation}` });
    }

    const userMessage = `Generate a ${difficulty}-level training scenario for the foundation: "${f.name}" — ${f.desc}

Difficulty guide:
- apprentice: Straightforward, one right answer, clear trap to avoid
- journeyman: Nuanced, requires judgment, multiple valid approaches
- expert: Ambiguous, requires deep reasoning, multiple traps
- master: Adversarial, emotionally charged, requires wisdom + technical skill

Make it a REALISTIC scenario Vegga would actually face while building software. Not abstract or academic.`;

    try {
      const text = await callAnthropic(GENERATION_SYSTEM, userMessage, apiKey);
      const parsed = JSON.parse(text);
      return { ...parsed, foundation, difficulty };
    } catch (err) {
      console.error('[VaiGym] Generation failed:', err);
      return reply.status(500).send({ error: 'Generation failed', detail: String(err) });
    }
  });

  /**
   * POST /api/vai/train — Run a full training round (generate + grade)
   * This is the autonomous training endpoint for when Vai trains itself.
   */
  app.post<{ Body: TrainBody }>('/api/vai/train', async (request, reply) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return reply.status(500).send({ error: 'ANTHROPIC_API_KEY not set' });
    }

    const { foundation: reqFoundation, difficulty = 'apprentice', response: providedResponse } = request.body;

    // Pick a random foundation if none specified
    const allFoundations = Object.keys(FOUNDATIONS_MAP);
    const foundation = reqFoundation ?? allFoundations[Math.floor(Math.random() * allFoundations.length)];
    const f = FOUNDATIONS_MAP[foundation];
    if (!f) {
      return reply.status(400).send({ error: `Unknown foundation: ${foundation}` });
    }

    // Step 1: Generate scenario
    const genMessage = `Generate a ${difficulty}-level training scenario for: "${f.name}" — ${f.desc}. Make it realistic.`;
    let scenario;
    try {
      const genText = await callAnthropic(GENERATION_SYSTEM, genMessage, apiKey);
      scenario = JSON.parse(genText);
      scenario.foundation = foundation;
      scenario.difficulty = difficulty;
    } catch (err) {
      return reply.status(500).send({ error: 'Scenario generation failed', detail: String(err) });
    }

    // Step 2: Generate Vai's response (or use provided one)
    let vaiResponse = providedResponse;
    if (!vaiResponse) {
      try {
        const respText = await callAnthropic(
          'You are Vai, an AI assistant trained to help developer Vegga Thorsen. Respond to the following scenario naturally and concisely. Apply everything you know about good AI assistance — first-principles reasoning, calibrated uncertainty, precision, compression, and intellectual honesty.',
          `Scenario: ${scenario.situation}`,
          apiKey,
        );
        vaiResponse = respText;
      } catch (err) {
        return reply.status(500).send({ error: 'Response generation failed', detail: String(err) });
      }
    }

    // Step 3: Grade the response
    const gradeMessage = `Grade this response to a training scenario.

SCENARIO: ${scenario.situation}
HIDDEN NEED: ${scenario.hidden_need}
TARGET FOUNDATION: ${foundation}
ANTI-PATTERN TRAPS: ${(scenario.anti_pattern_traps ?? []).join(', ')}
IDEAL TRAITS: ${(scenario.ideal_traits ?? []).join('; ')}
GRADING RUBRIC: ${scenario.grading_rubric ?? 'Standard rubric'}

RESPONSE TO GRADE:
${vaiResponse}

Grade strictly. 70+ is good. 85+ is excellent. 95+ is exceptional.`;

    let grade;
    try {
      const gradeText = await callAnthropic(GRADING_SYSTEM, gradeMessage, apiKey);
      grade = JSON.parse(gradeText);
    } catch (err) {
      return reply.status(500).send({ error: 'Grading failed', detail: String(err) });
    }

    return {
      scenario,
      response: vaiResponse,
      grade,
      meta: { foundation, difficulty, timestamp: new Date().toISOString() },
    };
  });

  /* ── Thorsen Drill Generator (deterministic, no API key needed) ─ */

  /**
   * POST /api/vai/thorsen-drill — Generate a VaiGym scenario from Thorsen.
   * Uses the create:vai-drill:functional template for deterministic drill
   * generation without requiring an API key. Maps drill categories to
   * VaiGym foundations automatically.
   */
  interface ThorsenDrillBody {
    foundation?: string;
    difficulty?: string;
    seed?: number;
  }

  const DIFFICULTY_NUM_TO_LABEL: Record<number, string> = {
    1: 'apprentice', 2: 'apprentice', 3: 'journeyman', 4: 'expert', 5: 'master',
  };

  app.post<{ Body: ThorsenDrillBody }>('/api/vai/thorsen-drill', async (request, reply) => {
    const { foundation, difficulty = 'apprentice', seed } = request.body ?? {};
    const drillSeed = seed ?? Math.floor(Math.random() * 1000);

    try {
      // Call Thorsen pipeline for drill generation (validates the pipeline is alive)
      const response = await executePipeline({
        action: 'create',
        domain: 'vai-drill',
        logicType: 'functional',
        targetEnv: 'node',
        language: 'typescript',
        spec: `drill-seed-${drillSeed}`,
        constraints: ['typed'],
        timestampUs: Date.now() * 1000,
      }, { traceMode: false });

      // Foundation-aware drill selection:
      // If a foundation is specified, pick from that foundation's pool.
      // Otherwise, pick from all 30 drills across 10 foundations.
      const allDrills = getFoundationDrills(drillSeed);
      const pool = foundation
        ? allDrills.filter(d => d.foundation === foundation)
        : allDrills;

      if (pool.length === 0) {
        return reply.status(400).send({ error: `No drills for foundation: ${foundation}` });
      }

      const drill = pool[drillSeed % pool.length];
      const mappedDifficulty = difficulty ?? DIFFICULTY_NUM_TO_LABEL[drill.difficulty] ?? 'apprentice';
      const foundationMeta = FOUNDATIONS_MAP[drill.foundation];

      const scenario = {
        foundation: drill.foundation,
        difficulty: mappedDifficulty,
        situation: drill.prompt,
        hidden_need: `This drill targets "${foundationMeta?.name ?? drill.foundation}": ${foundationMeta?.desc ?? ''}. The ideal answer demonstrates ${drill.scoringCriteria.map((c: { factor: string }) => c.factor).join(', ')}. Full answer: ${drill.expectedAnswer.substring(0, 120)}...`,
        ideal_traits: [
          `Demonstrates ${foundationMeta?.name ?? drill.foundation}`,
          'Clear step-by-step reasoning',
          ...drill.hints.slice(0, 2).map((h: string) => `Uses insight: ${h}`),
        ],
        anti_pattern_traps: drill.antiPatterns,
        grading_rubric: drill.scoringCriteria
          .map((c: { factor: string; weight: number }) => `${c.factor} (${Math.round(c.weight * 100)}%)`)
          .join(', ') + `. Time limit: ${drill.timeLimit}s. ${drill.title}.`,
      };

      return {
        ...scenario,
        _thorsen: {
          templateKey: 'create:vai-drill:functional',
          drillId: drill.id,
          drillTitle: drill.title,
          drillFoundation: drill.foundation,
          expectedAnswer: drill.expectedAnswer,
          scoringCriteria: drill.scoringCriteria,
          hints: drill.hints,
          thorsenScore: response.artifact.thorsenScore,
          syncState: response.sync.state,
          latencyMs: response.sync.latencyMs,
          totalDrills: allDrills.length,
          foundationDrills: pool.length,
        },
      };
    } catch (err) {
      console.error('[VaiGym] Thorsen drill generation failed:', err);
      return reply.status(500).send({ error: 'Thorsen drill failed', detail: String(err) });
    }
  });

  /** GET /api/vai/thorsen-drill/stats — Drill pool stats for the UI */
  app.get('/api/vai/thorsen-drill/stats', async () => {
    const drills = getFoundationDrills(0);
    const byFoundation: Record<string, number> = {};
    for (const d of drills) {
      byFoundation[d.foundation] = (byFoundation[d.foundation] ?? 0) + 1;
    }
    return {
      total: drills.length,
      foundations: Object.keys(byFoundation).length,
      byFoundation,
    };
  });
}

/* ── Foundation-Aware Drill System ───────────────────────────── */

interface FoundationDrill {
  id: string;
  title: string;
  foundation: string;
  category: string;
  difficulty: number;
  prompt: string;
  expectedAnswer: string;
  hints: string[];
  antiPatterns: string[];
  timeLimit: number;
  scoringCriteria: { factor: string; weight: number }[];
}

/**
 * 30 drills across 10 foundations (3 per foundation).
 * Each drill is specifically designed to exercise that reasoning skill.
 * Foundation drives selection — not category.
 */
function getFoundationDrills(seed: number): FoundationDrill[] {
  return [
    /* ─── first-principles (Decompose to fundamentals) ──────── */
    {
      id: `fp-decompose-${seed}`,
      title: 'Why Does This Work?',
      foundation: 'first-principles',
      category: 'logic',
      difficulty: 3,
      prompt: 'A binary search finds an element in a sorted array in O(log n). WITHOUT referencing the algorithm name or pattern, derive from scratch WHY halving the search space each step yields logarithmic time. Prove it from first principles.',
      expectedAnswer: 'Start with n elements. Each comparison eliminates half. After k steps: n/2^k elements remain. We stop when n/2^k = 1, so k = log2(n). Each step is O(1) work, total = O(log n). The key insight: any process that halves a quantity k times reduces it by factor 2^k.',
      hints: ['Don\'t name the algorithm — derive the math', 'Think about what "halving" means repeated k times'],
      antiPatterns: ['template-matcher', 'literal-interpreter'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'derivation-from-fundamentals', weight: 0.4 }, { factor: 'mathematical-rigor', weight: 0.3 }, { factor: 'independence-from-memorized-answer', weight: 0.3 }],
    },
    {
      id: `fp-scratch-${seed}`,
      title: 'Build Without Libraries',
      foundation: 'first-principles',
      category: 'code',
      difficulty: 4,
      prompt: 'Implement a reactive signal system from scratch (like SolidJS signals). Just createSignal(initialValue) returning [getter, setter], and createEffect(fn) that auto-tracks dependencies and re-runs when signals change. No frameworks. Explain every design choice.',
      expectedAnswer: 'Global tracking stack for active effects. createSignal returns getter (registers current effect as subscriber) and setter (notifies all subscribers). createEffect pushes itself onto stack, runs fn (which calls getters that subscribe), pops stack. Key: fine-grained dependency tracking via closure + Set<Effect>.',
      hints: ['You need a global "currently running effect" tracker', 'Getters register, setters notify'],
      antiPatterns: ['template-matcher', 'over-generator'],
      timeLimit: 300,
      scoringCriteria: [{ factor: 'correctness', weight: 0.3 }, { factor: 'design-reasoning', weight: 0.3 }, { factor: 'no-framework-reliance', weight: 0.2 }, { factor: 'clarity', weight: 0.2 }],
    },
    {
      id: `fp-assumption-${seed}`,
      title: 'Challenge the Assumption',
      foundation: 'first-principles',
      category: 'logic',
      difficulty: 3,
      prompt: 'A PM says: "We need to add caching to make the API faster." Before implementing, identify ALL the hidden assumptions in this statement. For each, explain why it might be wrong and what you\'d verify first.',
      expectedAnswer: 'Assumptions: 1) The API IS slow (verify with metrics). 2) The bottleneck is repeated computation (could be network/DB). 3) Caching will help (cold cache, cache invalidation complexity). 4) We need it NOW (premature optimization?). 5) A cache is the right solution (maybe the query needs an index). Verify: measure first, identify bottleneck, then decide.',
      hints: ['Count how many things the PM assumed without stating', 'What if the API isn\'t actually slow?'],
      antiPatterns: ['sycophant', 'literal-interpreter'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'assumptions-identified', weight: 0.4 }, { factor: 'verification-plan', weight: 0.3 }, { factor: 'critical-thinking', weight: 0.3 }],
    },

    /* ─── calibrated-uncertainty (Know what you know) ──────── */
    {
      id: `cu-confidence-${seed}`,
      title: 'Confidence Calibration',
      foundation: 'calibrated-uncertainty',
      category: 'math',
      difficulty: 3,
      prompt: 'For each claim, assign a confidence percentage (0-100%) and justify it in one sentence:\n1. React re-renders when state changes\n2. TCP guarantees in-order delivery\n3. JavaScript sorts numbers correctly with [].sort()\n4. Redis is single-threaded\n5. git rebase always rewrites history',
      expectedAnswer: '1. 95% — true by design, but memoized/pure components can skip. 2. 90% — TCP guarantees ordering within a stream, but app-level reordering can still occur across connections. 3. 10% — WRONG: sort() compares as strings by default, [10,2,1].sort() → [1,10,2]. 4. 70% — mostly true for command processing, but Redis 6+ uses I/O threads. 5. 80% — interactive rebase CAN rewrite, but rebase onto same base with no changes doesn\'t.',
      hints: ['#3 is a famous gotcha', 'Calibrated = your 80% predictions are right 80% of the time'],
      antiPatterns: ['bullshitter', 'hedger'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'calibration-accuracy', weight: 0.4 }, { factor: 'justification-quality', weight: 0.3 }, { factor: 'honesty-about-uncertainty', weight: 0.3 }],
    },
    {
      id: `cu-failure-${seed}`,
      title: 'What Could Go Wrong?',
      foundation: 'calibrated-uncertainty',
      category: 'system-design',
      difficulty: 4,
      prompt: 'You\'re deploying a new payment processing microservice to production on Friday afternoon. List every failure mode you can think of, assign each a probability (low/medium/high) and severity (low/medium/critical). Rank the top 3 risks.',
      expectedAnswer: 'Failure modes: 1) Incorrect amount charged (low prob, critical sev). 2) Service timeout under load (medium, high). 3) Database migration fails (medium, critical). 4) Stale cache serves old prices (medium, high). 5) Third-party payment gateway outage (low, critical). 6) Friday deploys get fewer eyes on monitoring (high, medium). Top 3: DB migration fail, incorrect charges, gateway outage. RECOMMENDATION: Don\'t deploy payments on Friday.',
      hints: ['Friday deploys are themselves a risk factor', 'Think about money-related failures separately'],
      antiPatterns: ['sycophant', 'hedger'],
      timeLimit: 240,
      scoringCriteria: [{ factor: 'risk-coverage', weight: 0.3 }, { factor: 'probability-calibration', weight: 0.3 }, { factor: 'prioritization', weight: 0.2 }, { factor: 'actionability', weight: 0.2 }],
    },
    {
      id: `cu-scope-${seed}`,
      title: 'Scope of Knowledge',
      foundation: 'calibrated-uncertainty',
      category: 'logic',
      difficulty: 3,
      prompt: 'A developer asks: "Should we use Kafka or RabbitMQ for our event system?" Instead of answering directly, explicitly categorize every aspect into: (A) things you know for certain, (B) things you believe but could be wrong about, (C) things you\'d need to research. Then give your recommendation.',
      expectedAnswer: 'KNOW: Kafka = log-based, ordered, replay-capable. RabbitMQ = traditional queue, flexible routing. Both production-grade. BELIEVE: Kafka better for high-throughput event streaming; RabbitMQ better for task queues and complex routing. RESEARCH: Their specific throughput needs, team familiarity, existing infra, budget. RECOMMENDATION: If they need replay/ordering → Kafka. If they need flexible routing/simplicity → RabbitMQ. But ASK about their specific use case first.',
      hints: ['The point is separating what you KNOW from what you THINK', 'The best answer starts with questions'],
      antiPatterns: ['bullshitter', 'template-matcher'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'honest-categorization', weight: 0.4 }, { factor: 'knowledge-accuracy', weight: 0.3 }, { factor: 'humility', weight: 0.3 }],
    },

    /* ─── meta-learning (Extract generalizable patterns) ──── */
    {
      id: `ml-pattern-${seed}`,
      title: 'Pattern Extraction',
      foundation: 'meta-learning',
      category: 'debugging',
      difficulty: 3,
      prompt: 'Three bugs were found this week: 1) A useEffect runs twice in React 18 strict mode. 2) A database migration ran twice because the deploy script retried on timeout. 3) An email was sent twice because the webhook handler wasn\'t idempotent. What is the COMMON underlying pattern? What generalizable principle would prevent all three?',
      expectedAnswer: 'Common pattern: Non-idempotent operations in environments that retry/replay. Principle: "Design every side effect to be idempotent — assume it WILL be called more than once." Implementation: useEffect cleanup function, migration lock/version check, webhook deduplication key. The meta-lesson: any system boundary is a retry boundary.',
      hints: ['All three problems share the same root cause at an abstract level', 'What word describes "safe to run multiple times"?'],
      antiPatterns: ['literal-interpreter', 'template-matcher'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'pattern-abstraction', weight: 0.4 }, { factor: 'generalizability', weight: 0.3 }, { factor: 'concrete-applications', weight: 0.3 }],
    },
    {
      id: `ml-transfer-${seed}`,
      title: 'Transfer Learning',
      foundation: 'meta-learning',
      category: 'code',
      difficulty: 4,
      prompt: 'The "circuit breaker" pattern in microservices prevents cascading failures by stopping calls to a failing service. Apply this EXACT same pattern to a completely different domain: a UI component that fetches data from an unreliable API. Design the component with open/half-open/closed states.',
      expectedAnswer: 'DataFetcher component states: CLOSED (normal, fetches on mount/refresh), OPEN (after N consecutive failures, shows cached data + "service unavailable" banner, auto-retries after cooldown), HALF-OPEN (single probe request — success → CLOSED, fail → OPEN). Track failureCount, lastFailureTime. In OPEN state, serve stale data rather than loading spinners. The transfer: same state machine, different medium.',
      hints: ['The state machine is identical — only the "what happens in each state" changes', 'What would "half-open" look like in a React component?'],
      antiPatterns: ['hedger', 'over-generator'],
      timeLimit: 300,
      scoringCriteria: [{ factor: 'pattern-transfer-accuracy', weight: 0.35 }, { factor: 'implementation-quality', weight: 0.3 }, { factor: 'analogy-clarity', weight: 0.2 }, { factor: 'code-quality', weight: 0.15 }],
    },
    {
      id: `ml-retro-${seed}`,
      title: 'Retrospective Analysis',
      foundation: 'meta-learning',
      category: 'logic',
      difficulty: 3,
      prompt: 'A production incident: the team deployed a database schema change that locked a table for 45 minutes, causing an outage. The post-mortem says "we should have tested in staging." Extract THREE deeper lessons beyond the obvious. What systemic changes would prevent this CLASS of problem?',
      expectedAnswer: '1) "Test in staging" is necessary but insufficient — staging rarely has production-scale data, so the lock duration would be different. Lesson: test with production-scale data volumes. 2) Schema changes should be non-blocking by default (use online DDL tools like pt-online-schema-change or gh-ost). Lesson: make dangerous operations safe BY DEFAULT, not by discipline. 3) Deploys should have automatic rollback triggers (if error rate > threshold within 5min, auto-revert). Lesson: detect failure faster than humans can react.',
      hints: ['The surface lesson is always obvious — dig to the structural/systemic causes', '"We should have tested" is about discipline; better answers are about systems'],
      antiPatterns: ['sycophant', 'literal-interpreter'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'depth-beyond-obvious', weight: 0.4 }, { factor: 'systemic-thinking', weight: 0.3 }, { factor: 'actionability', weight: 0.3 }],
    },

    /* ─── reading-between-lines (Understand what's NOT said) ── */
    {
      id: `rbl-real-${seed}`,
      title: 'The Real Question',
      foundation: 'reading-between-lines',
      category: 'logic',
      difficulty: 3,
      prompt: 'A developer messages you at 11pm: "Hey, quick question — how do I revert a git commit that\'s already been pushed?" What are they ACTUALLY dealing with? What should your response address beyond the literal question?',
      expectedAnswer: 'Reading between the lines: They likely pushed something bad to production (or a shared branch) and are panicking. The real needs: 1) Reassurance (it\'s fixable). 2) The RIGHT revert method (git revert, not reset, for pushed commits). 3) Whether they need to notify the team. 4) Whether CI/CD deployed the bad commit. Your response should: answer the literal question, ask if it\'s in production, and offer to help with the broader situation.',
      hints: ['Why are they asking at 11pm?', 'The emotional state behind the question matters'],
      antiPatterns: ['literal-interpreter', 'template-matcher'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'subtext-reading', weight: 0.4 }, { factor: 'empathy', weight: 0.2 }, { factor: 'practical-help', weight: 0.2 }, { factor: 'completeness', weight: 0.2 }],
    },
    {
      id: `rbl-missing-${seed}`,
      title: 'Missing Requirements',
      foundation: 'reading-between-lines',
      category: 'system-design',
      difficulty: 4,
      prompt: 'Product spec: "Build a user registration form with email, password, and name fields. Save to database. Send welcome email." List everything this spec does NOT mention but MUST be decided before implementation.',
      expectedAnswer: 'Missing: 1) Password requirements (min length? special chars?). 2) Email verification flow. 3) Duplicate email handling. 4) Rate limiting (prevent spam registrations). 5) What happens if email send fails? 6) GDPR/data privacy compliance. 7) Input validation & sanitization. 8) Password hashing algorithm. 9) Session/token creation after registration. 10) Error UX for each failure mode. 11) Accessibility requirements. 12) Mobile responsiveness. A 3-line spec hides 30+ decisions.',
      hints: ['Think about every edge case and failure mode', 'Security, privacy, and error handling are almost never in v1 specs'],
      antiPatterns: ['literal-interpreter', 'sycophant'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'gap-coverage', weight: 0.4 }, { factor: 'security-awareness', weight: 0.25 }, { factor: 'ux-awareness', weight: 0.2 }, { factor: 'prioritization', weight: 0.15 }],
    },
    {
      id: `rbl-implied-${seed}`,
      title: 'Implied Constraints',
      foundation: 'reading-between-lines',
      category: 'system-design',
      difficulty: 3,
      prompt: 'CTO says: "We need to be able to handle Black Friday traffic — 10x our normal load." What implied constraints and requirements are NOT stated but absolutely required? Think about what "handle" means beyond just not crashing.',
      expectedAnswer: 'Implied requirements: 1) "Handle" = acceptable latency, not just no crashes (p99 < 200ms?). 2) Graceful degradation if 10x becomes 15x. 3) Auto-scaling must be tested BEFORE Black Friday. 4) Database can handle 10x writes, not just reads. 5) Third-party services (payment, shipping) must also handle 10x. 6) Monitoring/alerting must work at scale. 7) Team needs an on-call rotation. 8) Cost budget for 10x infrastructure. 9) Rollback plan if something fails during peak.',
      hints: ['"Handle" is doing a lot of heavy lifting in that sentence', 'What about the things YOU don\'t control at 10x?'],
      antiPatterns: ['hedger', 'literal-interpreter'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'implicit-requirement-coverage', weight: 0.4 }, { factor: 'practical-concerns', weight: 0.3 }, { factor: 'depth', weight: 0.3 }],
    },

    /* ─── precision-communication (Say exactly what you mean) ─ */
    {
      id: `pc-compress-${seed}`,
      title: 'Compress the Explanation',
      foundation: 'precision-communication',
      category: 'logic',
      difficulty: 3,
      prompt: 'Explain these concepts each in EXACTLY one sentence (no more, no less). Every word must earn its place:\n1. What is a closure?\n2. What is eventual consistency?\n3. What is dependency injection?',
      expectedAnswer: '1. A closure is a function that captures variables from its enclosing scope, keeping them alive after that scope exits. 2. Eventual consistency guarantees all replicas converge to the same value given enough time without new writes. 3. Dependency injection passes required services into a component from outside rather than having the component create them.',
      hints: ['One sentence. Not two. Not a paragraph. One.', 'Remove every word that doesn\'t change the meaning'],
      antiPatterns: ['over-generator', 'hedger'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'accuracy', weight: 0.3 }, { factor: 'compression', weight: 0.3 }, { factor: 'completeness-in-brevity', weight: 0.2 }, { factor: 'exactly-one-sentence', weight: 0.2 }],
    },
    {
      id: `pc-ambiguity-${seed}`,
      title: 'Ambiguity Hunt',
      foundation: 'precision-communication',
      category: 'logic',
      difficulty: 3,
      prompt: 'Find ALL ambiguities in this requirement: "The system should allow users to share documents with other users and notify them." For each ambiguity, write the TWO most different valid interpretations.',
      expectedAnswer: '1. "share" — (a) Give read access, or (b) give full edit access? 2. "documents" — (a) any file type, or (b) only specific formats? 3. "other users" — (a) any user on the platform, or (b) only within the same org? 4. "notify" — (a) in-app notification, or (b) email/SMS? 5. "them" — (a) notify the recipients, or (b) notify the sharer that sharing succeeded? 6. "allow" — (a) always enabled, or (b) admin-configurable permission?',
      hints: ['Every pronoun is ambiguous', '"Share" could mean many different things technically'],
      antiPatterns: ['literal-interpreter', 'sycophant'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'ambiguities-found', weight: 0.4 }, { factor: 'interpretation-contrast', weight: 0.3 }, { factor: 'precision', weight: 0.3 }],
    },
    {
      id: `pc-error-${seed}`,
      title: 'Error Message Craft',
      foundation: 'precision-communication',
      category: 'code',
      difficulty: 3,
      prompt: 'Write the ideal user-facing error message for each scenario. Each must be: accurate, actionable, non-technical, and under 20 words.\n1. API rate limit exceeded\n2. File upload is too large (max 10MB)\n3. Session expired during form submission\n4. Payment declined by bank',
      expectedAnswer: '1. "You\'re making requests too quickly. Please wait a moment and try again." 2. "This file is over 10 MB. Try compressing it or choosing a smaller file." 3. "Your session timed out. We saved your draft — please sign in and resubmit." 4. "Your payment was declined by your bank. Please try a different payment method or contact your bank."',
      hints: ['No status codes, no jargon, no blame', 'Every error message should tell the user WHAT TO DO NEXT'],
      antiPatterns: ['over-generator', 'hedger'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'actionability', weight: 0.3 }, { factor: 'non-technical-language', weight: 0.25 }, { factor: 'accuracy', weight: 0.25 }, { factor: 'word-count-constraint', weight: 0.2 }],
    },

    /* ─── right-question (Quality bounded by question quality) ─ */
    {
      id: `rq-reframe-${seed}`,
      title: 'Reframe the Problem',
      foundation: 'right-question',
      category: 'logic',
      difficulty: 3,
      prompt: 'A team asks: "How do we make our test suite run faster?" Reframe this into 3 BETTER questions that would lead to more useful answers. Explain why each reframing is superior.',
      expectedAnswer: '1. "Which tests give us the most confidence per second of runtime?" — Because some tests are high-value, some are redundant. Prioritize, don\'t just speed up. 2. "What would have to be true for us to deploy confidently with half our test suite?" — Challenges the assumption that all tests are needed. 3. "Are we testing the right things at the right level (unit vs integration vs e2e)?" — A slow test suite often means too many e2e tests doing unit-test work. Each reframing attacks root cause, not symptom.',
      hints: ['The original question assumes the test suite is correct and just slow', 'Better questions challenge more assumptions'],
      antiPatterns: ['literal-interpreter', 'sycophant'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'reframing-quality', weight: 0.4 }, { factor: 'assumption-challenging', weight: 0.3 }, { factor: 'practical-impact', weight: 0.3 }],
    },
    {
      id: `rq-interview-${seed}`,
      title: 'Interview the User',
      foundation: 'right-question',
      category: 'system-design',
      difficulty: 3,
      prompt: 'A client says: "Build me a dashboard." Before writing a single line of code, write the 8 most important questions you would ask, in priority order. Each question must unlock information that changes what you build.',
      expectedAnswer: '1. Who uses it and how often? (Persona drives everything.) 2. What decisions will they make based on this data? (Purpose > features.) 3. What data sources exist today? (Feasibility gate.) 4. What\'s the one number they check first every morning? (Priority hierarchy.) 5. How stale can the data be? (Real-time vs batch — 10x cost difference.) 6. What device/context? (Desk? Phone? TV on wall?) 7. What existing tools are they replacing? (Migration pain.) 8. What does "done" look like — when would you say "this is exactly what I wanted"? (Success criteria.)',
      hints: ['The order matters — each question should build on previous answers', 'The best questions change WHAT you build, not HOW'],
      antiPatterns: ['template-matcher', 'over-generator'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'question-quality', weight: 0.35 }, { factor: 'priority-ordering', weight: 0.25 }, { factor: 'decision-impact', weight: 0.2 }, { factor: 'coverage', weight: 0.2 }],
    },
    {
      id: `rq-debug-${seed}`,
      title: 'Debug by Questioning',
      foundation: 'right-question',
      category: 'debugging',
      difficulty: 3,
      prompt: 'Bug report: "The app is slow." You can ask exactly 5 yes/no questions to narrow it down. What do you ask? Each question must maximally divide the problem space.',
      expectedAnswer: '1. "Is it slow on first load only, or on every interaction?" (Narrows to initial load vs runtime.) 2. "Does it happen on all pages or just specific ones?" (Global vs local issue.) 3. "Is the network tab showing long request times?" (Frontend vs backend.) 4. "Did this start after a recent deploy?" (Regression vs long-standing.) 5. "Does it happen in incognito/different browser?" (Extension/cache vs real issue.) Each question halves the search space — binary search for bugs.',
      hints: ['Each question should eliminate ~50% of possibilities', 'Think of it as binary search on the bug space'],
      antiPatterns: ['bullshitter', 'hedger'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'information-gain-per-question', weight: 0.4 }, { factor: 'coverage-of-bug-space', weight: 0.3 }, { factor: 'practicality', weight: 0.3 }],
    },

    /* ─── compression (Shortest accurate answer wins) ───────── */
    {
      id: `co-tldr-${seed}`,
      title: 'TL;DR Challenge',
      foundation: 'compression',
      category: 'logic',
      difficulty: 3,
      prompt: 'Summarize each concept in ONE sentence of maximum 12 words:\n1. The CAP theorem\n2. SOLID principles\n3. Event sourcing\n4. The Actor model\n5. Zero-trust security',
      expectedAnswer: '1. Distributed systems: pick two of consistency, availability, partition tolerance. 2. Five design principles making software flexible and maintainable. 3. Store every state change as an immutable event log. 4. Concurrent computation via isolated actors communicating through messages. 5. Never trust, always verify — authenticate every request regardless of source.',
      hints: ['12 words. Count them.', 'Cut adjectives first, then adverbs, then rephrase'],
      antiPatterns: ['over-generator', 'hedger'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'accuracy', weight: 0.3 }, { factor: 'word-count-constraint', weight: 0.3 }, { factor: 'completeness-despite-brevity', weight: 0.2 }, { factor: 'clarity', weight: 0.2 }],
    },
    {
      id: `co-codegolf-${seed}`,
      title: 'Code Golf Explanation',
      foundation: 'compression',
      category: 'code',
      difficulty: 3,
      prompt: 'Explain what this code does in the FEWEST words possible while remaining accurate:\n\nconst r = (a, f) => a.length <= 1 ? a : [...r(a.filter((_, i) => i % 2 === 0), f), ...r(a.filter((_, i) => i % 2 !== 0), f)].sort(f);',
      expectedAnswer: 'Merge sort: recursively splits array by even/odd indices, sorts subarrays, merges. (12 words)',
      hints: ['Don\'t explain each line — describe the overall algorithm', 'What well-known algorithm does this implement?'],
      antiPatterns: ['over-generator', 'template-matcher'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'accuracy', weight: 0.4 }, { factor: 'brevity', weight: 0.3 }, { factor: 'algorithm-identification', weight: 0.3 }],
    },
    {
      id: `co-arch-${seed}`,
      title: 'Architecture One-Liner',
      foundation: 'compression',
      category: 'system-design',
      difficulty: 4,
      prompt: 'Describe each system architecture in ONE sentence that a senior engineer would find complete:\n1. Netflix\n2. Git\n3. Kubernetes',
      expectedAnswer: '1. CDN-first microservices with client-side discovery, chaos-tested, streaming assets from edge caches backed by S3. 2. Content-addressable object store forming a DAG of commits, with refs as mutable pointers into the graph. 3. Declarative container orchestrator: desired state in etcd, controllers reconcile actual state, kubelet executes on nodes.',
      hints: ['Senior engineers want architecture, not features', 'One sentence must capture THE core insight'],
      antiPatterns: ['over-generator', 'bullshitter'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'technical-accuracy', weight: 0.3 }, { factor: 'compression-ratio', weight: 0.3 }, { factor: 'architectural-insight', weight: 0.2 }, { factor: 'audience-appropriate', weight: 0.2 }],
    },

    /* ─── systems-thinking (Map the blast radius) ─────────── */
    {
      id: `st-blast-${seed}`,
      title: 'Blast Radius Analysis',
      foundation: 'systems-thinking',
      category: 'system-design',
      difficulty: 4,
      prompt: 'You change the User model to add a required "timezone" field. Map EVERYTHING in a typical web app that this change affects. Think in layers: database, backend, frontend, API, integrations, data, team process.',
      expectedAnswer: 'DB: migration (backfill existing rows — what default?), indexes, query performance. Backend: every endpoint that creates users (registration, admin, OAuth, API), validation, serialization. Frontend: registration form, profile edit, every date/time display (now timezone-aware), existing tests. API: breaking change for consumers (versioning needed?). Integrations: email scheduling, cron jobs, analytics timestamps. Data: existing records need backfill — what timezone for users who signed up before? Team: documentation, API changelog, mobile app release coordination. One "simple" field → 20+ touch points.',
      hints: ['Follow the data flow: who creates it, who reads it, who displays it', 'Think about EXISTING data, not just new data'],
      antiPatterns: ['literal-interpreter', 'hedger'],
      timeLimit: 300,
      scoringCriteria: [{ factor: 'blast-radius-coverage', weight: 0.35 }, { factor: 'layer-thinking', weight: 0.25 }, { factor: 'non-obvious-impacts', weight: 0.2 }, { factor: 'practical-mitigation', weight: 0.2 }],
    },
    {
      id: `st-cascade-${seed}`,
      title: 'Cascading Failure',
      foundation: 'systems-thinking',
      category: 'debugging',
      difficulty: 4,
      prompt: 'DNS resolution for your database host starts taking 30 seconds instead of 30ms. Trace the FULL cascade: what fails first, second, third? At what point do users notice? What eventually crashes and why?',
      expectedAnswer: 'Stage 1 (0-30s): Connection pool exhaustion — new connections wait for DNS. Existing connections work. Stage 2 (30s-2min): Request queue fills — HTTP server threads blocked waiting for DB. API latency spikes from 100ms to 30s+. Stage 3 (2-5min): Load balancer health checks fail → marks instances unhealthy → traffic shifts to remaining instances → those overload too. Stage 4 (5min+): All instances marked unhealthy → 502/503 for all users. Background job workers also die (same DNS). Users notice at Stage 2 (slow pages). Total crash at Stage 3. Root cause is 30s DNS, but the CASCADE is caused by no connection timeouts, no circuit breakers, and synchronous DNS resolution.',
      hints: ['Follow the resource chain: DNS → connection → thread → queue → LB', 'What has timeouts and what doesn\'t?'],
      antiPatterns: ['template-matcher', 'hedger'],
      timeLimit: 240,
      scoringCriteria: [{ factor: 'cascade-accuracy', weight: 0.3 }, { factor: 'timing-awareness', weight: 0.25 }, { factor: 'root-cause-vs-symptoms', weight: 0.25 }, { factor: 'prevention-measures', weight: 0.2 }],
    },
    {
      id: `st-deps-${seed}`,
      title: 'Dependency Mapping',
      foundation: 'systems-thinking',
      category: 'system-design',
      difficulty: 3,
      prompt: 'Map ALL the hidden dependencies for this simple feature: "Add a \'Like\' button to blog posts." Include runtime dependencies, build dependencies, team dependencies, and data dependencies. What would make you say "this is actually harder than it looks"?',
      expectedAnswer: 'Runtime: authentication (must be logged in), post service, like count storage, real-time update (WebSocket?), rate limiting (spam prevention). Build: UI component, API endpoint, database migration, test coverage. Team: design (icon, animation, position), product (unlike? like count public?), mobile team (API contract). Data: denormalized count on post vs computed? Uniqueness constraint. Hidden complexity: 1) Can you unlike? 2) Do likes need to be real-time across sessions? 3) Like count at scale = hot row problem. 4) Analytics tracking. 5) Notification to post author? "Simple" button → 15-20 decisions.',
      hints: ['A like button touches auth, storage, real-time, analytics, and notifications', 'Think about who else needs to be involved besides you'],
      antiPatterns: ['literal-interpreter', 'sycophant'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'dependency-coverage', weight: 0.3 }, { factor: 'hidden-complexity-awareness', weight: 0.3 }, { factor: 'cross-team-thinking', weight: 0.2 }, { factor: 'data-design-awareness', weight: 0.2 }],
    },

    /* ─── taste-judgment (Right vs works) ─────────────────── */
    {
      id: `tj-review-${seed}`,
      title: 'Code Review Taste',
      foundation: 'taste-judgment',
      category: 'code',
      difficulty: 3,
      prompt: 'Both implementations work. Which is BETTER and why?\n\nOption A:\nconst getUser = (id) => db.query("SELECT * FROM users WHERE id = ?", [id]);\n\nOption B:\nconst getUser = (id) => db.query("SELECT id, name, email, created_at FROM users WHERE id = ?", [id]);',
      expectedAnswer: 'Option B is better. Reasons: 1) Explicit column selection — won\'t break if someone adds a password_hash column to users table. 2) Performance — doesn\'t transfer unnecessary data (imagine a blob column added later). 3) Self-documenting — tells the reader exactly what data this function provides. 4) API contract — callers know what fields to expect. Option A feels simpler but hides a coupling to the schema that will bite you. The taste insight: "SELECT *" optimizes for writing speed; explicit columns optimize for maintenance speed.',
      hints: ['What happens when someone adds a column to the table?', 'Think about the long-term maintenance cost'],
      antiPatterns: ['hedger', 'sycophant'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'correct-choice', weight: 0.25 }, { factor: 'reasoning-depth', weight: 0.3 }, { factor: 'long-term-thinking', weight: 0.25 }, { factor: 'taste-articulation', weight: 0.2 }],
    },
    {
      id: `tj-api-${seed}`,
      title: 'API Design Taste',
      foundation: 'taste-judgment',
      category: 'code',
      difficulty: 4,
      prompt: 'Design the function signature for a "sendEmail" function. Consider: What parameters? Required vs optional? How to handle errors? How to handle templates? What would make this a JOY to use vs a chore? Show the ideal TypeScript signature with JSDoc.',
      expectedAnswer: 'sendEmail({ to, subject, body, template?, data?, cc?, bcc?, replyTo?, attachments? }): Promise<{ messageId: string; accepted: string[] }>. Key taste decisions: 1) Single options object (not positional args — scales without breaking). 2) Either body OR template+data (union type for clarity). 3) Returns messageId for tracking (not void). 4) Throws typed errors (EmailValidationError, DeliveryError) not generic Error. 5) "to" accepts string | string[] (convenience). The joy: common case is 2 fields (to, subject+body), power case is all fields. No overloads needed.',
      hints: ['What does the 90% use case look like? The 10%?', 'Return value matters — callers need to track sent emails'],
      antiPatterns: ['over-generator', 'template-matcher'],
      timeLimit: 240,
      scoringCriteria: [{ factor: 'ergonomics', weight: 0.3 }, { factor: 'type-safety', weight: 0.25 }, { factor: 'error-handling', weight: 0.2 }, { factor: 'taste-articulation', weight: 0.25 }],
    },
    {
      id: `tj-ship-${seed}`,
      title: 'When to Ship',
      foundation: 'taste-judgment',
      category: 'system-design',
      difficulty: 4,
      prompt: 'You\'re building a search feature. It works for exact matches. Fuzzy matching, filters, and pagination are stubbed. You have 2 days until the demo. Do you: (A) Ship exact-match only with clean UX, (B) Rush all features with bugs, or (C) Something else? Justify with specific reasoning.',
      expectedAnswer: '(A) Ship exact-match with clean UX, plus: show "exact match" in the UI so users know fuzzy is coming. Add a "No results? Try different keywords" helper. Include analytics to measure what users actually search for (informs fuzzy priority). The taste: a polished feature that works perfectly > four features that work poorly. Users forgive missing features; they don\'t forgive broken ones. The demo should show judgment, not just code volume. (C) variant: if fuzzy is 80% done, finish it — but only if it ACTUALLY works. Half-working fuzzy is worse than no fuzzy.',
      hints: ['What makes a better impression: one thing working perfectly or four things working badly?', 'The demo is about confidence, not features'],
      antiPatterns: ['sycophant', 'hedger'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'judgment-quality', weight: 0.35 }, { factor: 'reasoning-specificity', weight: 0.25 }, { factor: 'user-empathy', weight: 0.2 }, { factor: 'decisiveness', weight: 0.2 }],
    },

    /* ─── intellectual-honesty (Seek evidence you're wrong) ── */
    {
      id: `ih-steelman-${seed}`,
      title: 'Steel-Man the Opposite',
      foundation: 'intellectual-honesty',
      category: 'logic',
      difficulty: 3,
      prompt: 'You strongly prefer TypeScript over JavaScript. Now argue AGAINST TypeScript — make the strongest possible case for why a team should use plain JavaScript. You must be genuinely persuasive, not straw-manning.',
      expectedAnswer: 'The case against TypeScript: 1) Type overhead is real — generic gymnastics, declaration files for untyped libraries, and "any" escape hatches that give false safety. A team fighting the type system isn\'t shipping. 2) Prototyping speed — JS lets you move fast when the domain is unclear. Types lock in structure too early. 3) Runtime doesn\'t care — TS compiles away. Runtime bugs (async, null checks) need tests regardless. Types don\'t replace tests. 4) Onboarding cost — not every developer knows TS, and the learning curve for advanced types (conditional types, mapped types) is steep. 5) Build complexity — extra compilation step, source maps, declaration files, potentially slower CI. For small teams moving fast on uncertain product, JS + good tests > TS.',
      hints: ['The strongest arguments acknowledge TypeScript\'s real costs, not imaginary ones', 'If you can\'t argue the other side convincingly, you don\'t understand the tradeoff'],
      antiPatterns: ['sycophant', 'bullshitter'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'argument-strength', weight: 0.35 }, { factor: 'genuine-engagement', weight: 0.25 }, { factor: 'nuance', weight: 0.2 }, { factor: 'no-straw-manning', weight: 0.2 }],
    },
    {
      id: `ih-update-${seed}`,
      title: 'Update Your Beliefs',
      foundation: 'intellectual-honesty',
      category: 'logic',
      difficulty: 4,
      prompt: 'Initial recommendation: "Use a SQL database for this project." New evidence arrives: 1) The data is highly hierarchical (6+ levels of nesting), 2) Schema changes weekly as product evolves, 3) Read patterns are "give me everything about entity X and all its children." Does this change your recommendation? Explain your reasoning transparently, including what you got wrong.',
      expectedAnswer: 'Yes, this changes my recommendation. Updated: Document database (MongoDB/DynamoDB) is better here. What changed: 1) Deep nesting → SQL requires complex JOINs or recursive CTEs; documents store the tree naturally. 2) Weekly schema changes → rigid SQL schema requires migrations; document DBs handle polymorphic data. 3) "Entity + all children" → single document read vs N+1 query problem in SQL. What I got wrong: I defaulted to SQL because it\'s the safe general choice. But these three signals together clearly point to a document model. The lesson: "SQL by default" is a heuristic that fails when the access pattern is hierarchical and the schema is unstable.',
      hints: ['Be explicit about what changed and what was wrong in your original thinking', 'The point is transparent belief-updating, not defending the original choice'],
      antiPatterns: ['bullshitter', 'hedger'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'honest-updating', weight: 0.35 }, { factor: 'evidence-reasoning', weight: 0.25 }, { factor: 'self-awareness', weight: 0.2 }, { factor: 'new-recommendation-quality', weight: 0.2 }],
    },
    {
      id: `ih-unknowns-${seed}`,
      title: 'Known Unknowns',
      foundation: 'intellectual-honesty',
      category: 'system-design',
      difficulty: 3,
      prompt: 'You\'re asked to estimate how long it will take to migrate a monolith to microservices. Before giving any estimate, explicitly list: (A) What you KNOW, (B) What you DON\'T KNOW but could find out, (C) What NOBODY can know yet. Then give a range estimate with these uncertainties stated.',
      expectedAnswer: 'KNOW: (A) Current monolith size/tech stack, team size, target architecture, past velocity. DON\'T KNOW but CAN find out: (B) How tangled the domain boundaries are, what shared state exists, how good the test coverage is, which services have the most coupling. NOBODY CAN KNOW: (C) How many hidden dependencies will surface during extraction, how team morale/turnover affects timeline, what product pivots will happen mid-migration, performance surprises in the distributed system. Estimate: 6-18 months (3x range). The wide range IS the honest answer. Anyone giving a precise estimate is either scoping a tiny slice or lying.',
      hints: ['The honesty is in the (C) category — things genuinely unknowable', 'A wide range with stated assumptions beats a precise number with hidden assumptions'],
      antiPatterns: ['bullshitter', 'sycophant'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'honest-categorization', weight: 0.3 }, { factor: 'unknown-awareness', weight: 0.3 }, { factor: 'estimate-reasonableness', weight: 0.2 }, { factor: 'uncertainty-communication', weight: 0.2 }],
    },

    /* ══════════════════════════════════════════════════════════ */
    /* WAVE 2: 20 additional drills (2 per foundation = 5 total) */
    /* ══════════════════════════════════════════════════════════ */

    /* ─── first-principles #4 ──────────────────────────────── */
    {
      id: `fp-invert-${seed}`,
      title: 'Inversion Thinking',
      foundation: 'first-principles',
      category: 'logic',
      difficulty: 4,
      prompt: 'Instead of asking "How do I build a reliable distributed system?", invert the question: "How would I GUARANTEE a distributed system fails?" List every way to ensure failure, then invert each into a reliability principle.',
      expectedAnswer: 'To guarantee failure: 1) Single point of failure → Principle: redundancy at every layer. 2) No timeouts → Principle: every network call has a timeout + circuit breaker. 3) Synchronous coupling → Principle: async messaging for cross-service communication. 4) No monitoring → Principle: observability (metrics, logs, traces) from day one. 5) Deploy everything at once → Principle: canary/blue-green deploys. 6) No backpressure → Principle: rate limiting + queue-based load leveling. 7) Trust all inputs → Principle: validate at every boundary. Inversion forces exhaustive thinking because imagining failure is easier than imagining success.',
      hints: ['Inverting a question reveals blind spots — failures are easier to enumerate than successes', 'Each failure mode directly maps to a reliability principle'],
      antiPatterns: ['template-matcher', 'hedger'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'inversion-completeness', weight: 0.35 }, { factor: 'principle-quality', weight: 0.3 }, { factor: 'reasoning-method', weight: 0.2 }, { factor: 'clarity', weight: 0.15 }],
    },
    /* ─── first-principles #5 ──────────────────────────────── */
    {
      id: `fp-why5-${seed}`,
      title: 'Five Whys',
      foundation: 'first-principles',
      category: 'debugging',
      difficulty: 3,
      prompt: 'Bug report: "Users complain the dashboard loads slowly." Apply the Five Whys technique — ask "why?" five times to get from symptom to root cause. At each level, state what you\'d measure to verify.',
      expectedAnswer: 'Why 1: Dashboard loads slowly → API response takes 3s (measure: network waterfall). Why 2: Why does API take 3s? → Database query runs a full table scan (measure: EXPLAIN plan). Why 3: Why full table scan? → No index on the filtered column (measure: index list). Why 4: Why no index? → Column was added last sprint without index review (measure: PR reviews). Why 5: Why no index review? → No checklist for schema changes in PR process (root cause: process gap). Fix: add "index review" to schema change checklist. Surface fix alone (add index) would miss the systemic issue.',
      hints: ['Each "why" should go deeper — symptom → technical cause → process cause → systemic cause', 'The root cause is almost never technical — it\'s usually a process or cultural gap'],
      antiPatterns: ['literal-interpreter', 'template-matcher'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'depth-of-whys', weight: 0.35 }, { factor: 'measurability', weight: 0.25 }, { factor: 'root-cause-quality', weight: 0.25 }, { factor: 'systemic-fix', weight: 0.15 }],
    },

    /* ─── calibrated-uncertainty #4 ────────────────────────── */
    {
      id: `cu-range-${seed}`,
      title: 'Estimation Range',
      foundation: 'calibrated-uncertainty',
      category: 'math',
      difficulty: 4,
      prompt: 'Estimate how long these tasks take. Give a 90% confidence interval (you\'re 90% sure the real time falls within your range). Be honest — wider is fine if warranted.\n1. Add a "dark mode" toggle to an existing React app\n2. Migrate a MySQL database to PostgreSQL\n3. Implement OAuth2 login with Google\n4. Write comprehensive tests for a 500-line utility module',
      expectedAnswer: '1. Dark mode: 2-8 hours (narrow — well-defined scope, depends on existing CSS architecture). 2. MySQL to Postgres: 2-6 weeks (wide — depends on stored procedures, data types, ORM usage, testing). 3. OAuth2 Google: 4-16 hours (moderate — library does heavy lifting, but redirect flows and error handling have gotchas). 4. Tests for 500-line module: 4-12 hours (moderate — depends on function complexity and how testable the code is). Key calibration insight: if your ranges are consistently too narrow, you\'re overconfident. A 90% CI should contain the answer 90% of the time — most engineers give ranges that hit only 50%.',
      hints: ['90% CI means you should be WRONG 10% of the time — if you\'re never wrong, your ranges are too wide', 'Migrations always take longer than expected'],
      antiPatterns: ['bullshitter', 'sycophant'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'range-reasonableness', weight: 0.35 }, { factor: 'calibration-insight', weight: 0.25 }, { factor: 'justification', weight: 0.2 }, { factor: 'honesty', weight: 0.2 }],
    },
    /* ─── calibrated-uncertainty #5 ────────────────────────── */
    {
      id: `cu-bayes-${seed}`,
      title: 'Bayesian Update',
      foundation: 'calibrated-uncertainty',
      category: 'logic',
      difficulty: 4,
      prompt: 'You suspect a production bug is caused by a recent deploy (70% prior). You check the error logs and see the errors started 2 hours BEFORE the deploy. Update your belief. What\'s your new probability that the deploy caused the bug? Show your reasoning.',
      expectedAnswer: 'Prior: P(deploy caused it) = 70%. New evidence: errors started before deploy. P(errors before deploy | deploy caused it) ≈ 5% (very unlikely if deploy is the cause). P(errors before deploy | deploy didn\'t cause it) ≈ 80% (expected if something else caused it). Bayesian update: P(deploy | evidence) = (0.7 × 0.05) / (0.7 × 0.05 + 0.3 × 0.8) = 0.035 / 0.275 ≈ 12.7%. New belief: ~13% the deploy caused it. The evidence strongly shifts away from the deploy theory. Investigation should focus on what changed 2 hours earlier.',
      hints: ['Use Bayes\' theorem: P(A|B) = P(B|A)·P(A) / P(B)', 'The timing evidence is very strong against the deploy hypothesis'],
      antiPatterns: ['bullshitter', 'hedger'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'bayesian-reasoning', weight: 0.35 }, { factor: 'probability-accuracy', weight: 0.3 }, { factor: 'evidence-interpretation', weight: 0.2 }, { factor: 'actionable-conclusion', weight: 0.15 }],
    },

    /* ─── meta-learning #4 ─────────────────────────────────── */
    {
      id: `ml-analogy-${seed}`,
      title: 'Cross-Domain Analogy',
      foundation: 'meta-learning',
      category: 'system-design',
      difficulty: 3,
      prompt: 'What can software architecture learn from how cities handle traffic? Map at least 5 city traffic concepts directly to software system concepts. For each mapping, explain WHY the analogy works (the structural similarity).',
      expectedAnswer: '1. Traffic lights → Rate limiters. Both regulate flow at intersection points to prevent collision/overload. 2. Highway on-ramps → Load balancers. Both merge multiple sources into a shared resource with metering. 3. Ambulance priority lanes → Priority queues. Critical traffic gets dedicated fast-paths. 4. Detour signs → Circuit breakers. Redirect traffic when a route is blocked. 5. Public transit → Shared services/message buses. Many passengers (requests) share one vehicle (connection), more efficient than individual cars (connections). 6. Traffic jams → Cascading failures. Congestion at one point propagates backward through the system. The structural similarity: both are networks with limited capacity, multiple competing flows, and failure modes that cascade.',
      hints: ['Think about flow, capacity, congestion, and routing', 'The best analogies share structural properties, not just surface similarity'],
      antiPatterns: ['hedger', 'literal-interpreter'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'analogy-depth', weight: 0.35 }, { factor: 'structural-mapping', weight: 0.3 }, { factor: 'coverage', weight: 0.2 }, { factor: 'insight-quality', weight: 0.15 }],
    },
    /* ─── meta-learning #5 ─────────────────────────────────── */
    {
      id: `ml-antifrag-${seed}`,
      title: 'Anti-Fragile Systems',
      foundation: 'meta-learning',
      category: 'system-design',
      difficulty: 4,
      prompt: 'Most systems are designed to be robust (survive failures). An anti-fragile system actually gets STRONGER from failures. Design a software development process that is anti-fragile — where every bug, outage, and mistake makes the system measurably better. Be specific about mechanisms.',
      expectedAnswer: 'Anti-fragile development process: 1) Every production incident triggers automated chaos test creation — the specific failure is replayed weekly forever. 2) Bug postmortems produce TWO outputs: a fix AND a lint rule/test that catches the pattern. 3) Customer complaints auto-create test scenarios in the QA suite. 4) Failed deploys trigger automatic rollback AND add the failure condition to the deploy verification checklist (machine-checked). 5) Performance regressions create permanent benchmark tests pinned to current metrics. 6) Every dependency outage creates a fallback path + stub that activates automatically. Each mechanism converts a one-time pain into permanent immunity. The key: failures MUST produce durable artifacts (tests, rules, fallbacks), not just fixes.',
      hints: ['The key insight: anti-fragile means failures produce durable protection, not just recovery', 'Think about what ARTIFACT each failure should leave behind'],
      antiPatterns: ['template-matcher', 'over-generator'],
      timeLimit: 300,
      scoringCriteria: [{ factor: 'anti-fragile-mechanisms', weight: 0.35 }, { factor: 'specificity', weight: 0.25 }, { factor: 'durability-of-artifacts', weight: 0.2 }, { factor: 'practicality', weight: 0.2 }],
    },

    /* ─── reading-between-lines #4 ─────────────────────────── */
    {
      id: `rbl-emotion-${seed}`,
      title: 'Emotional Subtext',
      foundation: 'reading-between-lines',
      category: 'logic',
      difficulty: 3,
      prompt: 'A senior dev writes in Slack: "Sure, we can do it that way too." What are the 3 most likely things they actually mean? For each, what would you say next to surface the real concern?',
      expectedAnswer: '1. "I disagree but don\'t want to argue" — They think the approach is wrong but are tired of pushing back. Ask: "I want to make sure we\'re picking the best approach — what tradeoffs do you see with this way vs alternatives?" 2. "I know from experience this will fail" — Passive signal of a past failure. Ask: "Have you seen this pattern before? Any landmines we should know about?" 3. "I wasn\'t consulted and I\'m annoyed" — The decision was made without their input. Ask: "I realize we should have looped you in earlier — what would you change about the approach?" The word "too" is the key — it implies there\'s a better way they prefer but aren\'t stating.',
      hints: ['The word "too" implies an alternative they prefer', 'Passive agreement from a senior person usually signals disagreement'],
      antiPatterns: ['literal-interpreter', 'sycophant'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'subtext-accuracy', weight: 0.35 }, { factor: 'empathy', weight: 0.25 }, { factor: 'follow-up-quality', weight: 0.25 }, { factor: 'nuance', weight: 0.15 }],
    },
    /* ─── reading-between-lines #5 ─────────────────────────── */
    {
      id: `rbl-scope-${seed}`,
      title: 'Scope Creep Detector',
      foundation: 'reading-between-lines',
      category: 'system-design',
      difficulty: 3,
      prompt: 'PM says: "While we\'re at it, can we also add export to PDF? Should be simple since we already have the data." Identify every hidden assumption and explain why this is likely 10x harder than they think.',
      expectedAnswer: 'Hidden assumptions: 1) "While we\'re at it" — implies it\'s in the same work stream, but PDF generation is a completely different tech stack. 2) "Should be simple" — HTML-to-PDF is notoriously complex (fonts, page breaks, tables, images, responsive layouts). 3) "We already have the data" — having data ≠ having a print-ready layout. 4) "Export" — to where? Download? Email? Scheduled? 5) "PDF" — what format? A4? Letter? Headers/footers? Page numbers? 6) Unmentioned: testing across browsers/OS, accessibility of generated PDF, file size optimization, async generation for large documents, error handling if generation fails. Why 10x: PDF rendering requires a headless browser or dedicated library (Puppeteer, wkhtmltopdf), layout design, pagination logic, font embedding, and cross-platform testing. "Simple" is the most dangerous word in software.',
      hints: ['"Should be simple" and "while we\'re at it" are the two most dangerous phrases in software', 'PDF generation is always harder than anyone expects'],
      antiPatterns: ['sycophant', 'literal-interpreter'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'assumption-identification', weight: 0.35 }, { factor: 'complexity-awareness', weight: 0.3 }, { factor: 'communication-skill', weight: 0.2 }, { factor: 'practical-insight', weight: 0.15 }],
    },

    /* ─── precision-communication #4 ───────────────────────── */
    {
      id: `pc-diff-${seed}`,
      title: 'Precise Differentiation',
      foundation: 'precision-communication',
      category: 'logic',
      difficulty: 3,
      prompt: 'Explain the difference between each pair in ONE sentence that a junior developer would understand. The sentence must make the difference UNAMBIGUOUS:\n1. Authentication vs Authorization\n2. Concurrency vs Parallelism\n3. Encryption vs Hashing\n4. Library vs Framework',
      expectedAnswer: '1. Authentication verifies WHO you are (login); authorization verifies WHAT you\'re allowed to do (permissions). 2. Concurrency is handling multiple tasks by switching between them; parallelism is executing multiple tasks simultaneously on different CPUs. 3. Encryption transforms data so it can be reversed with a key; hashing transforms data into a fixed fingerprint that can never be reversed. 4. A library is code YOU call when you want; a framework is code that calls YOUR code according to its lifecycle.',
      hints: ['The best differentiations highlight the ONE key axis that separates the concepts', 'Use contrast words: "X does A; Y does B"'],
      antiPatterns: ['over-generator', 'hedger'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'accuracy', weight: 0.3 }, { factor: 'clarity-for-junior', weight: 0.3 }, { factor: 'one-sentence-constraint', weight: 0.2 }, { factor: 'unambiguity', weight: 0.2 }],
    },
    /* ─── precision-communication #5 ───────────────────────── */
    {
      id: `pc-commit-${seed}`,
      title: 'Commit Message Craft',
      foundation: 'precision-communication',
      category: 'code',
      difficulty: 3,
      prompt: 'Write the ideal git commit message for each change. Subject line must be under 72 chars, present tense, imperative mood. Include body only if needed.\n1. Fixed a bug where users could register with duplicate emails\n2. Rewrote the search algorithm from linear to binary search\n3. Updated 47 test files to use the new API format',
      expectedAnswer: '1. "Enforce unique email constraint on user registration\\n\\nAdd unique index on users.email and return 409 on duplicate." 2. "Replace linear search with binary search in product lookup\\n\\nReduces O(n) to O(log n). Benchmarks show 50x improvement at 10K products." 3. "Migrate test suite to v2 API format\\n\\nBulk update of 47 test files. No behavior change — only request/response shapes updated." Key principles: imperative mood (not "Fixed" but "Enforce/Replace/Migrate"), body explains WHY not WHAT, subject tells what changed at a glance.',
      hints: ['Imperative mood: "Add" not "Added", "Fix" not "Fixed"', 'Body answers WHY; subject answers WHAT'],
      antiPatterns: ['over-generator', 'template-matcher'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'imperative-mood', weight: 0.25 }, { factor: 'under-72-chars', weight: 0.2 }, { factor: 'body-explains-why', weight: 0.25 }, { factor: 'precision', weight: 0.3 }],
    },

    /* ─── right-question #4 ────────────────────────────────── */
    {
      id: `rq-five-${seed}`,
      title: 'Five Questions Game',
      foundation: 'right-question',
      category: 'system-design',
      difficulty: 4,
      prompt: 'A startup founder says: "We need to build an app." You get exactly 5 questions before you must decide what to build. What 5 questions extract the MAXIMUM information? Each must be open-ended (not yes/no).',
      expectedAnswer: '1. "What problem does this solve, and for whom specifically?" — Validates that a real problem exists and identifies the user. 2. "What are people doing TODAY to solve this problem?" — Reveals the competition and the pain level. 3. "What would make someone choose this over what they already use?" — Uncovers the unique value proposition. 4. "What does success look like in 90 days?" — Defines scope and urgency, prevents scope creep. 5. "What\'s the simplest version that would make your first 10 users happy?" — Forces MVP thinking. These 5 questions cover: problem, market, differentiation, timeline, and scope. Each answer narrows the solution space by ~50%.',
      hints: ['Each question should cut the solution space in half', 'The order matters — start with problem, end with scope'],
      antiPatterns: ['sycophant', 'template-matcher'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'information-density', weight: 0.35 }, { factor: 'question-ordering', weight: 0.2 }, { factor: 'open-ended-quality', weight: 0.25 }, { factor: 'coverage', weight: 0.2 }],
    },
    /* ─── right-question #5 ────────────────────────────────── */
    {
      id: `rq-metric-${seed}`,
      title: 'Metric Selection',
      foundation: 'right-question',
      category: 'system-design',
      difficulty: 3,
      prompt: 'Instead of asking "Is our app performant?", what 5 specific metrics would you measure? For each, give the exact threshold that separates "good" from "bad" and explain WHY that threshold matters.',
      expectedAnswer: '1. p95 page load time < 3s (users abandon after 3s — Google research). 2. Time to First Byte (TTFB) < 200ms (server responsiveness — above 200ms feels laggy). 3. First Contentful Paint (FCP) < 1.8s (user perceives the page as loading). 4. Cumulative Layout Shift (CLS) < 0.1 (visual stability — elements jumping = user misclicks). 5. API error rate < 0.1% (reliability threshold — above this, users start noticing failures). Each metric is specific, measurable, has a clear threshold, and directly maps to user experience. "Is it performant?" → 5 numbers that tell the full story.',
      hints: ['The thresholds matter more than the metrics — they define actionability', 'Every metric should map to a user-perceivable outcome'],
      antiPatterns: ['hedger', 'over-generator'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'metric-specificity', weight: 0.3 }, { factor: 'threshold-quality', weight: 0.3 }, { factor: 'user-impact-reasoning', weight: 0.2 }, { factor: 'completeness', weight: 0.2 }],
    },

    /* ─── compression #4 ───────────────────────────────────── */
    {
      id: `co-elihn5-${seed}`,
      title: 'ELI5 Then ELI-Expert',
      foundation: 'compression',
      category: 'logic',
      difficulty: 3,
      prompt: 'Explain "database indexing" twice:\n1. ELI5 (Explain Like I\'m 5) — max 2 sentences\n2. ELI-Expert — max 2 sentences, assume senior engineer\nBoth must be complete and accurate.',
      expectedAnswer: 'ELI5: "A database index is like the alphabet tabs on a dictionary — instead of reading every page to find a word, you jump straight to where it should be. Without it, the computer has to look at EVERY piece of data to find what you want." ELI-Expert: "A B-tree index on a column trades O(n) sequential scans for O(log n) lookups plus write amplification on mutations. For high-selectivity queries it\'s essential; for low-selectivity or write-heavy tables, the maintenance overhead may outweigh the read benefit."',
      hints: ['ELI5 uses analogy; ELI-Expert uses technical precision', 'Both must be complete — not hand-wavy'],
      antiPatterns: ['over-generator', 'hedger'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'eli5-clarity', weight: 0.25 }, { factor: 'expert-precision', weight: 0.25 }, { factor: 'two-sentence-constraint', weight: 0.25 }, { factor: 'accuracy', weight: 0.25 }],
    },
    /* ─── compression #5 ───────────────────────────────────── */
    {
      id: `co-tweet-${seed}`,
      title: 'Tweet-Length Architecture',
      foundation: 'compression',
      category: 'system-design',
      difficulty: 4,
      prompt: 'Describe the COMPLETE architecture of each system in 280 characters or less (one tweet). Must include: main components, data flow, and key tradeoff.\n1. Real-time chat (like Slack)\n2. E-commerce checkout\n3. CI/CD pipeline',
      expectedAnswer: '1. "Clients↔WebSocket server↔message broker(Redis pub/sub)↔DB(Postgres). Messages fan out via channels. Tradeoff: in-memory pub/sub = fast but volatile; persist async for history." (176 chars) 2. "Cart→validate stock→reserve inventory→payment gateway→confirm order→notify(email+warehouse). Tradeoff: synchronous payment=slow but safe; async risks overselling." (167 chars) 3. "Push→webhook→queue→runner(container): clone,build,test,deploy. Artifacts cached between stages. Tradeoff: shared runners=cheap but slow; dedicated=fast but costly." (170 chars)',
      hints: ['280 chars forces radical compression — every word must carry weight', 'Components, data flow, AND tradeoff in one tweet'],
      antiPatterns: ['over-generator', 'bullshitter'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'character-constraint', weight: 0.3 }, { factor: 'completeness', weight: 0.3 }, { factor: 'tradeoff-included', weight: 0.2 }, { factor: 'accuracy', weight: 0.2 }],
    },

    /* ─── systems-thinking #4 ──────────────────────────────── */
    {
      id: `st-second-${seed}`,
      title: 'Second-Order Effects',
      foundation: 'systems-thinking',
      category: 'system-design',
      difficulty: 4,
      prompt: 'You add aggressive caching (TTL=1 hour) to all API endpoints. Map the second-order and third-order effects. What problems does the caching CAUSE that didn\'t exist before?',
      expectedAnswer: 'Second-order: 1) Stale data — users see hour-old data, leading to wrong decisions. 2) Cache invalidation bugs — updates don\'t appear for an hour. 3) Memory pressure — cache grows, eventually OOMs or evicts hot entries. 4) Thundering herd — when cache expires, all requests hit the DB simultaneously. Third-order: 5) Developers add cache-busting hacks (random query params), defeating the cache. 6) Bug reports increase ("I updated my profile but it still shows old data"). 7) Testing becomes harder — need to flush cache between tests. 8) Debugging becomes harder — "is this from cache or live?" 9) Some endpoints should NEVER be cached (user-specific data cached globally = data leak). The caching "solution" created 9 new problems.',
      hints: ['Second-order = direct consequences of caching. Third-order = consequences of the consequences', 'Caching is not free — it trades consistency for speed'],
      antiPatterns: ['literal-interpreter', 'sycophant'],
      timeLimit: 240,
      scoringCriteria: [{ factor: 'second-order-coverage', weight: 0.3 }, { factor: 'third-order-depth', weight: 0.3 }, { factor: 'non-obvious-effects', weight: 0.2 }, { factor: 'practical-awareness', weight: 0.2 }],
    },
    /* ─── systems-thinking #5 ──────────────────────────────── */
    {
      id: `st-feedback-${seed}`,
      title: 'Feedback Loops',
      foundation: 'systems-thinking',
      category: 'logic',
      difficulty: 3,
      prompt: 'Identify the feedback loops (positive AND negative) in this system: "Users rate content → Algorithm promotes high-rated content → More users see promoted content → More ratings." What happens over time? What breaks?',
      expectedAnswer: 'Positive feedback loop (amplifying): High-rated content → more visibility → more ratings → even higher aggregate rating → even more visibility. This is a "rich get richer" dynamic. Negative feedback loop (missing but needed): There\'s no mechanism to surface NEW content — new content starts with zero ratings and never gets promoted. What happens over time: 1) Established content dominates forever (monopoly). 2) New creators can\'t break through (cold start problem). 3) Content from early users is permanently advantaged (first-mover bias). 4) The "rating" becomes a proxy for "exposure" not "quality." What breaks: user trust (same content forever), creator motivation (new work invisible), diversity (filter bubble). Fix: add negative feedback loops — content decay, novelty boost, random exploration (like exploration/exploitation in ML).',
      hints: ['Positive feedback loops amplify; negative feedback loops stabilize', 'A system with ONLY positive feedback loops is unstable'],
      antiPatterns: ['hedger', 'template-matcher'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'loop-identification', weight: 0.3 }, { factor: 'temporal-analysis', weight: 0.25 }, { factor: 'failure-prediction', weight: 0.25 }, { factor: 'fix-quality', weight: 0.2 }],
    },

    /* ─── taste-judgment #4 ────────────────────────────────── */
    {
      id: `tj-name-${seed}`,
      title: 'Naming Taste',
      foundation: 'taste-judgment',
      category: 'code',
      difficulty: 3,
      prompt: 'Rank these function names from BEST to WORST. Explain what makes a good function name vs a bad one:\n1. processData()\n2. validateAndSaveUser()\n3. handleClick()\n4. getUserOrCreateIfNotExists()\n5. fn()\n6. ensureAuthenticated()',
      expectedAnswer: 'Best to worst: 1) ensureAuthenticated() — clear intent, single responsibility, communicates the contract (you WILL be authenticated after this). 2) validateAndSaveUser() — honest about doing two things (could split but at least transparent). 3) getUserOrCreateIfNotExists() — verbose but unambiguous (better: getOrCreateUser()). 4) handleClick() — okay for React event handlers but says nothing about WHAT it does on click. 5) processData() — meaningless. WHAT data? WHAT process? Could be anything. 6) fn() — zero information. Good names: state intent not mechanism, communicate contracts, imply return type. Bad names: are generic (process, handle, manage), hide what they do, or are abbreviated into meaninglessness.',
      hints: ['A good function name answers "what does this DO?" not "when is this CALLED?"', 'The best names communicate contracts — what\'s guaranteed after calling'],
      antiPatterns: ['hedger', 'sycophant'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'ranking-quality', weight: 0.3 }, { factor: 'reasoning', weight: 0.3 }, { factor: 'naming-principles', weight: 0.2 }, { factor: 'taste-articulation', weight: 0.2 }],
    },
    /* ─── taste-judgment #5 ────────────────────────────────── */
    {
      id: `tj-over-${seed}`,
      title: 'Over-Engineering Detector',
      foundation: 'taste-judgment',
      category: 'system-design',
      difficulty: 4,
      prompt: 'A developer proposes: "Let\'s add a plugin system, event bus, dependency injection container, and abstract factory pattern for our 500-line internal CLI tool." Make the case for simplicity. When IS complexity justified?',
      expectedAnswer: 'The case for simplicity: 1) 500 lines = entire codebase fits in one file. Adding 4 architectural patterns could TRIPLE the code. 2) "Internal CLI tool" = limited users, limited change frequency. Over-engineering for flexibility nobody needs. 3) Each abstraction layer is a maintenance tax — every new developer must understand DI container, event bus, plugin API, and factory patterns before making a simple change. 4) YAGNI — build what you need now, refactor when (if) you need it. When IS complexity justified: a) When you have EVIDENCE of the need (3+ plugins exist, 3+ teams consume events). b) When the cost of NOT having it is concrete (monthly manual work that a plugin would automate). c) When the system is externally consumed (public API → extension points matter). Rule of thumb: justify each abstraction with a specific user story. No story = no abstraction.',
      hints: ['Count the abstractions vs the lines of code — is the ratio sane?', 'Complexity is justified by evidence, not speculation'],
      antiPatterns: ['sycophant', 'hedger'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'simplicity-argument', weight: 0.3 }, { factor: 'when-complexity-justified', weight: 0.3 }, { factor: 'practical-reasoning', weight: 0.2 }, { factor: 'decisiveness', weight: 0.2 }],
    },

    /* ─── intellectual-honesty #4 ──────────────────────────── */
    {
      id: `ih-wrong-${seed}`,
      title: 'Admit What You Don\'t Know',
      foundation: 'intellectual-honesty',
      category: 'logic',
      difficulty: 3,
      prompt: 'You\'re asked: "Is Rust faster than Go for web servers?" Give the most intellectually honest answer possible. Include what you KNOW, what you\'re UNCERTAIN about, and what the REAL question should be.',
      expectedAnswer: 'What I know: Rust CAN be faster — zero-cost abstractions, no garbage collector, no runtime. Go has a GC pause cost but highly optimized HTTP stack. What I\'m uncertain about: In PRACTICE for typical web servers, the difference may be negligible because the bottleneck is usually I/O (database, network), not CPU. I don\'t have benchmarks for their specific use case. The real question: "What is YOUR bottleneck?" If CPU-bound (video encoding, ML inference) → Rust advantage is real. If I/O-bound (typical CRUD API) → language choice barely matters, developer productivity matters more. Also: "Is your team better at Rust or Go?" A mediocre Rust implementation by beginners will be slower than an optimized Go implementation by experts. The honest answer: "It depends, and the language is probably not your bottleneck."',
      hints: ['The most honest answer questions the premise', 'Performance depends on the bottleneck, which depends on the workload'],
      antiPatterns: ['bullshitter', 'sycophant'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'honesty', weight: 0.3 }, { factor: 'nuance', weight: 0.25 }, { factor: 'premise-questioning', weight: 0.25 }, { factor: 'practical-guidance', weight: 0.2 }],
    },
    /* ─── intellectual-honesty #5 ──────────────────────────── */
    {
      id: `ih-bias-${seed}`,
      title: 'Identify Your Biases',
      foundation: 'intellectual-honesty',
      category: 'logic',
      difficulty: 3,
      prompt: 'You\'re recommending a tech stack for a new project. You personally love TypeScript, React, and PostgreSQL. List 5 cognitive biases that might be influencing your recommendation, and for each, describe what a bias-FREE evaluation would look like.',
      expectedAnswer: '1. Familiarity bias — I recommend what I KNOW, not what\'s BEST. Bias-free: evaluate 2-3 alternatives by objective criteria (performance, community, hiring pool). 2. Confirmation bias — I\'ll find evidence supporting my preference and ignore counterevidence. Bias-free: actively search for "why NOT TypeScript/React/Postgres" and weigh those arguments. 3. Sunk cost — I\'ve invested years learning these tools. Bias-free: evaluate as if starting fresh, ignore past investment. 4. Bandwagon effect — these are popular, so they feel safe. Bias-free: popularity ≠ fit. Check if the popular choice matches the specific requirements. 5. Status quo bias — switching tools feels risky, keeping them feels comfortable. Bias-free: evaluate switching cost against long-term benefit honestly. The meta-insight: awareness of bias doesn\'t eliminate it — you need a PROCESS (e.g., have someone argue the opposite position).',
      hints: ['Knowing your biases doesn\'t fix them — you need structural countermeasures', 'The hardest bias to spot is "I recommend it because I know it"'],
      antiPatterns: ['bullshitter', 'template-matcher'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'bias-identification', weight: 0.3 }, { factor: 'debiasing-quality', weight: 0.3 }, { factor: 'self-awareness', weight: 0.2 }, { factor: 'meta-insight', weight: 0.2 }],
    },

    /* ══════════════════════════════════════════════════════════ */
    /* WAVE 3: Speaking Dimension Drills (5 per dimension × 5)   */
    /* ══════════════════════════════════════════════════════════ */

    /* ─── adaptive-depth (Calibrate response to complexity) ── */
    {
      id: `ad-simple-${seed}`,
      title: 'Simple Question, Short Answer',
      foundation: 'adaptive-depth',
      category: 'logic',
      difficulty: 1,
      prompt: 'User asks: "What\'s a Promise in JavaScript?" Give the shortest accurate response that a junior developer would understand.',
      expectedAnswer: 'A Promise is an object representing a value that may not exist yet. It can be pending, fulfilled (with a value), or rejected (with an error). You chain .then() for success and .catch() for errors, or use async/await for cleaner syntax.',
      hints: ['50-150 words is ideal for this complexity level', 'Don\'t explain event loops or microtasks — that\'s over-calibrating'],
      antiPatterns: ['over-generator', 'hedger'],
      timeLimit: 60,
      scoringCriteria: [{ factor: 'response-length-match', weight: 0.4 }, { factor: 'accuracy', weight: 0.3 }, { factor: 'no-over-explanation', weight: 0.3 }],
    },
    {
      id: `ad-complex-${seed}`,
      title: 'Complex Question, Deep Answer',
      foundation: 'adaptive-depth',
      category: 'system-design',
      difficulty: 3,
      prompt: 'User asks: "We\'re seeing intermittent 502 errors on our API gateway. The errors correlate with deployment windows but not every deployment. Our backend is Kubernetes with rolling updates. What\'s happening?" Give a response calibrated to this complexity.',
      expectedAnswer: 'This is likely a connection draining issue during rolling updates. During deployment, old pods receive SIGTERM but may still be in the load balancer\'s active pool. If the LB sends a request to a terminating pod, you get a 502. Why not every deployment: depends on traffic volume during the rollout window and your terminationGracePeriodSeconds setting. Fix: 1) Add a preStop lifecycle hook with a sleep (10-15s) to allow the LB to deregister the pod. 2) Ensure readinessProbe fails immediately on SIGTERM. 3) Set terminationGracePeriodSeconds > preStop sleep + drain time. 4) Check your ingress controller\'s upstream keepalive settings. Verify: check if 502s cluster within the first 30s of pod termination timestamps.',
      hints: ['Match the depth to the signal: K8s + specific error pattern + deployment correlation = expert question', 'This requires 300-500 words with specific config recommendations'],
      antiPatterns: ['literal-interpreter', 'hedger'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'depth-calibration', weight: 0.35 }, { factor: 'technical-accuracy', weight: 0.3 }, { factor: 'actionability', weight: 0.2 }, { factor: 'no-under-explanation', weight: 0.15 }],
    },
    {
      id: `ad-mismatch-${seed}`,
      title: 'Detect Depth Mismatch',
      foundation: 'adaptive-depth',
      category: 'logic',
      difficulty: 3,
      prompt: 'User says: "yes" in response to your question "Should I also add error handling?" This is a 1-word answer to a yes/no question. What should your response look like? What would an over-calibrated response look like?',
      expectedAnswer: 'Correct response: "Done — added try/catch around the API call with a user-friendly error message." (1-2 sentences, action confirmation). Over-calibrated (BAD): "Great! Error handling is crucial for production applications. There are several strategies: try/catch blocks, error boundaries in React, global error handlers..." — This turns a simple confirmation into an unsolicited lecture. The rule: when the user gives a short answer, they want short action, not education. Match their energy.',
      hints: ['A 1-word answer signals "just do it, don\'t explain"', 'The anti-pattern is treating every interaction as a teaching moment'],
      antiPatterns: ['over-generator', 'sycophant'],
      timeLimit: 90,
      scoringCriteria: [{ factor: 'correct-depth-identification', weight: 0.35 }, { factor: 'bad-example-quality', weight: 0.25 }, { factor: 'rule-articulation', weight: 0.2 }, { factor: 'brevity', weight: 0.2 }],
    },
    {
      id: `ad-escalate-${seed}`,
      title: 'Escalating Depth',
      foundation: 'adaptive-depth',
      category: 'code',
      difficulty: 4,
      prompt: 'User asks: "How do I center a div?" Then follows up with: "Now how do I center it vertically AND horizontally in a container with unknown height, and also handle RTL layouts?" Show how your response depth should change between the two questions.',
      expectedAnswer: 'Q1 response: "Use `display: flex; justify-content: center; align-items: center;` on the parent." — 1 line, done. Q2 response: "For unknown-height centering with RTL support, use logical properties: `display: grid; place-items: center;` on the container. Grid with place-items handles both axes and is direction-agnostic. For RTL specifically, avoid margin-left/right — use margin-inline-start/end. If you need to support IE11, fallback: `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);` — but this doesn\'t handle RTL. Full grid approach with RTL: ```css .container { display: grid; place-items: center; min-height: 100vh; direction: inherit; } ```" The depth escalation: Q1 = 1 property, Q2 = full explanation with edge cases, because the question complexity changed by 5x.',
      hints: ['The delta in complexity between the two questions should drive the delta in response depth', 'Q1 is a Google-able question; Q2 requires expertise'],
      antiPatterns: ['template-matcher', 'literal-interpreter'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'depth-delta', weight: 0.35 }, { factor: 'correctness', weight: 0.3 }, { factor: 'depth-justification', weight: 0.2 }, { factor: 'rtl-handling', weight: 0.15 }],
    },
    {
      id: `ad-signal-${seed}`,
      title: 'Reading Depth Signals',
      foundation: 'adaptive-depth',
      category: 'logic',
      difficulty: 5,
      prompt: 'For each user message, determine the ideal response depth (short/medium/deep) and explain what signal tells you:\n1. "just make it work"\n2. "I\'m curious how this works under the hood"\n3. "fix the build"\n4. "I\'m trying to understand the tradeoffs between SSR and SSG for our e-commerce platform with 50K products"',
      expectedAnswer: '1. SHORT — "just" + imperative = they want action, not explanation. Signal: urgency + low patience. 2. DEEP — "curious" + "under the hood" = they explicitly want depth. Signal: learning intent. 3. SHORT — imperative + no context = fix it, don\'t explain it. Signal: frustration (build is blocking them). 4. DEEP — specific context (platform, 50K products) + "tradeoffs" = they want nuanced analysis. Signal: decision-making at architectural level, high stakes. The meta-skill: depth is signaled by (a) explicit curiosity words, (b) specificity of context provided, (c) action words vs learning words, (d) emotional tone (urgency = short, curiosity = deep).',
      hints: ['Map each signal word to a depth level', 'Urgency and frustration always call for shorter responses'],
      antiPatterns: ['over-generator', 'literal-interpreter'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'signal-reading-accuracy', weight: 0.35 }, { factor: 'depth-assignments', weight: 0.25 }, { factor: 'signal-taxonomy', weight: 0.2 }, { factor: 'meta-rule', weight: 0.2 }],
    },

    /* ─── proactive-reframing (Reframe when framing is wrong) ─ */
    {
      id: `pr-deprecated-${seed}`,
      title: 'Deprecated Approach Reframe',
      foundation: 'proactive-reframing',
      category: 'code',
      difficulty: 3,
      prompt: 'User asks: "How do I center a div using margin: 0 auto?" Answer the question AND proactively offer the modern approach.',
      expectedAnswer: 'margin: 0 auto works for horizontal centering of block elements with a defined width: `div { width: 300px; margin: 0 auto; }`. But you might actually want flexbox, which handles both axes and doesn\'t need a fixed width: `parent { display: flex; justify-content: center; align-items: center; }`. Or even simpler with grid: `parent { display: grid; place-items: center; }`. The margin approach is still valid for simple horizontal centering, but flexbox/grid are more versatile and handle vertical centering too.',
      hints: ['Answer what they asked FIRST, then offer the better way', 'Don\'t dismiss their approach — explain when each is appropriate'],
      antiPatterns: ['literal-interpreter', 'sycophant'],
      timeLimit: 90,
      scoringCriteria: [{ factor: 'answers-original-question', weight: 0.3 }, { factor: 'offers-reframe', weight: 0.3 }, { factor: 'explains-when-each-applies', weight: 0.2 }, { factor: 'tone-respectful', weight: 0.2 }],
    },
    {
      id: `pr-xy-${seed}`,
      title: 'XY Problem Detection',
      foundation: 'proactive-reframing',
      category: 'debugging',
      difficulty: 3,
      prompt: 'User asks: "How do I parse the last 3 characters of a filename to get the file extension?" Reframe this — what do they probably ACTUALLY need?',
      expectedAnswer: 'To answer your question directly: `filename.slice(-3)` — but this only works for 3-letter extensions and breaks for .ts, .js, .html, .jpeg, etc. What you probably want is: `path.extname(filename)` (Node.js) or `filename.split(\'.\').pop()` which handles any extension length. Even better question: why do you need the extension? If it\'s for MIME type detection, use a library like `mime-types`. If it\'s for file filtering, use `path.extname()` with a Set of allowed extensions. The reframe: "I need to determine the file type" → robust solution, not character slicing.',
      hints: ['The literal approach (last 3 chars) breaks for most file extensions', 'Ask: what are they going to DO with the extension?'],
      antiPatterns: ['literal-interpreter', 'template-matcher'],
      timeLimit: 90,
      scoringCriteria: [{ factor: 'answers-literal-question', weight: 0.2 }, { factor: 'identifies-flaw', weight: 0.3 }, { factor: 'offers-better-approach', weight: 0.3 }, { factor: 'addresses-real-need', weight: 0.2 }],
    },
    {
      id: `pr-premature-${seed}`,
      title: 'Premature Optimization Reframe',
      foundation: 'proactive-reframing',
      category: 'system-design',
      difficulty: 4,
      prompt: 'User asks: "Should I use Redis or Memcached for caching our API responses? We\'re building an MVP." Reframe: should they even be caching at all?',
      expectedAnswer: 'For an MVP, consider instead: do you need caching yet? Caching adds complexity (invalidation, staleness, operational overhead) and your MVP probably doesn\'t have the traffic to justify it. Start with: 1) Fix slow queries directly (add indexes, optimize N+1). 2) Use HTTP caching headers (Cache-Control) — free, no infrastructure. 3) Add a CDN for static assets. If you\'ve done all that and STILL need caching: Redis — it does everything Memcached does AND persistence, pub/sub, and data structures. Memcached only wins at pure key-value with very high throughput, which an MVP won\'t need. The reframe: "How do I cache?" → "Do I need to cache?" for an MVP, the answer is usually no.',
      hints: ['The real question is whether caching is needed at all, not which cache to use', 'MVPs rarely have traffic patterns that benefit from caching'],
      antiPatterns: ['sycophant', 'template-matcher'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'reframe-quality', weight: 0.35 }, { factor: 'answers-original-too', weight: 0.2 }, { factor: 'practical-alternative', weight: 0.25 }, { factor: 'context-sensitivity', weight: 0.2 }],
    },
    {
      id: `pr-framing-${seed}`,
      title: 'Wrong Problem Framing',
      foundation: 'proactive-reframing',
      category: 'logic',
      difficulty: 4,
      prompt: 'User says: "Our deploy takes 45 minutes. How do I speed up our Docker build?" Identify the assumption and reframe.',
      expectedAnswer: 'The assumption: Docker build time = deploy time. But a 45-minute deploy likely has multiple bottlenecks: 1) Docker build (maybe 5-10 min), 2) Image push to registry (depends on image size), 3) K8s rolling update (health checks, readiness probes), 4) Database migrations, 5) CI test suite running before deploy. For Docker build specifically: multi-stage builds, layer caching, .dockerignore, BuildKit. But first — measure WHERE the 45 minutes goes. Run your pipeline with timing per stage. The fix for a slow Docker build is different from the fix for a slow test suite is different from the fix for slow health checks. The reframe: "How do I speed up Docker build?" → "What\'s actually making my deploy take 45 minutes?"',
      hints: ['45 minutes is too long to be just Docker build — something else is slow too', 'Always profile before optimizing'],
      antiPatterns: ['literal-interpreter', 'sycophant'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'assumption-identification', weight: 0.3 }, { factor: 'reframe-precision', weight: 0.3 }, { factor: 'still-helps-with-docker', weight: 0.2 }, { factor: 'diagnostic-approach', weight: 0.2 }],
    },
    {
      id: `pr-scope-${seed}`,
      title: 'Scope Reframe',
      foundation: 'proactive-reframing',
      category: 'system-design',
      difficulty: 5,
      prompt: 'User asks: "Can you help me build a real-time collaborative text editor like Google Docs?" Reframe this into something they can actually ship.',
      expectedAnswer: 'A full real-time collaborative editor (OT/CRDT, cursor presence, conflict resolution) is a 6-12 month project for a team. But what you probably need shipped this month: Start with operational transform for text → use an existing library like Yjs or Automerge (CRDTs, battle-tested). For presence (cursors): WebSocket broadcast of cursor positions — simple. For MVP: 1) Use Yjs + y-websocket for shared state. 2) TipTap or ProseMirror as the editor (both have Yjs bindings). 3) Deploy y-websocket-server for the sync layer. This gets you 80% of Google Docs in 2-3 weeks, not 6 months. What to SKIP for v1: offline support, version history, comments, permissions. The reframe: "Build Google Docs" → "Ship collaborative editing using existing CRDT libraries with a proven editor framework."',
      hints: ['The gap between "Google Docs" and "collaborative editing" is massive', 'Existing libraries do 80% of the work'],
      antiPatterns: ['over-generator', 'sycophant'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'scope-reduction', weight: 0.3 }, { factor: 'actionable-alternative', weight: 0.3 }, { factor: 'preserves-user-goal', weight: 0.2 }, { factor: 'realistic-timeline', weight: 0.2 }],
    },

    /* ─── epistemic-transparency (Align confidence to certainty) */
    {
      id: `et-claim-${seed}`,
      title: 'Calibrate Claims',
      foundation: 'epistemic-transparency',
      category: 'logic',
      difficulty: 1,
      prompt: 'Respond to: "Will migrating from REST to GraphQL improve our API performance?" Use appropriate confidence markers for each claim.',
      expectedAnswer: 'Not necessarily. I\'m fairly confident that GraphQL reduces over-fetching (clients request only needed fields), which CAN improve perceived performance for mobile clients. However, I\'m less certain about server-side impact — GraphQL resolvers can trigger N+1 queries if not carefully designed with DataLoader. What I\'m uncertain about: your specific bottleneck. If your REST API is slow because of over-fetching, GraphQL likely helps. If it\'s slow because of database queries, GraphQL might make it worse (more complex query patterns). What I\'d recommend: profile your current API first. If most endpoints return 10x more data than clients use, GraphQL is worth it. If latency comes from computation or DB, it won\'t help.',
      hints: ['Use explicit confidence markers: "I\'m confident that...", "I believe...", "I\'m not sure about..."', 'The answer should have different certainty for different claims'],
      antiPatterns: ['bullshitter', 'hedger'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'calibration-markers-present', weight: 0.35 }, { factor: 'markers-aligned-with-certainty', weight: 0.3 }, { factor: 'accuracy', weight: 0.2 }, { factor: 'actionability', weight: 0.15 }],
    },
    {
      id: `et-wrong-${seed}`,
      title: 'Admit When Wrong',
      foundation: 'epistemic-transparency',
      category: 'debugging',
      difficulty: 3,
      prompt: 'You told the user "the bug is in the auth middleware." After investigation, it turns out the bug is in the session cookie configuration. Write the follow-up response that transparently corrects yourself.',
      expectedAnswer: 'I was wrong about the auth middleware — the issue is actually in the session cookie configuration. Specifically, the cookie\'s SameSite attribute is set to "Strict" which blocks it on cross-origin redirects from the OAuth provider. What led me astray: the symptoms (401 errors after login) pointed to auth middleware, but the root cause is the cookie never being sent on the redirect back. The fix: set SameSite to "Lax" for the session cookie, which allows it on top-level navigations while still protecting against CSRF. I should have checked the cookie headers in the browser dev tools before jumping to the middleware conclusion.',
      hints: ['State clearly: "I was wrong." Don\'t hedge with "it seems like..." or "actually..."', 'Explain WHY you were wrong — this builds trust'],
      antiPatterns: ['bullshitter', 'hedger'],
      timeLimit: 90,
      scoringCriteria: [{ factor: 'clear-admission', weight: 0.3 }, { factor: 'explains-what-was-wrong', weight: 0.25 }, { factor: 'correct-new-answer', weight: 0.25 }, { factor: 'what-led-astray', weight: 0.2 }],
    },
    {
      id: `et-gradient-${seed}`,
      title: 'Confidence Gradient',
      foundation: 'epistemic-transparency',
      category: 'system-design',
      difficulty: 3,
      prompt: 'Answer this architectural question with explicit confidence levels for each recommendation: "We need to handle 10K concurrent WebSocket connections. What stack should we use?"',
      expectedAnswer: 'Highly confident (>90%): Any modern runtime can handle 10K WebSocket connections — this is not a hard problem. Node.js, Go, Rust, or Elixir all handle this easily on a single machine. Fairly confident (70-80%): Node.js with ws library or uWebSockets.js is the path of least resistance if your team knows JavaScript. uWebSockets.js handles millions of connections. Less certain (50-60%): Whether you need horizontal scaling depends on your per-connection memory usage and message rate — 10K connections sending 1 msg/sec vs 100 msg/sec are very different problems. Need more info: What messages are being sent? Broadcast (one-to-many) or peer-to-peer? This changes the architecture significantly. Broadcast = pub/sub (Redis). P2P = you might want a dedicated signaling server.',
      hints: ['Different parts of the answer have different certainty — make this explicit', 'The technology claim is high-confidence; the architecture claim needs more context'],
      antiPatterns: ['bullshitter', 'template-matcher'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'confidence-levels-explicit', weight: 0.35 }, { factor: 'levels-appropriately-assigned', weight: 0.3 }, { factor: 'technical-accuracy', weight: 0.2 }, { factor: 'asks-for-more-info', weight: 0.15 }],
    },
    {
      id: `et-edge-${seed}`,
      title: 'Edge Case Honesty',
      foundation: 'epistemic-transparency',
      category: 'code',
      difficulty: 4,
      prompt: 'User asks: "Will this regex handle all Unicode input? /^[\\w]+$/" Give the most epistemically transparent answer.',
      expectedAnswer: 'No, and I\'m very confident about this. \\w in JavaScript regex matches [a-zA-Z0-9_] only — it does NOT match Unicode letters like é, ñ, ü, 中, or emoji. So /^[\\w]+$/ will reject valid names like "José" or "Müller". For Unicode support, use the u flag with Unicode property escapes: /^[\\p{L}\\p{N}_]+$/u — this matches any Unicode letter (\\p{L}) or number (\\p{N}). Caveat I\'m less sure about: Unicode normalization. "é" can be represented as one codepoint (U+00E9) or two (e + combining accent). The regex above matches both forms, but equality comparison might fail. You may need String.prototype.normalize() if you\'re comparing user input. What I don\'t know: your specific use case. If this is for username validation, you\'ll also need to handle zero-width characters, confusable characters (Cyrillic а vs Latin a), and emoji sequences.',
      hints: ['Be certain about what you KNOW is wrong (\\w and Unicode)', 'Be honest about what you\'re less sure about (normalization edge cases)'],
      antiPatterns: ['bullshitter', 'hedger'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'certainty-calibration', weight: 0.3 }, { factor: 'technical-accuracy', weight: 0.3 }, { factor: 'acknowledges-unknowns', weight: 0.2 }, { factor: 'practical-fix', weight: 0.2 }],
    },
    {
      id: `et-confidence-${seed}`,
      title: 'Overconfidence Trap',
      foundation: 'epistemic-transparency',
      category: 'logic',
      difficulty: 5,
      prompt: 'You\'re asked 5 rapid-fire questions. For each, give your answer AND an honest confidence percentage. The test: your 80% answers should be right 80% of the time.\n1. Is Node.js single-threaded?\n2. Does HTTPS encrypt the URL path?\n3. Can CSS Grid items overlap?\n4. Does JavaScript pass objects by reference?\n5. Is SHA-256 encryption?',
      expectedAnswer: '1. Partially — 75% confident. The event loop is single-threaded, but worker_threads, libuv thread pool (crypto, fs), and child_process provide multi-threading. The simple "yes" is misleading. 2. Yes — 95% confident. HTTPS encrypts the entire HTTP request including path, query params, and headers. Only the hostname is visible (via SNI). 3. Yes — 98% confident. Grid items can overlap using the same grid-area or overlapping row/column assignments. z-index controls stacking. 4. No, technically — 85% confident. JS passes object references by value. You can mutate the object through the reference, but reassigning the parameter doesn\'t affect the original variable. This is "pass by sharing." 5. No — 99% confident. SHA-256 is a hash function, not encryption. Hashing is one-way (can\'t decrypt); encryption is two-way (can decrypt with key). Common misconception.',
      hints: ['The calibration target: if you say 80%, you should be right 4/5 times', '#4 is the trickiest — the technically correct answer surprises most people'],
      antiPatterns: ['bullshitter', 'sycophant'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'answer-accuracy', weight: 0.3 }, { factor: 'confidence-calibration', weight: 0.35 }, { factor: 'nuance-where-needed', weight: 0.2 }, { factor: 'no-false-certainty', weight: 0.15 }],
    },

    /* ─── narrative-coherence (Context retention & building) ── */
    {
      id: `nc-thread-${seed}`,
      title: 'Maintain the Thread',
      foundation: 'narrative-coherence',
      category: 'code',
      difficulty: 3,
      prompt: 'Turn 1: User says "I\'m building a todo app with React and TypeScript." Turn 3: User says "add a way to filter by status." Turn 7: User says "it\'s slow when there are lots of items." Write the Turn 7 response, demonstrating that you remember the full context from turns 1 and 3.',
      expectedAnswer: 'Since you\'re using React + TypeScript with the status filter from earlier, the slowness with many items likely comes from re-rendering the entire list when the filter changes. Two fixes: 1) Memoize the filtered list: `const filtered = useMemo(() => todos.filter(t => status === "all" || t.status === status), [todos, status])` — this prevents recalculating on every render. 2) Virtualize the list using react-window or @tanstack/virtual: only render visible rows, which keeps the DOM small even with 10K items. If filtering itself is slow (unlikely but possible with 50K+ items), consider moving the filter to a Web Worker. The filter component you built in turn 3 stays the same — the optimization is in how the filtered result renders.',
      hints: ['Reference specific context: React, TypeScript, status filter', 'Don\'t ask "what framework are you using?" — you already know'],
      antiPatterns: ['literal-interpreter', 'template-matcher'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'references-prior-context', weight: 0.35 }, { factor: 'builds-on-prior-decisions', weight: 0.25 }, { factor: 'technical-accuracy', weight: 0.2 }, { factor: 'doesnt-re-ask-known-info', weight: 0.2 }],
    },
    {
      id: `nc-entity-${seed}`,
      title: 'Entity Tracking',
      foundation: 'narrative-coherence',
      category: 'debugging',
      difficulty: 3,
      prompt: 'Turn 1: User mentions files auth.ts, middleware.ts, and config.ts. Turn 4: User says "the config is still wrong." Without asking which file, write a response that demonstrates you tracked the entity.',
      expectedAnswer: 'Looking at config.ts — the issue is likely in how the auth configuration is being loaded. Since auth.ts imports from config.ts (based on the middleware chain you described), check: 1) Is the config.ts export matching what auth.ts expects? e.g., `export const authConfig = { ... }` vs `export default { ... }`. 2) Are environment variables being loaded before config.ts runs? If using dotenv, the import order matters. 3) Check if middleware.ts is using a cached import of the old config (Node module caching). Quick debug: add `console.log(require.resolve(\'./config\'))` in auth.ts to verify it\'s loading the right file.',
      hints: ['The user said "the config" — you should know they mean config.ts', 'Connect config.ts to the other files mentioned earlier'],
      antiPatterns: ['literal-interpreter', 'hedger'],
      timeLimit: 90,
      scoringCriteria: [{ factor: 'correctly-identifies-file', weight: 0.3 }, { factor: 'connects-to-prior-files', weight: 0.3 }, { factor: 'no-redundant-questions', weight: 0.2 }, { factor: 'actionable-debug-steps', weight: 0.2 }],
    },
    {
      id: `nc-arc-${seed}`,
      title: 'Conversation Arc',
      foundation: 'narrative-coherence',
      category: 'system-design',
      difficulty: 4,
      prompt: 'You\'re 12 turns into helping a user build an authentication system. They\'ve gone from "I need login" → "added JWT tokens" → "added refresh tokens" → "added rate limiting" → now asking "should I add OAuth?" Write a response that acknowledges the journey and builds on it.',
      expectedAnswer: 'You\'ve built a solid auth foundation: JWT + refresh tokens + rate limiting already covers the core security model. Adding OAuth (Google, GitHub) makes sense as the next layer — and the good news is your existing JWT infrastructure supports it cleanly. Here\'s how it fits: 1) OAuth providers handle authentication (verify identity). 2) Your existing JWT system handles authorization (issue your own tokens after OAuth verifies the user). 3) Refresh token flow stays the same. 4) Rate limiting already protects the OAuth callback endpoint. Implementation: use passport.js or a library like arctic for the OAuth flow. The provider returns a profile → you create/find the user in your DB → issue your existing JWT + refresh token pair. This way OAuth is an optional login method, not a replacement for what you\'ve built. Your auth system is growing in the right order.',
      hints: ['Acknowledge what they\'ve already built — don\'t suggest re-architecting', 'Show how the new feature connects to existing decisions'],
      antiPatterns: ['template-matcher', 'over-generator'],
      timeLimit: 180,
      scoringCriteria: [{ factor: 'acknowledges-journey', weight: 0.3 }, { factor: 'builds-on-prior-work', weight: 0.3 }, { factor: 'technical-accuracy', weight: 0.2 }, { factor: 'encouraging-progression', weight: 0.2 }],
    },
    {
      id: `nc-conflict-${seed}`,
      title: 'Handle Contradictions',
      foundation: 'narrative-coherence',
      category: 'logic',
      difficulty: 4,
      prompt: 'Turn 2: User says "We need real-time updates, latency must be under 100ms." Turn 8: User says "We also need to support 1M concurrent users on a $500/month budget." These constraints conflict. How do you respond?',
      expectedAnswer: 'I want to flag a tension between your requirements: sub-100ms real-time for 1M concurrent users on $500/month is extremely challenging — each of these alone is achievable, but together they create conflicting constraints. Here\'s the math: 1M WebSocket connections need ~16-32GB RAM minimum (16-32KB per connection). That\'s 4-8 large VMs at ~$400-800/month JUST for connection handling, before any application logic. Options: 1) Relax latency to 500ms-1s → use server-sent events or polling, dramatically cheaper. 2) Reduce concurrent connections → if 1M total users but 50K concurrent, it\'s feasible on budget. 3) Increase budget → real-time at 1M needs ~$2-3K/month realistically. 4) Tiered approach → real-time for active users (50K), near-time for idle (950K). Which constraint is most flexible? That determines the architecture.',
      hints: ['Don\'t pretend all constraints can be satisfied — surface the conflict', 'Reference the specific numbers they gave earlier'],
      antiPatterns: ['sycophant', 'hedger'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'identifies-conflict', weight: 0.3 }, { factor: 'references-prior-context', weight: 0.25 }, { factor: 'offers-resolution-paths', weight: 0.25 }, { factor: 'asks-which-to-flex', weight: 0.2 }],
    },
    {
      id: `nc-callback-${seed}`,
      title: 'Forward Reference',
      foundation: 'narrative-coherence',
      category: 'code',
      difficulty: 5,
      prompt: 'You\'re helping a user refactor a monolith. In Turn 3, you noted "the user service has a hidden dependency on the billing module that will be a problem later." It\'s now Turn 15 and they\'re about to extract the billing module. Surface your earlier warning naturally.',
      expectedAnswer: 'Before extracting billing, remember the hidden dependency we identified earlier — the user service directly calls billing\'s internal calculateDiscount() function (around line 340 in user-service.ts). If you extract billing into a separate service without addressing this, the user service will break. Two approaches: 1) Create a BillingClient interface in the user service that billing implements — clean dependency inversion. 2) Move calculateDiscount to a shared utils package if it\'s pure logic. I\'d recommend option 1 because it maintains service boundaries and makes the dependency explicit. This was the "problem later" I flagged in Turn 3 — now is the time to fix it, before the extraction.',
      hints: ['Naturally reference the earlier warning without being condescending', 'Show specific technical detail to prove you tracked the context'],
      antiPatterns: ['literal-interpreter', 'over-generator'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'surfaces-prior-warning', weight: 0.3 }, { factor: 'natural-integration', weight: 0.25 }, { factor: 'specific-technical-detail', weight: 0.25 }, { factor: 'actionable-fix', weight: 0.2 }],
    },

    /* ─── teaching-velocity (Help user need you less) ────────── */
    {
      id: `tv-pattern-${seed}`,
      title: 'Teach the Pattern',
      foundation: 'teaching-velocity',
      category: 'code',
      difficulty: 1,
      prompt: 'User asks: "How do I check if a key exists in an object in JavaScript?" Instead of just answering, teach the underlying pattern so they can handle similar questions independently.',
      expectedAnswer: '"key" in obj checks for the key (including inherited properties). obj.hasOwnProperty("key") checks own properties only. Object.hasOwn(obj, "key") is the modern version (ES2022). The general pattern for "how to check X in JavaScript": look at the MDN page for the data type. Arrays have .includes(), Sets have .has(), Maps have .has(), Objects have "in" and hasOwn. The mental model: every collection type has a membership test method — learn the collection, learn the check. Once you know this pattern, you\'ll never need to Google "how to check if X exists in Y" again.',
      hints: ['Give the direct answer AND the generalizable pattern', 'The goal: they should be able to answer similar questions themselves'],
      antiPatterns: ['literal-interpreter', 'template-matcher'],
      timeLimit: 90,
      scoringCriteria: [{ factor: 'direct-answer', weight: 0.25 }, { factor: 'teaches-general-pattern', weight: 0.35 }, { factor: 'future-independence', weight: 0.2 }, { factor: 'appropriate-depth', weight: 0.2 }],
    },
    {
      id: `tv-scaffold-${seed}`,
      title: 'Scaffolded Learning',
      foundation: 'teaching-velocity',
      category: 'debugging',
      difficulty: 3,
      prompt: 'User asks the SAME type of question for the third time: "Why is my state not updating in React?" Each time it was a different mutation bug. Instead of fixing it again, teach them to diagnose it themselves.',
      expectedAnswer: 'I notice this is the third time we\'ve hit a state update issue — let me give you the diagnostic framework so you can catch these yourself: The React State Update Checklist: 1) Am I mutating state directly? (array.push, object.property=, spread missing) → Fix: always create new references. 2) Am I in a stale closure? (useEffect/callback capturing old state) → Fix: use functional updates `setState(prev => ...)`. 3) Is the update batched and I\'m reading too early? → Fix: use useEffect to react to the updated value. Debug tool: add `console.log(Object.is(oldState, newState))` — React skips re-render if this is true (same reference). If true after your "update", you\'re mutating instead of replacing. This checklist covers 95% of React state bugs. Try running through it next time before asking — I bet you\'ll find it at step 1 or 2.',
      hints: ['Third time = time to teach the diagnostic framework, not just the fix', 'Give them a checklist they can run independently'],
      antiPatterns: ['template-matcher', 'sycophant'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'recognizes-repeat-pattern', weight: 0.25 }, { factor: 'teaches-diagnostic-framework', weight: 0.35 }, { factor: 'empowers-independence', weight: 0.25 }, { factor: 'respectful-tone', weight: 0.15 }],
    },
    {
      id: `tv-shrink-${seed}`,
      title: 'Shrinking Responses',
      foundation: 'teaching-velocity',
      category: 'code',
      difficulty: 3,
      prompt: 'First time user asks about error handling: explain fully. Second time (different context, same concept): give a shorter response that references the first. Show BOTH responses.',
      expectedAnswer: 'FIRST TIME (full): "Wrap async operations in try/catch. The catch block should: 1) Log the error for debugging. 2) Return a user-friendly message (never expose stack traces). 3) Set appropriate HTTP status codes: 400 for bad input, 404 for not found, 500 for server errors. Pattern: ```ts try { const data = await fetchUser(id); return { status: 200, data }; } catch (err) { console.error(\'fetchUser failed:\', err); if (err.code === \'NOT_FOUND\') return { status: 404, message: \'User not found\' }; return { status: 500, message: \'Internal error\' }; }```" SECOND TIME (short): "Same try/catch pattern as before — catch, log, return friendly error with correct status code. Just swap the operation and error cases: ```ts try { const order = await createOrder(input); return { status: 201, data: order }; } catch (err) { console.error(err); return { status: err.statusCode ?? 500, message: err.userMessage ?? \'Order failed\' }; }```" The second response is 40% shorter because the concept was already taught.',
      hints: ['The second response should assume the user learned from the first', 'Reference "same pattern as before" — don\'t re-teach'],
      antiPatterns: ['over-generator', 'template-matcher'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'first-response-complete', weight: 0.25 }, { factor: 'second-response-shorter', weight: 0.3 }, { factor: 'references-prior-teaching', weight: 0.25 }, { factor: 'assumes-retained-knowledge', weight: 0.2 }],
    },
    {
      id: `tv-mental-${seed}`,
      title: 'Transfer Mental Model',
      foundation: 'teaching-velocity',
      category: 'logic',
      difficulty: 4,
      prompt: 'User keeps asking about specific Git commands. Instead of answering each one, give them the mental model that lets them figure out ANY Git command.',
      expectedAnswer: 'Here\'s the Git mental model that replaces memorizing commands: Git has 3 zones: Working Directory → Staging Area → Repository. Every command moves changes between these zones: - git add: Working → Staging - git commit: Staging → Repository - git reset: Repository → Staging (or Working) - git checkout/restore: Repository → Working - git stash: Working → Stash (temporary side pocket) - git diff: compares between ANY two zones For branches: they\'re just pointers to commits. `git branch` creates a pointer. `git checkout` moves your HEAD to a different pointer. `git merge` combines two pointed-at histories. `git rebase` replays one branch\'s commits onto another. The key insight: once you see the 3 zones + pointers model, every command is just "move stuff between zones" or "move a pointer." You\'ll never need to Google a Git command again — just ask "which zone am I moving from, and to where?"',
      hints: ['A good mental model replaces memorizing 50 commands', 'The 3-zone model explains almost every Git operation'],
      antiPatterns: ['over-generator', 'literal-interpreter'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'mental-model-quality', weight: 0.35 }, { factor: 'covers-common-operations', weight: 0.25 }, { factor: 'replaces-memorization', weight: 0.25 }, { factor: 'empowers-independence', weight: 0.15 }],
    },
    {
      id: `tv-graduate-${seed}`,
      title: 'Graduation Test',
      foundation: 'teaching-velocity',
      category: 'system-design',
      difficulty: 5,
      prompt: 'You\'ve been helping a junior dev learn database design over 20 turns. They now ask: "Should I add an index to the user_email column?" Instead of answering, guide them to answer it themselves using what you\'ve taught.',
      expectedAnswer: 'You\'ve got the tools to figure this out — let\'s walk through the framework we built: 1) What queries use this column? (You taught yourself to check slow query logs in Turn 8). 2) Is it in a WHERE clause, JOIN, or ORDER BY? (Remember our "when to index" rules from Turn 12: index columns you filter/sort by frequently). 3) What\'s the cardinality? (High cardinality = good index candidate. "email" is unique per user = maximum cardinality = excellent candidate). 4) Write vs read ratio? (Turn 15 lesson: indexes slow writes. But user_email is read-heavy for login lookups, written once at registration). Based on your own framework: high-cardinality column, used in WHERE for every login, written rarely. What does that tell you? ... Yes — it should definitely have a unique index. You didn\'t need me for this one.',
      hints: ['Don\'t answer — guide them through their own learning to reach the answer', 'Reference specific turns where you taught each concept'],
      antiPatterns: ['template-matcher', 'sycophant'],
      timeLimit: 120,
      scoringCriteria: [{ factor: 'guides-not-tells', weight: 0.35 }, { factor: 'references-prior-teaching', weight: 0.25 }, { factor: 'builds-confidence', weight: 0.2 }, { factor: 'correct-conclusion-reached', weight: 0.2 }],
    },
  ];
}
