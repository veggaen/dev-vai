/**
 * intent-detector.ts — Multi-strategy client-side intent detection for deploy requests.
 *
 * Strategy 1: Regex + Keyword Hybrid (production MVP, zero latency)
 *   - Verb detection, stack matching, tier matching, proximity scoring
 *   - Handles phrasing variations: "build PERN", "PERN stack pls", "deploy pacman app"
 *
 * Outputs numeric confidence (0–1) instead of binary high/medium.
 * Used by the adaptive tracker to decide UX recovery pattern.
 */

/* ────────────────────────────────────── Types ── */

export interface DeployIntent {
  stackId: string;
  tier: string;
  displayName: string;
  /** 0–1 numeric confidence */
  confidence: number;
  /** Which signals contributed */
  signals: IntentSignal[];
}

export interface IntentSignal {
  type: 'verb' | 'stack' | 'tier' | 'context' | 'proximity' | 'history';
  value: string;
  weight: number;
}

/** UX recovery pattern based on confidence band */
export type RecoveryPattern = 'silent' | 'nudge' | 'clarify' | 'none';

export function getRecoveryPattern(confidence: number): RecoveryPattern {
  if (confidence >= 0.8) return 'silent';
  if (confidence >= 0.6) return 'nudge';
  if (confidence >= 0.35) return 'clarify';
  return 'none';
}

/* ──────────────────────────────────── Stacks ── */

export interface StackDef {
  id: string;
  aliases: string[];
  label: string;
  description: string;
  /** Semantic keywords that could imply this stack without naming it */
  semanticHints: string[];
}

export const STACKS: StackDef[] = [
  {
    id: 'pern',
    aliases: ['pern', 'postgres', 'postgresql', 'pg'],
    label: 'PERN',
    description: 'Board task manager',
    semanticHints: ['task', 'board', 'kanban', 'todo', 'tasks', 'project board'],
  },
  {
    id: 'mern',
    aliases: ['mern', 'mongo', 'mongodb'],
    label: 'MERN',
    description: 'Bookmark manager',
    semanticHints: ['bookmark', 'bookmarks', 'links', 'save links', 'reading list'],
  },
  {
    id: 'nextjs',
    aliases: ['nextjs', 'next.js', 'next js', 'next'],
    label: 'Next.js',
    description: 'Notes dashboard',
    semanticHints: ['notes', 'note', 'dashboard', 'notebook', 'journal'],
  },
  {
    id: 't3',
    aliases: ['t3', 'trpc', 'tRPC', 't3 stack'],
    label: 'T3',
    description: 'Expense tracker',
    semanticHints: ['expense', 'expenses', 'budget', 'money', 'finance', 'spending'],
  },
  {
    id: 'game',
    aliases: ['game', 'game engine', 'canvas game', 'top-down', 'top down'],
    label: 'Game Engine',
    description: 'Top-down action game',
    semanticHints: [
      'game', 'shooter', 'action game', 'rpg', 'hotline miami', 'combat',
      'enemies', 'weapons', 'top-down', 'arcade', 'pixel', 'neon',
      'quest', 'achievement', 'lore', 'boss fight', 'level editor',
    ],
  },
];

/* ──────────────────────────────────── Tiers ── */

export type Tier = 'basic' | 'solid' | 'battle-tested' | 'vai';

export const TIER_ALIASES: Record<string, Tier> = {
  basic: 'basic',
  simple: 'basic',
  starter: 'basic',
  minimal: 'basic',
  quick: 'basic',
  solid: 'solid',
  standard: 'solid',
  moderate: 'solid',
  intermediate: 'solid',
  'battle-tested': 'battle-tested',
  'battle tested': 'battle-tested',
  battletested: 'battle-tested',
  production: 'battle-tested',
  advanced: 'battle-tested',
  robust: 'battle-tested',
  vai: 'vai',
  pro: 'vai',
  enterprise: 'vai',
  full: 'vai',
  premium: 'vai',
};

