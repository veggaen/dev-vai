import { describe, it, expect } from 'vitest';
import { detectMultiIntent } from './multi-intent.js';

describe('detectMultiIntent — decomposes distinct asks in one message', () => {
  it('splits "explain X and then build Y" into an answer part + a build part', () => {
    const r = detectMultiIntent('Explain how JWT auth works and then build me a login page that uses it.');
    expect(r.isMultiIntent).toBe(true);
    expect(r.parts).toHaveLength(2);
    expect([...r.actions].sort()).toEqual(['answer', 'build']);
    expect(r.parts[0].action).toBe('answer');
    expect(r.parts[1].action).toBe('build');
    expect(r.parts[0].text.toLowerCase()).toContain('jwt');
    expect(r.parts[1].text.toLowerCase()).toContain('login page');
  });

  it('handles the photographer-app prompt: explain part + build part', () => {
    const r = detectMultiIntent(
      'Explain how JWT auth works and how to use it, and then build me a photographer portfolio app with nature images only and a social page when logged in.',
    );
    expect(r.isMultiIntent).toBe(true);
    expect(r.actions).toContain('answer');
    expect(r.actions).toContain('build');
  });

  it('is NOT multi-intent for a same-kind compound question (left to splitCompoundQuestion)', () => {
    const r = detectMultiIntent('What is the capital of Japan and what is the currency of Brazil?');
    expect(r.isMultiIntent).toBe(false);
    expect(r.parts).toHaveLength(1);
  });

  it('does NOT over-split an internal "and" inside one build clause', () => {
    // "altered and unaltered states" must not become its own request.
    const r = detectMultiIntent('Build me a portfolio app with login for altered and unaltered states.');
    expect(r.isMultiIntent).toBe(false);
  });

  it('leaves a plain single ask single', () => {
    expect(detectMultiIntent('What are great tools for computer intelligence?').isMultiIntent).toBe(false);
    expect(detectMultiIntent('Build me a Next.js todo app.').isMultiIntent).toBe(false);
  });

  it('handles empty / whitespace input safely', () => {
    const r = detectMultiIntent('   ');
    expect(r.isMultiIntent).toBe(false);
    expect(r.parts).toHaveLength(1);
  });

  it('caps at 3 parts and stays single when fragments are not request-shaped', () => {
    const r = detectMultiIntent('apples and oranges and bananas');
    expect(r.isMultiIntent).toBe(false);
  });
});
