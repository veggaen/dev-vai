import { describe, expect, it } from 'vitest';
import { tryEmitBoundaryResponse } from './boundary-response.js';
import { reviewTurnSecurity } from './security-review.js';

describe('acute medical-emergency safety net', () => {
  // Chest-pain escalation moved upstream into security-review.ts so it runs
  // ahead of every router. This guards the safety path at its real location.
  it('short-circuits chest pain with shortness of breath into an emergency reply', () => {
    const result = reviewTurnSecurity({
      content: 'I have crushing chest pain and shortness of breath. What should I do?',
    });
    expect(result.action).toBe('short-circuit');
    if (result.action === 'short-circuit') {
      expect(result.reply).toMatch(/emergency services|112|911/i);
      expect(result.reply).not.toMatch(/wait and see|probably fine/i);
    }
  });

  it('does not short-circuit an ordinary question', () => {
    expect(reviewTurnSecurity({ content: 'What is a deadlock?' }).action).toBe('allow');
  });
});

describe('tryEmitBoundaryResponse', () => {
  it('keeps legal contract questions jurisdiction-aware', () => {
    const response = tryEmitBoundaryResponse({ content: 'Is this contract enforceable if my customer refuses to pay?' });
    expect(response).toMatch(/jurisdiction|contract terms|lawyer|not legal advice/i);
  });

  it('does not invent local providers', () => {
    const response = tryEmitBoundaryResponse({ content: 'Find me the best plumber near me in Bergen right now.' });
    expect(response).toMatch(/don't have live local listings|Google Maps|local directory/i);
    expect(response).not.toMatch(/I found the best plumber is/i);
  });

  it('does not block a named restaurant practical-detail lookup', () => {
    expect(tryEmitBoundaryResponse({
      content: 'Can you find the current menu for the Jafs restaurant closest to Helsfyr?',
    })).toBeNull();
  });

  it('gives shopping criteria without pretending current listings', () => {
    const response = tryEmitBoundaryResponse({ content: 'What laptop should I buy under $800 for coding and school?' });
    expect(response).toMatch(/RAM|SSD|battery|keyboard|screen|CPU/i);
    expect(response).not.toMatch(/exact current price/i);
  });
});
