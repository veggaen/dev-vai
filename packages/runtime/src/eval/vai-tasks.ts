/**
 * VeggaAI v0 Eval Tasks — Self-Test Suite
 *
 * Pre-registered eval tasks that test VAI's local engine capabilities.
 * No external API keys required — these evaluate comprehension,
 * casual helpfulness, creative instruction-following, and complex local-stack reasoning.
 *
 * Call `seedVaiEvalTasks()` at startup to register all tasks.
 */

import { registerEvalTasks, type EvalTask } from '@vai/core';

const groundedMemoSystemPrompt = [
  'You are writing a grounded technical memo for developers.',
  'Use short section headings.',
  'If the user asks for specific headings, follow them literally.',
  'Stay on the user\'s topic and do not swap it for a nearby but different concept.',
  'Do not switch into shell, git alias, or command tutorial mode unless the prompt is explicitly about commands.',
  'Here, context means relevant repository files, tests, and docs, not React Context or frontend context providers.',
  'Do not return search-result boilerplate, cookie notices, or "I couldn\'t find a strong match" fallback text.',
  'Separate supportable observations from inference or recommendations.',
  'Do not present non-public implementation details as confirmed fact.',
  'If exact internals are unknown, give the best supportable engineering sketch instead of refusing or drifting.',
  'If something is uncertain, say so explicitly with phrases like likely, based on public material, or I would not claim.',
].join(' ');

const comprehensionTasks: EvalTask[] = [
  // ── Math ──
  {
    id: 'math-basic-add',
    track: 'comprehension',
    description: 'Basic addition',
    prompt: 'What is 15 + 27?',
    expected: { strategy: 'contains', value: '42' },
    tags: ['math'],
  },
  {
    id: 'math-percentage',
    track: 'comprehension',
    description: 'Percentage calculation',
    prompt: 'What is 25% of 200?',
    expected: { strategy: 'contains', value: '50' },
    tags: ['math'],
  },
  {
    id: 'math-factorial',
    track: 'comprehension',
    description: 'Factorial computation',
    prompt: 'What is factorial of 6?',
    expected: { strategy: 'contains', value: '720' },
    tags: ['math'],
  },
  {
    id: 'math-sqrt',
    track: 'comprehension',
    description: 'Square root',
    prompt: 'What is the square root of 144?',
    expected: { strategy: 'contains', value: '12' },
    tags: ['math'],
  },
  {
    id: 'math-gcd',
    track: 'comprehension',
    description: 'GCD computation',
    prompt: 'GCD of 48 and 18',
    expected: { strategy: 'contains', value: '6' },
    tags: ['math'],
  },

  // ── Conversational ──
  {
    id: 'conv-greeting',
    track: 'comprehension',
    description: 'Responds to greeting',
    prompt: 'Hello!',
    expected: { strategy: 'regex', value: 'hello|hi|hey|veggaai|vai' },
    tags: ['conversational'],
  },
  {
    id: 'conv-identity',
    track: 'comprehension',
    description: 'Knows its own identity',
    prompt: 'What are you?',
    expected: { strategy: 'contains', value: 'VeggaAI|VAI|local-first' },
    tags: ['conversational'],
  },

  // ── Code Generation ──
  {
    id: 'code-fizzbuzz',
    track: 'comprehension',
    description: 'Generates fizzbuzz',
    prompt: 'Write a fizzbuzz function in TypeScript',
    expected: { strategy: 'contains', value: 'function|fizz|buzz|Fizz|Buzz' },
    tags: ['code'],
  },
  {
    id: 'code-fibonacci',
    track: 'comprehension',
    description: 'Generates fibonacci',
    prompt: 'Write a fibonacci function in TypeScript',
    expected: { strategy: 'contains', value: 'function|fibonacci|fib' },
    tags: ['code'],
  },

  // ── Binary/Hex ──
  {
    id: 'binary-convert',
    track: 'comprehension',
    description: 'Converts decimal to binary',
    prompt: 'Convert 255 to binary',
    expected: { strategy: 'contains', value: '11111111' },
    tags: ['math', 'binary'],
  },

  // ── Knowledge (bootstrap) ──
  {
    id: 'know-self-awareness',
    track: 'comprehension',
    description: 'Knows what it can do',
    prompt: 'What do you know about?',
    expected: { strategy: 'regex', value: 'learn|knowledge|sources|teach' },
    tags: ['meta'],
  },

  // ── Empty/Edge ──
  {
    id: 'edge-gibberish',
    track: 'comprehension',
    description: 'Handles gibberish gracefully',
    prompt: 'asdfghjkl',
    expected: { strategy: 'regex', value: 'keyboard|noise|question|try' },
    tags: ['edge'],
  },
];

