import { describe, expect, it } from 'vitest';
import { tryEmitBoundaryResponse } from './boundary-response.js';

describe('tryEmitBoundaryResponse', () => {
  it('escalates chest pain with shortness of breath', () => {
    const response = tryEmitBoundaryResponse({ content: 'I have crushing chest pain and shortness of breath. What should I do?' });
    expect(response).toMatch(/emergency services|112|911/i);
    expect(response).not.toMatch(/wait and see|probably fine/i);
  });

  it('keeps legal contract questions jurisdiction-aware', () => {
    const response = tryEmitBoundaryResponse({ content: 'Is this contract enforceable if my customer refuses to pay?' });
    expect(response).toMatch(/jurisdiction|contract terms|lawyer|not legal advice/i);
  });

  it('does not invent local providers', () => {
    const response = tryEmitBoundaryResponse({ content: 'Find me the best plumber near me in Bergen right now.' });
    expect(response).toMatch(/don't have live local listings|Google Maps|local directory/i);
    expect(response).not.toMatch(/I found the best plumber is/i);
  });

  it('gives shopping criteria without pretending current listings', () => {
    const response = tryEmitBoundaryResponse({ content: 'What laptop should I buy under $800 for coding and school?' });
    expect(response).toMatch(/RAM|SSD|battery|keyboard|screen|CPU/i);
    expect(response).not.toMatch(/exact current price/i);
  });
});
