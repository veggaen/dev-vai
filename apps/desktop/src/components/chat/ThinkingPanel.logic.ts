import type { TurnThinkingUI } from '../../stores/chatStore.js';

/** View model for the Thinking panel — pure, derived from a turn's trace. */
export interface ThinkingPanelModel {
  readonly intent: string;
  readonly intentLabel: string;
  readonly strategy: string;
  readonly steps: readonly { readonly label: string; readonly raw: string }[];
  readonly trustBadge?: string;
  readonly trustLabel?: string;
  readonly confidencePct?: number;
  readonly topic?: string;
  readonly knowledgeDepth?: string;
  readonly durationMs?: number;
  /** Compact one-line header summary. */
  readonly headerLabel: string;
  /** Detected intent disagrees with the answering strategy → likely misroute. */
  readonly misrouteSuspected: boolean;
  readonly misrouteHint?: string;
  /** Misroutes start expanded; clean turns start collapsed (VS Code style). */
  readonly defaultExpanded: boolean;
}

const INTENT_LABELS: Record<string, string> = {
  'action-yesno': 'Yes/No',
  definition: 'Definition',
  'factual-lookup': 'Fact lookup',
  build: 'Build',
  meta: 'Conversation',
  other: 'Open-ended',
};

const TRUST_LABELS: Record<string, string> = {
  'local-curated': 'Local knowledge',
  'official-docs': 'Official docs',
  'web-mixed': 'Mixed web',
  'web-untrusted': 'Untrusted web',
  fallback: 'No grounded answer',
  computed: 'Computed',
};

// Strategy families used only to flag intent/strategy mismatches.
const DEFINITIONAL_STRATEGY = /\b(?:brand|definition|company|person|country|acronym|canonical|extended[- ]?fact|topic[- ]?lookup|disambiguat)\b/i;
const BUILD_STRATEGY = /\b(?:build|creative[- ]?code|scaffold|builder|compose)\b/i;

function humanizeStrategy(raw: string): string {
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Conservative misroute detector: only the clearest disagreements, to avoid
 * crying wolf. An action yes/no answered by a definition handler, or a
 * fact/definition answered by a build handler, are the misroute classes the
 * intent gate targets.
 */
function detectMisroute(intent: string, strategy: string): string | null {
  const s = strategy || '';
  if (intent === 'action-yesno' && DEFINITIONAL_STRATEGY.test(s)) {
    return 'Asked a yes/no question but answered with a definition.';
  }
  if ((intent === 'definition' || intent === 'factual-lookup') && BUILD_STRATEGY.test(s)) {
    return 'Asked a factual question but routed to the builder.';
  }
  return null;
}

export function buildThinkingPanelModel(thinking: TurnThinkingUI): ThinkingPanelModel {
  const intent = thinking.intent || 'other';
  const intentLabel = INTENT_LABELS[intent] ?? humanizeStrategy(intent);
  const strategy = thinking.strategy || '';
  const chain = thinking.strategyChain && thinking.strategyChain.length > 0
    ? thinking.strategyChain
    : strategy.split(/\s*->\s*/).filter(Boolean);
  const steps = chain.map((raw) => ({ raw, label: humanizeStrategy(raw) }));

  const confidencePct = typeof thinking.confidence === 'number'
    ? Math.round(Math.max(0, Math.min(1, thinking.confidence)) * 100)
    : undefined;

  const misrouteHint = detectMisroute(intent, strategy) ?? undefined;
  const misrouteSuspected = Boolean(misrouteHint);

  const stepWord = steps.length === 1 ? 'step' : 'steps';
  const headerLabel = `${intentLabel} · ${steps.length} ${stepWord}`
    + (confidencePct !== undefined ? ` · ${confidencePct}%` : '');

  return {
    intent,
    intentLabel,
    strategy,
    steps,
    trustBadge: thinking.trustBadge,
    trustLabel: thinking.trustBadge ? (TRUST_LABELS[thinking.trustBadge] ?? thinking.trustBadge) : undefined,
    confidencePct,
    topic: thinking.topic && thinking.topic.trim() ? thinking.topic : undefined,
    knowledgeDepth: thinking.knowledgeDepth,
    durationMs: thinking.durationMs,
    headerLabel,
    misrouteSuspected,
    misrouteHint,
    defaultExpanded: misrouteSuspected,
  };
}