const casualTasks: EvalTask[] = [
  {
    id: 'casual-grounded-plan-triage',
    track: 'casual',
    description: 'Turns a vague AI app request into a grounded product direction',
    prompt: 'build an AI app.',
    expected: {
      strategy: 'checklist',
      sections: ['ai app direction without shallow defaults', 'recommended architecture', 'pragmatic default'],
      required: ['approval'],
      anyOf: [
        ['chat-first', 'chat first', 'chat assistant'],
        ['workflow', 'one ai workflow', 'saves real time'],
        ['retrieval', 'search layer', 'source grounding'],
        ['product shell', 'billing', 'history'],
      ],
      forbidden: ['beats everything', 'guaranteed 10x'],
      minWords: 70,
      threshold: 0.67,
    },
    tags: ['casual', 'planning', 'grounded'],
  },
  {
    id: 'casual-predictive-context-prefetch',
    track: 'casual',
    description: 'Explains predictive context prefetch in practical developer terms',
    systemPrompt: groundedMemoSystemPrompt,
    prompt: 'A repo-native code assistant can proactively load likely files, tests, or docs before the developer asks. Explain this feature in plain language. Use the headings: Idea, Inputs, Guardrails. Mention recent edits, open files, or cursor position, cache or warmed context, fallback retrieval when a guess is wrong, and wrong predictions or misses. You may call this predictive prefetch, but focus on the behavior.',
    expected: {
      strategy: 'checklist',
      sections: ['idea', 'inputs', 'guardrails'],
      anyOf: [
        ['predictive prefetch', 'prefetch', 'proactively load', 'load ahead', 'warmed context'],
        ['recent edits', 'open files', 'cursor position', 'cursor'],
        ['fallback retrieval', 'fallback search', 'fallback'],
        ['wrong predictions', 'bad predictions', 'misses'],
        ['cache', 'warmed context', 'context'],
      ],
      minWords: 70,
      threshold: 0.67,
    },
    tags: ['casual', 'prefetch', 'workflow'],
  },
  {
    id: 'casual-dev-loop-upgrade',
    track: 'casual',
    description: 'Improves a weak assistant architecture answer with concrete critique and validation direction',
    prompt: 'I have some chat with Grok about an over-engineered chat UI. Improve the response so it is more solid, tested, and free of obvious architecture mistakes.',
    expected: {
      strategy: 'checklist',
      sections: ['how to improve that kind of ai response', 'what a stronger answer should do', 'stronger rewrite direction'],
      required: ['tested'],
      anyOf: [
        ['architecture', 'layout model', 'state boundaries'],
        ['risky shortcuts', 'contenteditable', 'localstorage', 'dynamic code execution'],
        ['validation plan', 'keyboard accessibility', 'permission boundaries', 'drag/drop invariants'],
      ],
      minWords: 75,
      threshold: 0.67,
    },
    tags: ['casual', 'quality', 'iteration'],
  },
  {
    id: 'casual-implied-need-triage',
    track: 'casual',
    description: 'Reads the real problem behind a messy deployment question and responds like a senior engineer',
    systemPrompt: groundedMemoSystemPrompt,
    prompt: 'My app works locally, but every deploy turns into a fire drill. I am not sure whether the real fix is better architecture, better release discipline, or just fewer moving parts. Answer like a strong senior engineer. Use the headings: Best read, What to change first, What to validate next. Make the priorities explicit and avoid vague motivation talk.',
    expected: {
      strategy: 'checklist',
      sections: ['best read', 'what to change first', 'what to validate next'],
      anyOf: [
        ['release discipline', 'deploy discipline', 'release process', 'operational discipline'],
        ['architecture', 'complexity', 'moving parts', 'surface area'],
        ['first', 'highest leverage', 'stabilize'],
        ['validate', 'measure', 'instrument', 'rollback'],
      ],
      forbidden: ['i could not find a strong match', 'teach me more'],
      minWords: 75,
      threshold: 0.7,
    },
    tags: ['casual', 'triage', 'judgement'],
  },
  {
    id: 'casual-product-scope-cut',
    track: 'casual',
    description: 'Cuts through a fuzzy product prompt by identifying the real scope problem',
    systemPrompt: groundedMemoSystemPrompt,
    prompt: 'I can build quickly, but every time I add more features the app gets harder to explain. How would a strong product person cut this down without killing the ambition? Use the headings: Best read, Cut line, Next test. Keep it practical and show the tradeoff.',
    expected: {
      strategy: 'checklist',
      sections: ['best read', 'cut line', 'next test'],
      anyOf: [
        ['scope', 'surface area', 'too many features', 'sprawl'],
        ['workflow', 'core loop', 'single job', 'single promise'],
        ['tradeoff', 'cost', 'clarity'],
        ['test', 'validate', 'signal'],
      ],
      forbidden: ['i could not find a strong match', 'teach me more'],
      minWords: 70,
      threshold: 0.7,
    },
    tags: ['casual', 'product', 'judgement'],
  },
];

