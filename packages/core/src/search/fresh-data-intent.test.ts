import { describe, it, expect } from 'vitest';
import { buildSearchPlan } from './pipeline.js';
describe('fresh-data intent', () => {
  it('classifies price questions as fresh-data, not definition', () => {
    expect(buildSearchPlan('what is the price of btc?').intent).toBe('fresh-data');
    expect(buildSearchPlan('btc price').intent).toBe('fresh-data');
    expect(buildSearchPlan('how much is ethereum worth').intent).toBe('fresh-data');
  });
  it('fresh-data fan-out is time-anchored, not wikipedia', () => {
    const plan = buildSearchPlan('what is the price of btc?');
    expect(plan.fanOutQueries.some(q => /price today|current price|live price/i.test(q))).toBe(true);
    expect(plan.fanOutQueries.some(q => /wikipedia|official docs/i.test(q))).toBe(false);
  });
  it('still classifies real definitions correctly', () => {
    expect(buildSearchPlan('what is typescript?').intent).toBe('definition');
  });
});
