/**
 * Steering reference data analysis helpers.
 *
 * These operate on the data we now write:
 *  - route_guidances rows (the steers posted by humans/agents/robots)
 *  - messages.plan JSON (steered plan + baseline plan + hadGuidance flag)
 *  - messages.feedback
 *  - later: session scores, follow-up correction signals, honest audit results, etc.
 *
 * Use the output to decide:
 *   benefit = positive delta in chosen confidence / user feedback / reduced corrections
 *            when hadGuidance=true vs matched baseline or historical no-steer turns.
 *   re-calibration signal = recent guidance from an actor shows flat/negative lift,
 *            low application success, or scope match producing wrong handler often.
 */

import type { VaiDatabase } from '@vai/core';
import { schema } from '@vai/core';
import { eq } from 'drizzle-orm';

export interface SteeringLiftSummary {
  totalSteeredTurns: number;
  turnsWithUserFeedback: number;
  avgFeedbackSteered: number | null; // 0..1
  guidanceApplications: number;
  uniqueActors: number;
  topHandlersAffected: Array<{ handler: string; count: number }>;
  /**
   * Simple heuristic "is steering helping?" proxy.
   * In real use you'd join with outcome models (ConversationCurve, eval scores, etc).
   */
  roughLiftSignal: 'positive' | 'neutral' | 'needs-review' | 'insufficient-data';
}

export function computeSteeringLift(db: VaiDatabase, _opts: { conversationId?: string; sinceMs?: number } = {}): SteeringLiftSummary {
  // Count messages that had steering (plan JSON indicates hadGuidance)
  const msgQuery = db
    .select({ plan: schema.messages.plan, feedback: schema.messages.feedback, modelId: schema.messages.modelId })
    .from(schema.messages)
    .where(eq(schema.messages.role, 'assistant'));

  const msgs = msgQuery.all();

  let steered = 0;
  let feedbackSum = 0;
  let feedbackCount = 0;
  const handlerCounts = new Map<string, number>();
  const actorSet = new Set<string>();

  for (const m of msgs) {
    if (!m.plan) continue;
    try {
      const p = JSON.parse(m.plan);
      if (p?.hadGuidance) {
        steered++;
        if (typeof m.feedback === 'number') {
          feedbackSum += m.feedback; // 0 or 1
          feedbackCount++;
        }
        const chosen = p.steered?.chosen;
        if (chosen) {
          handlerCounts.set(chosen, (handlerCounts.get(chosen) ?? 0) + 1);
        } else {
          // High-value case: the steer caused fall-through to model
          handlerCounts.set('(model-fallback)', (handlerCounts.get('(model-fallback)') ?? 0) + 1);
        }
      }
    } catch {
      // Malformed plan JSON — skip this row's steering signal.
    }
  }

  // Also count guidance rows for applications
  const guidances = db
    .select({ applied: schema.routeGuidances.appliedCount, author: schema.routeGuidances.author, from: schema.routeGuidances.from })
    .from(schema.routeGuidances)
    .all();

  let apps = 0;
  for (const g of guidances) {
    apps += g.applied ?? 0;
    if (g.author) actorSet.add(g.author);
    else if (g.from) actorSet.add(g.from);
  }

  const top = Array.from(handlerCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([handler, count]) => ({ handler, count }));

  let rough: SteeringLiftSummary['roughLiftSignal'] = 'insufficient-data';
  if (steered > 5 && feedbackCount > 3) {
    const avg = feedbackSum / feedbackCount;
    rough = avg > 0.7 ? 'positive' : avg < 0.4 ? 'needs-review' : 'neutral';
  } else if (steered > 0) {
    rough = 'insufficient-data';
  }

  return {
    totalSteeredTurns: steered,
    turnsWithUserFeedback: feedbackCount,
    avgFeedbackSteered: feedbackCount > 0 ? feedbackSum / feedbackCount : null,
    guidanceApplications: apps,
    uniqueActors: actorSet.size,
    topHandlersAffected: top,
    roughLiftSignal: rough,
  };
}

/**
 * Example usage (e.g. in a /api/steering/stats endpoint or nightly job):
 *
 * const summary = computeSteeringLift(db);
 * if (summary.roughLiftSignal === 'needs-review') {
 *   // trigger re-calibration suggestion, decay some weights, notify owner, etc.
 * }
 */