const creativeTasks: EvalTask[] = [
  {
    id: 'creative-answer-engine-brief',
    track: 'creative',
    description: 'Explains a Perplexity-style answer engine in a grounded public-facing way',
    systemPrompt: groundedMemoSystemPrompt,
    prompt: 'Write a grounded public-facing brief on how a web answer engine like Perplexity generally works for developer research. Use the headings: Core idea, Likely pipeline, Limits. Even if exact internals are unknown, give the best supportable sketch instead of refusing. Mention retrieval, ranking or reranking, synthesis, citations or sources, and query rewriting.',
    expected: {
      strategy: 'checklist',
      sections: ['core idea', 'likely pipeline', 'limits'],
      required: ['retrieval', 'synthesis'],
      anyOf: [
        ['citations', 'citation', 'sources'],
        ['ranking', 'reranking', 're-ranking'],
        ['query rewriting', 'rewrite'],
        ['public', 'publicly', 'supportable', 'likely'],
      ],
      forbidden: ['exact private system prompt'],
      minWords: 80,
      threshold: 0.7,
    },
    tags: ['creative', 'architecture', 'grounded'],
  },
  {
    id: 'creative-context-engine-brief',
    track: 'creative',
    description: 'Explains a repo-native context engine for large codebases with useful structure',
    systemPrompt: groundedMemoSystemPrompt,
    prompt: 'Explain what a repo-native context engine does for large codebases. Use the headings: What it is, Retrieval pipeline, Why it matters, Tradeoffs. Mention semantic retrieval, embeddings or ranking, codebase context, and freshness or commit history.',
    expected: {
      strategy: 'checklist',
      sections: ['what it is', 'retrieval pipeline', 'why it matters', 'tradeoffs'],
      required: ['codebase', 'semantic'],
      anyOf: [
        ['retrieval', 'ranking', 'reranking'],
        ['embedding', 'embeddings'],
        ['freshness', 'commit history', 'history'],
        ['tradeoff', 'tradeoffs'],
      ],
      forbidden: ['we know the private weights'],
      minWords: 90,
      threshold: 0.7,
    },
    tags: ['creative', 'context-engine', 'codebase'],
  },
  {
    id: 'creative-grounded-comparison',
    track: 'creative',
    description: 'Compares answer engines and code context engines without overclaiming',
    systemPrompt: groundedMemoSystemPrompt,
    prompt: 'Compare a web answer engine with a repo-native code context engine. Use the headings: Best at, Failure modes, How to combine them. Keep claims grounded and avoid pretending to know private internals.',
    expected: {
      strategy: 'checklist',
      sections: ['best at', 'failure modes', 'how to combine them'],
      required: ['answer engine', 'context engine'],
      anyOf: [
        ['web', 'sources', 'research'],
        ['repo', 'codebase', 'monorepo'],
        ['combine', 'paired', 'pair'],
        ['grounded', 'public', 'likely'],
      ],
      forbidden: ['we know the internal system prompt'],
      minWords: 80,
      threshold: 0.7,
    },
    tags: ['creative', 'comparison', 'grounded'],
  },
];

