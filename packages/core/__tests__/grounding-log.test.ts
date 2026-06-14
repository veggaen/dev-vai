/**
 * Tests for Stage E — the visual/fact grounding log writer. Uses an in-memory DB so it proves
 * the table exists (created via client migrations) and the writer round-trips, incl. errorType.
 */
import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db/client.js';
import { logGrounding } from '../src/consensus/grounding-log.js';
import { visualGroundingLog } from '../src/db/schema.js';

describe('logGrounding', () => {
  it('writes a clean confirm outcome and reads it back', () => {
    const db = createDb(':memory:');
    logGrounding(db as any, {
      prompt: 'what is the price of eth', subject: 'ETH', claimNumber: 1680,
      evidenceMedian: 1679, corroboration: 3, verdict: 'confirm', shipped: true,
    });
    const rows = db.select().from(visualGroundingLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('ETH');
    expect(rows[0].verdict).toBe('confirm');
    expect(rows[0].shipped).toBe(true);
    expect(rows[0].errorType).toBeNull();
  });

  it('records a failure class (price_hallucination) on a caught contradiction', () => {
    const db = createDb(':memory:');
    logGrounding(db as any, {
      prompt: 'price of eth', subject: 'ETH', claimNumber: 3200, evidenceMedian: 1680,
      corroboration: 3, verdict: 'contradict', shipped: false, errorType: 'price_hallucination',
    });
    const rows = db.select().from(visualGroundingLog).all();
    expect(rows[0].errorType).toBe('price_hallucination');
    expect(rows[0].shipped).toBe(false);
  });

  it('never throws on a malformed db (best-effort logging)', () => {
    const brokenDb = { insert: () => { throw new Error('boom'); } };
    expect(() => logGrounding(brokenDb as any, { prompt: 'x', verdict: 'declined' })).not.toThrow();
  });
});
