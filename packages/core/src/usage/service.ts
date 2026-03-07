/**
 * VeggaAI Usage Tracking
 *
 * Records every LLM call: tokens in/out, cost, latency, model used.
 * Provides aggregation for monitoring spend and performance over time.
 *
 * Design:
 * - Write-optimized: every call inserts one row (no locks, no reads)
 * - Read-aggregated: queries use SQLite's built-in date functions
 * - Cost is computed at write time from the model profile
 */

import { eq, and, gte, lte, sql } from 'drizzle-orm';
import type { VaiDatabase } from '../db/client.js';
import { usageRecords } from '../db/schema.js';
import type { ModelCost } from '../config/types.js';

// ── Types ──

export interface UsageRecord {
  id: string;
  modelId: string;
  provider: string;
  conversationId?: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
  durationMs: number;
  finishReason: string;
  createdAt: Date;
}

export interface UsageSummary {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  avgDurationMs: number;
  byModel: Record<string, {
    requests: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  }>;
}

// ── Cost Calculator ──

export function calculateCost(
  tokensIn: number,
  tokensOut: number,
  cachedTokens: number,
  cost: ModelCost,
): number {
  const regularIn = tokensIn - cachedTokens;
  const inputCost = (regularIn / 1_000_000) * cost.inputPer1M;
  const cachedCost = cost.cachedInputPer1M
    ? (cachedTokens / 1_000_000) * cost.cachedInputPer1M
    : 0;
  const outputCost = (tokensOut / 1_000_000) * cost.outputPer1M;
  return Math.round((inputCost + cachedCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal places
}

// ── Service ──

export class UsageService {
  constructor(private db: VaiDatabase) {}

  /**
   * Record a single LLM call's usage.
   */
  record(entry: Omit<UsageRecord, 'createdAt'>): void {
    this.db.insert(usageRecords).values({
      ...entry,
      createdAt: new Date(),
    }).run();
  }

  /**
   * Get usage summary for a time range.
   * Defaults to current month if no range specified.
   */
  getSummary(from?: Date, to?: Date): UsageSummary {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const rangeFrom = from ?? monthStart;
    const rangeTo = to ?? now;

    const rows = this.db
      .select()
      .from(usageRecords)
      .where(
        and(
          gte(usageRecords.createdAt, rangeFrom),
          lte(usageRecords.createdAt, rangeTo),
        ),
      )
      .all();

    const byModel: UsageSummary['byModel'] = {};
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCostUsd = 0;
    let totalDurationMs = 0;

    for (const row of rows) {
      totalTokensIn += row.tokensIn ?? 0;
      totalTokensOut += row.tokensOut ?? 0;
      totalCostUsd += row.costUsd ?? 0;
      totalDurationMs += row.durationMs ?? 0;

      const model = row.modelId;
      if (!byModel[model]) {
        byModel[model] = { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
      }
      byModel[model].requests++;
      byModel[model].tokensIn += row.tokensIn ?? 0;
      byModel[model].tokensOut += row.tokensOut ?? 0;
      byModel[model].costUsd += row.costUsd ?? 0;
    }

    return {
      totalRequests: rows.length,
      totalTokensIn,
      totalTokensOut,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      avgDurationMs: rows.length > 0 ? Math.round(totalDurationMs / rows.length) : 0,
      byModel,
    };
  }

  /**
   * Check if the current month's spend has exceeded the budget.
   * Returns remaining budget in USD (negative = over budget).
   */
  checkBudget(maxMonthlySpend: number): { spent: number; remaining: number; overBudget: boolean } {
    if (maxMonthlySpend <= 0) return { spent: 0, remaining: Infinity, overBudget: false };

    const summary = this.getSummary();
    const remaining = maxMonthlySpend - summary.totalCostUsd;
    return {
      spent: summary.totalCostUsd,
      remaining,
      overBudget: remaining < 0,
    };
  }
}