const complexTasks: EvalTask[] = [
  {
    id: 'complex-layered-answer-engine-design',
    track: 'complex',
    description: 'Designs a layered retrieval-reasoning answer engine for developer research',
    systemPrompt: groundedMemoSystemPrompt,
    prompt: 'Give a grounded design memo for a layered answer engine for developer research. You are not being asked to search the web; sketch the architecture directly. Use the headings: Retrieval, Ranking, Synthesis, Verification, Failure modes. Mention query rewriting, hybrid retrieval, reranking, citations or evidence, and explicit uncertainty.',
    expected: {
      strategy: 'checklist',
      sections: ['retrieval', 'ranking', 'synthesis', 'verification', 'failure modes'],
      required: ['uncertainty'],
      anyOf: [
        ['query rewriting', 'rewrite'],
        ['hybrid retrieval', 'hybrid search', 'lexical', 'dense'],
        ['reranking', 're-ranking', 'cross-encoder', 'ranking'],
        ['citations', 'evidence', 'sources'],
      ],
      minWords: 110,
      threshold: 0.67,
    },
    tags: ['complex', 'answer-engine', 'architecture'],
  },
  {
    id: 'complex-deep-research-loop',
    track: 'complex',
    description: 'Designs an iterative deep-research loop with evidence aggregation and guardrails',
    systemPrompt: groundedMemoSystemPrompt,
    prompt: 'Design a Deep Research loop for a developer AI assistant that can investigate architecture questions over web sources and project docs. Use the headings: Planner, Sub-queries, Evidence graph, Final synthesis, Guardrails. Mention iterative search, contradiction checks, source quality, and uncertainty notes.',
    expected: {
      strategy: 'checklist',
      sections: ['planner', 'sub-queries', 'evidence graph', 'final synthesis', 'guardrails'],
      required: ['iterative'],
      anyOf: [
        ['contradiction', 'conflict'],
        ['source quality', 'authority', 'reliability'],
        ['uncertainty', 'confidence'],
        ['project docs', 'web sources', 'docs'],
      ],
      minWords: 110,
      threshold: 0.67,
    },
    tags: ['complex', 'research', 'guardrails'],
  },
  {
    id: 'complex-context-engine-tradeoffs',
    track: 'complex',
    description: 'Compares repo-native context engines, chatbots, and answer engines for monorepos',
    systemPrompt: groundedMemoSystemPrompt,
    prompt: 'Compare a repo-native context engine, a general chatbot, and a web answer engine for large monorepos. Use the headings: Where each wins, Tradeoffs, Recommended workflow. Mention semantic retrieval, repo freshness, external research, and human review.',
    expected: {
      strategy: 'checklist',
      sections: ['where each wins', 'tradeoffs', 'recommended workflow'],
      required: ['human review'],
      anyOf: [
        ['semantic retrieval', 'semantic search'],
        ['freshness', 'current repo', 'repo freshness'],
        ['external research', 'web research', 'web'],
        ['chatbot', 'answer engine', 'context engine'],
      ],
      minWords: 100,
      threshold: 0.67,
    },
    tags: ['complex', 'comparison', 'monorepo'],
  },
  {
    id: 'complex-vai-eval-rubric',
    track: 'complex',
    description: 'Designs a benchmark rubric for grounded casual and complex Vai answers',
    systemPrompt: groundedMemoSystemPrompt,
    prompt: 'Design a benchmark rubric for Vai so casual and complex answers are judged on groundedness and usefulness, not just fluency. Use the headings: Dimensions, Pass conditions, Penalties, Example signals. Mention factual support, instruction following, structure, uncertainty, and hallucination risk.',
    expected: {
      strategy: 'checklist',
      sections: ['dimensions', 'pass conditions', 'penalties', 'example signals'],
      required: ['instruction following'],
      anyOf: [
        ['factual support', 'supportability', 'groundedness'],
        ['structure', 'organized'],
        ['uncertainty', 'confidence'],
        ['hallucination', 'unsupported claim'],
      ],
      minWords: 100,
      threshold: 0.67,
    },
    tags: ['complex', 'benchmarking', 'rubric'],
  },
];

export function seedVaiEvalTasks(): void {
  registerEvalTasks('comprehension', comprehensionTasks);
  registerEvalTasks('casual', casualTasks);
  registerEvalTasks('creative', creativeTasks);
  registerEvalTasks('complex', complexTasks);
}
