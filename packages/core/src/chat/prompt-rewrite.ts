import type { ChatPromptRewriteConfig } from '../config/types.js';
import { formatDeepDesignMemoHeadingGuidance, type DeepDesignMemoKind } from './deep-design-memo-schemas.js';
import { isConversationMode, type ConversationMode } from './modes.js';

export interface ChatPromptRewriteResult {
  readonly applied: boolean;
  readonly matchedRules: readonly string[];
  readonly systemMessage?: string;
}

const DEFAULT_MODES: readonly ConversationMode[] = ['chat', 'agent', 'builder', 'plan', 'debate'];
const FRONTEND_CONTEXT_PATTERN = /\b(react context|createcontext|usecontext|provider|prop drilling|react query|usequery|usemutation|zustand|redux)\b/i;
const REPO_CONTEXT_PATTERN = /\b(context engine|repo-native|repository-native|monorepo|repo history|git history|recent edits|open files|cursor position|predictive context|warmed context|prefetch queue|answer engine)\b/i;
const PREDICTIVE_PATTERN = /\b(predictive|prefetch|proactively load|load ahead|warm(?:ed|ing|s)? context|before the next question|next question)\b/i;
const ANSWER_ENGINE_PATTERN = /\b(answer engine|context engine|retrieval engine|layered answer)\b/i;
const ARCHITECTURE_PATTERN = /\b(architecture|design|system|engine|workflow|pipeline|guardrails|rollout|signals|metric)\b/i;
const CONTEXT_ENGINE_PATTERN = /\bcontext engine\b/i;
const ANSWER_ENGINE_DEEP_MEMO_PATTERN = /\b(answer engine|retrieval engine|layered answer)\b/i;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function selectDeepDesignMemoKind(userContent: string): DeepDesignMemoKind | null {
  if (PREDICTIVE_PATTERN.test(userContent)) return 'predictive-prefetch';
  if (CONTEXT_ENGINE_PATTERN.test(userContent)) return 'repo-native-architecture';
  if (ANSWER_ENGINE_DEEP_MEMO_PATTERN.test(userContent)) return 'answer-engine';
  if (ARCHITECTURE_PATTERN.test(userContent)) return 'repo-native-architecture';
  return null;
}

export function resolveChatPromptRewriteConfig(
  config?: Partial<ChatPromptRewriteConfig>,
): ChatPromptRewriteConfig {
  const applyToModes = (config?.applyToModes ?? DEFAULT_MODES).filter(isConversationMode);
  return {
    enabled: config?.enabled ?? true,
    strategy: 'system-message',
    profile: config?.profile ?? 'standard',
    responseDepth: config?.responseDepth ?? 'standard',
    applyToModes: applyToModes.length > 0 ? applyToModes : [...DEFAULT_MODES],
    maxUserMessageChars: Math.max(200, config?.maxUserMessageChars ?? 2_200),
    rules: {
      disambiguateRepoContext: config?.rules?.disambiguateRepoContext ?? true,
      groundPredictivePrefetch: config?.rules?.groundPredictivePrefetch ?? true,
      groundAnswerEngine: config?.rules?.groundAnswerEngine ?? true,
      hardenArchitectureSketches: config?.rules?.hardenArchitectureSketches ?? true,
    },
  };
}

export function rewriteChatPrompt(input: {
  readonly userContent: string;
  readonly mode: ConversationMode;
  readonly config?: Partial<ChatPromptRewriteConfig>;
}): ChatPromptRewriteResult {
  const config = resolveChatPromptRewriteConfig(input.config);
  const userContent = input.userContent.trim();
  const deepMemoKind = selectDeepDesignMemoKind(userContent);

  if (!config.enabled || !config.applyToModes.includes(input.mode) || !userContent) {
    return { applied: false, matchedRules: [] };
  }

  if (userContent.length > config.maxUserMessageChars || FRONTEND_CONTEXT_PATTERN.test(userContent)) {
    return { applied: false, matchedRules: [] };
  }

  const matchedRules: string[] = [];
  const guidance: string[] = [
    `Hardening profile: ${config.profile}.`,
    `Requested response depth: ${config.responseDepth}.`,
    'Treat this as a repository-native engineering question for a code assistant, not as a frontend state-management question.',
  ];

  if (config.rules.disambiguateRepoContext && REPO_CONTEXT_PATTERN.test(userContent)) {
    matchedRules.push('repo-context');
    guidance.push('Here, “context” means repository files, symbols, tests, docs, recent edits, cursor-near code, and repo history — not React Context or provider trees.');
    guidance.push('Do not drift into React Context, useContext, React Query, Zustand, Redux, or generic UI cache/state advice unless the user explicitly asks for frontend patterns.');
  }

  if (config.rules.groundPredictivePrefetch && PREDICTIVE_PATTERN.test(userContent)) {
    matchedRules.push('predictive-prefetch');
    guidance.push('Explain predictive prefetch as proactively warming likely files, tests, docs, symbols, or search results using signals like recent edits, open files, cursor position, and repo history.');
    guidance.push('Include what happens when the prediction is wrong: fallback retrieval/search, bounded prefetch queues, and ways to limit wasted work.');
  }

  if (config.rules.groundAnswerEngine && ANSWER_ENGINE_PATTERN.test(userContent)) {
    matchedRules.push('answer-engine');
    guidance.push('Describe answer engines in terms of indexing, retrieval, ranking, caching, citations, and grounded synthesis instead of generic search boilerplate or command tutorials.');
  }

  if (config.rules.hardenArchitectureSketches && matchedRules.length > 0 && ARCHITECTURE_PATTERN.test(userContent)) {
    matchedRules.push('architecture-sketch');
    guidance.push('Give a concrete system sketch: inputs/signals, retrieval or prediction loop, guardrails, metrics, and rollout steps. Preserve any headings or constraints the user already asked for.');
  }

  if (config.profile === 'strict' && matchedRules.length > 0) {
    guidance.push('Prefer bounded engineering language over slogans: name the working set, freshness or verification checks, explicit failure modes, and operator-visible rollout constraints.');
    guidance.push('If exact internals are unknown, present a supportable design sketch and state uncertainty instead of bluffing.');
  }

  if (config.responseDepth === 'deep-design-memo' && matchedRules.length > 0 && deepMemoKind) {
    matchedRules.push('deep-design-memo');
    guidance.push('Respond with a deeper design memo: cover architecture or working set shape, retrieval/prediction loop, failure modes, metrics, rollout stages, and operator guardrails.');
    guidance.push('Use a rigid sectioned memo with explicit headings and no preamble.');
    guidance.push('Do not add an executive summary, Idea, Overview, or any extra heading before or between the required sections.');
    guidance.push('If the user explicitly requested headings, preserve those headings and their order exactly.');
    guidance.push(formatDeepDesignMemoHeadingGuidance(deepMemoKind));
  }

  if (matchedRules.length === 0) {
    return { applied: false, matchedRules: [] };
  }

  return {
    applied: true,
    matchedRules: unique(matchedRules),
    systemMessage: ['Prompt hardening for ambiguous repo-native questions:', ...guidance.map((line) => `- ${line}`)].join('\n'),
  };
}