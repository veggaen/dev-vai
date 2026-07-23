import {
  contextBudgetReceiptSchema,
  type ContextBudgetReceipt,
} from '@vai/contracts/adoption';

export interface ContextCandidate {
  readonly id: string;
  readonly tier: 0 | 1 | 2 | 3 | 4;
  readonly kind: ContextBudgetReceipt['included'][number]['kind'];
  readonly content: string;
  readonly reason: string;
  readonly priority?: number;
}

export interface BudgetedContext {
  readonly items: readonly ContextCandidate[];
  readonly receipt: ContextBudgetReceipt;
}

export function estimateContextTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

/** Tier-first deterministic context injection with an auditable inclusion receipt. */
export function budgetContext(input: {
  readonly modelId: string;
  readonly contextWindow: number;
  readonly reservedTokens: number;
  readonly candidates: readonly ContextCandidate[];
}): BudgetedContext {
  const available = Math.max(0, input.contextWindow - input.reservedTokens);
  const ordered = [...input.candidates].sort((left, right) =>
    left.tier - right.tier || (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id));
  const items: ContextCandidate[] = [];
  const included: ContextBudgetReceipt['included'] = [];
  const excluded: ContextBudgetReceipt['excluded'] = [];
  let used = 0;
  for (const candidate of ordered) {
    const estimatedTokens = estimateContextTokens(candidate.content);
    if (used + estimatedTokens <= available) {
      items.push(candidate);
      included.push({
        id: candidate.id, tier: candidate.tier, kind: candidate.kind,
        estimatedTokens, reason: candidate.reason,
      });
      used += estimatedTokens;
    } else {
      excluded.push({ id: candidate.id, reason: `budget exceeded at ${used}/${available} tokens` });
    }
  }
  return {
    items,
    receipt: contextBudgetReceiptSchema.parse({
      modelId: input.modelId,
      contextWindow: input.contextWindow,
      reservedTokens: input.reservedTokens,
      included,
      excluded,
      totalEstimatedTokens: used,
    }),
  };
}