/* ──────────────────────────────── Verb Patterns ── */

/** Strong build/deploy verbs — high intent signal */
const STRONG_VERBS = /\b(build|create|scaffold|deploy|set\s*up|spin\s*up|bootstrap|launch)\b/i;

/** Weaker verbs that still suggest intent */
const WEAK_VERBS = /\b(start|make|generate|init|try|want|need|give\s*me|show\s*me|get\s*me)\b/i;

/** Request-framing patterns */
const REQUEST_FRAMES = /\b(can\s+you|could\s+you|please|i\s+want|i\s+need|i'd\s+like|let'?s)\b/i;

/** Stack-adjacent terms (user mentions stack-related concepts) */
const STACK_ADJACENT = /\b(app|application|project|template|stack|website|web\s*app|site|service|api)\b/i;

/* ──────────────────────────── Edit Intent ── */

/**
 * Edit intent — user wants to modify an existing project.
 * Detected when a sandbox project is already active.
 */
export interface EditIntent {
  /** Categorized edit type */
  type: 'fix' | 'add' | 'change' | 'remove' | 'refactor' | 'style' | 'generic';
  /** 0–1 confidence that this is a targeted project-edit request */
  confidence: number;
  /** Short description of what the user wants to change */
  summary: string;
}

const EDIT_STRONG = /\b(fix|change|update|upgrade|improve|modify|edit|rename|refactor|replace|rewrite|patch|correct|adjust|move|delete|remove)\b/i;
const EDIT_ADD = /\b(add|include|insert|append|implement|support|enable|integrate)\b/i;
const EDIT_STYLE = /\b(style|design|color|font|layout|size|margin|padding|spacing|theme|dark\s*mode|light\s*mode|responsive)\b/i;
const EDIT_BUG = /\b(bug|broken|error|crash|failing|doesn'?t\s+work|not\s+working|issue|problem|broke|wrong)\b/i;

/**
 * Detect if the user wants to edit an existing project.
 * Should be called when a sandbox project is already active.
 *
 * Returns null if the message looks like a brand-new project request
 * rather than an edit to the current one.
 */
export function detectEditIntent(
  userMessage: string,
  context: DetectionContext & { hasActiveProject?: boolean } = {},
): EditIntent | null {
  if (!context.hasActiveProject && !context.isBuildMode) return null;

  const lower = userMessage.toLowerCase();
  let score = 0;
  let type: EditIntent['type'] = 'generic';

  if (EDIT_STRONG.test(lower)) score += 0.45;
  if (EDIT_ADD.test(lower)) { score += 0.35; type = 'add'; }
  if (EDIT_STYLE.test(lower)) { score += 0.30; type = 'style'; }
  if (EDIT_BUG.test(lower)) { score += 0.40; type = 'fix'; }

  if (EDIT_STRONG.test(lower) && EDIT_BUG.test(lower)) type = 'fix';
  if (EDIT_ADD.test(lower) && !EDIT_BUG.test(lower)) type = 'add';
  if (/\b(refactor|clean\s*up|extract|split|consolidate)\b/i.test(lower)) { type = 'refactor'; score += 0.30; }
  if (/\b(upgrade|improve)\b/i.test(lower)) { type = 'change'; score += 0.30; }
  if (/\b(change|update|modify)\b/i.test(lower) && EDIT_STYLE.test(lower)) type = 'style';
  if (/\b(remove|delete|hide|disable)\b/i.test(lower)) { type = 'remove'; score += 0.35; }

  // Penalize if this looks more like a brand-new project request
  if (STRONG_VERBS.test(lower) && STACK_ADJACENT.test(lower) && !EDIT_BUG.test(lower)) {
    score -= 0.25;
  }

  if (context.isBuildMode) score += 0.10;
  if (context.hasActiveProject) score += 0.15;

  if (score < 0.35) return null;

  const summary = userMessage.replace(/\s+/g, ' ').trim().slice(0, 80);
  return { type, confidence: Math.min(score, 1), summary };
}

/* ──────────────────────────── Core Detection ── */

export interface DetectionContext {
  /** Previous user messages in this conversation (most recent first) */
  recentUserMessages?: string[];
  /** Historical deploy frequency (0–1, from adaptive tracker) */
  deployFrequency?: number;
  /** Whether conversation is in agent/builder mode */
  isBuildMode?: boolean;
}

/**
 * Detect deploy intent from a user message with numeric confidence scoring.
 *
 * Signal weights:
 *   Strong verb:    +0.25
 *   Weak verb:      +0.10
 *   Stack match:    +0.30 (direct alias) / +0.15 (semantic hint)
 *   Tier match:     +0.10
 *   Request frame:  +0.05
 *   Stack-adjacent: +0.05
 *   Proximity:      +0.05 (verb + stack within 5 words)
 *   Build mode:     +0.05
 *   Deploy freq:    +0.00–0.10 (scales with user history)
 *   Context repeat: +0.10 (same stack mentioned in recent msgs)
 */
export function detectDeployIntent(
  userMessage: string,
  context: DetectionContext = {},
): DeployIntent | null {
  const lower = userMessage.toLowerCase();
  const signals: IntentSignal[] = [];
  let score = 0;

  /* ── 1. Verb detection ── */
  const strongVerbMatch = STRONG_VERBS.exec(lower);
  const weakVerbMatch = WEAK_VERBS.exec(lower);

  if (strongVerbMatch) {
    signals.push({ type: 'verb', value: strongVerbMatch[0], weight: 0.25 });
    score += 0.25;
  } else if (weakVerbMatch) {
    signals.push({ type: 'verb', value: weakVerbMatch[0], weight: 0.10 });
    score += 0.10;
  }

  /* ── 2. Request framing ── */
  if (REQUEST_FRAMES.test(lower)) {
    signals.push({ type: 'context', value: 'request-frame', weight: 0.05 });
    score += 0.05;
  }

  /* ── 3. Stack-adjacent terms ── */
  if (STACK_ADJACENT.test(lower)) {
    signals.push({ type: 'context', value: 'stack-adjacent', weight: 0.05 });
    score += 0.05;
  }

  /* ── 4. Stack matching ── */
  let matchedStack: StackDef | null = null;
  let stackMatchType: 'alias' | 'semantic' = 'alias';

  // Direct alias match (highest confidence)
  for (const stack of STACKS) {
    for (const alias of stack.aliases) {
      // Use word boundary for short aliases to avoid false positives
      const pattern = alias.length <= 3
        ? new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i')
        : new RegExp(escapeRegex(alias), 'i');

      if (pattern.test(lower)) {
        matchedStack = stack;
        stackMatchType = 'alias';
        break;
      }
    }
    if (matchedStack) break;
  }

  // Semantic hint fallback (weaker signal)
  if (!matchedStack) {
    for (const stack of STACKS) {
      for (const hint of stack.semanticHints) {
        if (lower.includes(hint)) {
          matchedStack = stack;
          stackMatchType = 'semantic';
          break;
        }
      }
      if (matchedStack) break;
    }
  }

  if (matchedStack) {
    const stackWeight = stackMatchType === 'alias' ? 0.30 : 0.15;
    signals.push({ type: 'stack', value: `${matchedStack.id}:${stackMatchType}`, weight: stackWeight });
    score += stackWeight;
  }

  /* ── 5. Tier matching ── */
  let matchedTier: Tier = 'basic';
  for (const [alias, tier] of Object.entries(TIER_ALIASES)) {
    if (lower.includes(alias)) {
      matchedTier = tier;
      signals.push({ type: 'tier', value: tier, weight: 0.10 });
      score += 0.10;
      break;
    }
  }

  /* ── 6. Proximity bonus — verb + stack within 5 words ── */
  if ((strongVerbMatch || weakVerbMatch) && matchedStack) {
    const verbIdx = strongVerbMatch
      ? strongVerbMatch.index
      : weakVerbMatch!.index;

    // Find stack alias position
    const stackAlias = matchedStack.aliases.find((a) => lower.includes(a));
    if (stackAlias) {
      const stackIdx = lower.indexOf(stackAlias);
      const gap = lower.substring(
        Math.min(verbIdx, stackIdx),
        Math.max(verbIdx, stackIdx),
      );
      const wordsBetween = gap.trim().split(/\s+/).length;
      if (wordsBetween <= 5) {
        signals.push({ type: 'proximity', value: `${wordsBetween}w`, weight: 0.05 });
        score += 0.05;
      }
    }
  }

  /* ── 7. Build mode boost ── */
  if (context.isBuildMode) {
    signals.push({ type: 'context', value: 'build-mode', weight: 0.05 });
    score += 0.05;
  }

  /* ── 8. Deploy frequency boost ── */
  if (context.deployFrequency && context.deployFrequency > 0) {
    const freqBoost = Math.min(context.deployFrequency * 0.15, 0.10);
    signals.push({ type: 'history', value: `freq:${context.deployFrequency.toFixed(2)}`, weight: freqBoost });
    score += freqBoost;
  }

  /* ── 9. Context repeat — same stack mentioned recently ── */
  if (matchedStack && context.recentUserMessages) {
    const recentMentions = context.recentUserMessages.some((msg) => {
      const m = msg.toLowerCase();
      return matchedStack!.aliases.some((a) => m.includes(a));
    });
    if (recentMentions) {
      signals.push({ type: 'context', value: 'repeat-stack', weight: 0.10 });
      score += 0.10;
    }
  }

  /* ── Threshold gate ── */
  // Need at least a verb + something else, or a high enough score
  if (score < 0.30) return null;
  if (!matchedStack) return null;

  const displayName = `${matchedStack.label} ${capitalize(matchedTier)}`;

  return {
    stackId: matchedStack.id,
    tier: matchedTier,
    displayName,
    confidence: Math.min(score, 1),
    signals,
  };
}

/* ──────────────────── Multi-Stack Detection ── */

/**
 * Detect ALL possible stack intents from a message (for clarify picker).
 * Returns stacks sorted by confidence desc.
 */
export function detectAllIntents(
  userMessage: string,
  context: DetectionContext = {},
): DeployIntent[] {
  const lower = userMessage.toLowerCase();
  const results: DeployIntent[] = [];

  // Check if message has build intent at all
  const hasVerb = STRONG_VERBS.test(lower) || WEAK_VERBS.test(lower);
  const hasAdjacent = STACK_ADJACENT.test(lower);
  if (!hasVerb && !hasAdjacent) return results;

  for (const stack of STACKS) {
    // Check alias match
    const aliasMatch = stack.aliases.some((a) => {
      const pattern = a.length <= 3
        ? new RegExp(`\\b${escapeRegex(a)}\\b`, 'i')
        : new RegExp(escapeRegex(a), 'i');
      return pattern.test(lower);
    });

    // Check semantic match
    const semanticMatch = stack.semanticHints.some((h) => lower.includes(h));

    if (aliasMatch || semanticMatch) {
      const intent = detectDeployIntent(userMessage, context);
      if (intent && intent.stackId === stack.id) {
        results.push(intent);
      }
    }
  }

  // Generic build request — suggest top stacks with low confidence
  if (results.length === 0 && hasVerb && hasAdjacent) {
    for (const stack of STACKS) {
      results.push({
        stackId: stack.id,
        tier: 'basic',
        displayName: `${stack.label} Basic`,
        confidence: 0.2,
        signals: [{ type: 'context', value: 'generic-build', weight: 0.2 }],
      });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

/* ─────────────────────────── Token Checking ── */

/**
 * Check if an assistant's response already contains deploy markers.
 */
export function hasDeployTokens(content: string): boolean {
  return /\{\{deploy:\w+:[a-z-]+:[^}]+\}\}/.test(content);
}

/* ──────────────────────────────── Utilities ── */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
