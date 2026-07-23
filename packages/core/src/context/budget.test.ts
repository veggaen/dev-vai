import { describe, expect, it } from 'vitest';
import { budgetContext } from './budget.js';

describe('budgetContext', () => {
  it('keeps minimal system/turn tiers and excludes lower tiers with a receipt', () => {
    const result = budgetContext({
      modelId: 'small', contextWindow: 20, reservedTokens: 5,
      candidates: [
        { id: 'skill', tier: 4, kind: 'skill', content: 'x'.repeat(40), reason: 'optional skill' },
        { id: 'turn', tier: 0, kind: 'turn', content: 'question', reason: 'current turn' },
        { id: 'tools', tier: 3, kind: 'tool-schema', content: 'x'.repeat(40), reason: 'on demand' },
      ],
    });
    expect(result.items.map((item) => item.id)).toEqual(['turn', 'tools']);
    expect(result.receipt.excluded[0]?.id).toBe('skill');
  });
});
