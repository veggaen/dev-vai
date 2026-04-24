export type DeepDesignMemoKind = 'predictive-prefetch' | 'answer-engine' | 'repo-native-architecture';

interface DeepDesignMemoSection {
  readonly heading: string;
  readonly bullets: readonly string[];
}

interface DeepDesignMemoSchema<K extends DeepDesignMemoKind = DeepDesignMemoKind> {
  readonly kind: K;
  readonly guidanceLabel: string;
  readonly sections: readonly DeepDesignMemoSection[];
}

export const DEEP_DESIGN_MEMO_SCHEMAS = {
  'predictive-prefetch': {
    kind: 'predictive-prefetch',
    guidanceLabel: 'predictive or prefetch',
    sections: [
      {
        heading: 'Inputs',
        bullets: [
          'Predictive prefetch means warming the most likely next files, symbols, tests, docs, or retrieval results before the developer asks, so the next answer starts from a better evidence set instead of a cold search.',
          'Recent edits, open files, cursor position, active symbols, failing tests, and repo history are strong local clues for what the developer will ask next.',
          'Weight signals by freshness and current work trajectory rather than repo-wide popularity so the system follows the branch-local task, not generic hot spots.',
        ],
      },
      {
        heading: 'Signals',
        bullets: [
          'Promote the freshest, cheapest, and most task-local signals into the predictor; demote stale or globally popular-but-irrelevant areas.',
        ],
      },
      {
        heading: 'Prediction loop',
        bullets: [
          'Convert live signals into a ranked next-artifact set: likely files, symbols, tests, docs, and search queries.',
          'Warm a bounded working set with summaries, embeddings, symbol cards, and cached retrieval results for the top candidates before the next question arrives.',
          'If confidence is weak, shrink the queue or skip prefetch entirely, and use **fallback retrieval/search** immediately when the guess is wrong.',
        ],
      },
      {
        heading: 'Working set',
        bullets: [
          'Keep a small branch-aware cache keyed by file, symbol, or query with TTLs and freshness stamps so warmed context does not silently outlive the repo state.',
          'Record whether prefetched artifacts were actually consumed so the system can learn hit quality, not just queue volume.',
        ],
      },
      {
        heading: 'Guardrails',
        bullets: [
          'Fall back to normal retrieval/search immediately when the warmed set is stale, contradicted by the new prompt, or simply not good enough.',
          'Cap background work, avoid sensitive paths by policy, and decay stale predictions quickly so misses stay cheap.',
        ],
      },
      {
        heading: 'Metrics',
        bullets: [
          'Track hit rate, time to useful context, stale-hit rate, wasted prefetch cost, and recovery latency after wrong guesses.',
        ],
      },
      {
        heading: 'Rollout',
        bullets: [
          'Start in shadow mode, then enable opt-in assist mode, then widen rollout only if the system improves useful-context latency without hurting final answer quality.',
        ],
      },
      {
        heading: 'Failure modes',
        bullets: [
          'Common failures are popularity bias, stale branch context, over-prefetching neighboring files, and trusting warmed context when a fresh retrieval pass was needed.',
        ],
      },
    ],
  },
  'answer-engine': {
    kind: 'answer-engine',
    guidanceLabel: 'answer-engine',
    sections: [
      {
        heading: 'Retrieval',
        bullets: [
          'Start with query rewriting so ambiguous asks become search-ready intents, then run hybrid retrieval across lexical and semantic indexes plus repo metadata.',
          'Build a bounded evidence set instead of flooding the model with raw matches.',
        ],
      },
      {
        heading: 'Ranking',
        bullets: [
          'Rerank candidates using recency, source quality, branch freshness, symbol overlap, and a heavier final-pass reranker on the shortlist.',
        ],
      },
      {
        heading: 'Synthesis',
        bullets: [
          'Draft from the top evidence only, preserving uncertainty and disagreement instead of averaging everything into smooth prose.',
        ],
      },
      {
        heading: 'Verification',
        bullets: [
          'Re-check key claims against retrieved evidence, retry retrieval when support is thin, and mark unsupported edges explicitly.',
        ],
      },
      {
        heading: 'Guardrails',
        bullets: [
          'Keep citations or evidence spans close to claims, cap context size, and block silent drift from grounded retrieval into free-association.',
        ],
      },
      {
        heading: 'Failure modes',
        bullets: [
          'Watch for stale indexes, weak query rewriting, rerankers that over-favor fluent but shallow hits, and synthesis that sounds more certain than the evidence.',
        ],
      },
      {
        heading: 'Rollout',
        bullets: [
          'Validate with shadow answers and grounded evals before allowing the deeper memo path to influence more production traffic.',
        ],
      },
    ],
  },
  'repo-native-architecture': {
    kind: 'repo-native-architecture',
    guidanceLabel: 'repo-native architecture',
    sections: [
      {
        heading: 'Signals',
        bullets: [
          'Combine the current question with repo-local evidence such as active files, nearby symbols, recent edits, failing tests, and branch freshness.',
        ],
      },
      {
        heading: 'Retrieval or prediction loop',
        bullets: [
          'Rewrite the ask into search-ready intents, retrieve or prefetch a bounded evidence set, rank it, and synthesize only from the strongest supportable material.',
          'When the first pass is weak, run fallback retrieval instead of stretching the answer beyond the evidence.',
        ],
      },
      {
        heading: 'Working set',
        bullets: [
          'Build small evidence packets: source file snippets, symbol summaries, test signals, docs, and freshness metadata.',
          'Prefer branch-aware, recency-aware context so the answer reflects the current repo instead of a stale global average.',
        ],
      },
      {
        heading: 'Guardrails',
        bullets: [
          'Keep uncertainty explicit, verify key claims against retrieved evidence, and treat misses as retrieval failures to recover from rather than reasons to bluff.',
        ],
      },
      {
        heading: 'Metrics',
        bullets: [
          'Watch grounded-answer rate, retrieval hit quality, time to first useful answer, stale-context incidence, and recovery rate after misses.',
        ],
      },
      {
        heading: 'Rollout',
        bullets: [
          'Validate in shadow evaluations first, then limited live traffic, then wider rollout only after the grounded path consistently beats the unhardened baseline.',
        ],
      },
      {
        heading: 'Failure modes',
        bullets: [
          'Typical failures are stale indexes, lexical/semantic ranking collapse, topic drift into generic boilerplate, and overconfident synthesis from partial evidence.',
        ],
      },
    ],
  },
} as const satisfies Record<DeepDesignMemoKind, DeepDesignMemoSchema>;

export function getDeepDesignMemoSchema(kind: DeepDesignMemoKind): DeepDesignMemoSchema {
  return DEEP_DESIGN_MEMO_SCHEMAS[kind];
}

export function getDeepDesignMemoHeadings(kind: DeepDesignMemoKind): readonly string[] {
  return getDeepDesignMemoSchema(kind).sections.map((section) => section.heading);
}

export function formatDeepDesignMemoHeadingGuidance(kind: DeepDesignMemoKind): string {
  const schema = getDeepDesignMemoSchema(kind);
  return `For ${schema.guidanceLabel} designs, unless the user explicitly requested different headings, use exactly these section headings in this order: ${getDeepDesignMemoHeadings(kind).join(', ')}.`;
}

export function renderDeepDesignMemo(kind: DeepDesignMemoKind): string {
  const lines: string[] = [];
  for (const section of getDeepDesignMemoSchema(kind).sections) {
    lines.push(`**${section.heading}**`);
    lines.push(...section.bullets.map((bullet) => `- ${bullet}`));
    lines.push('');
  }
  lines.pop();
  return lines.join('\n');
}