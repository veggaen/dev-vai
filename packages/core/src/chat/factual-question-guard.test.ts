import { describe, it, expect } from 'vitest';
import { looksLikeFactualQuestion, isExplicitBuildExecutionRequest } from './build-execution-intent.js';

/**
 * The anti-hijack guard: a factual/informational question must be recognized as such so the
 * builder lane is turned OFF for that turn (the fix for "what is the price of btc?" becoming
 * a 260s HTML-widget build). It must NOT catch real build requests.
 */

describe('looksLikeFactualQuestion — factual turns that must never become a build', () => {
  it('catches the exact failure case and its class', () => {
    expect(looksLikeFactualQuestion('what is the price of btc?')).toBe(true);
    expect(looksLikeFactualQuestion('what is the price of bitcoin')).toBe(true);
    expect(looksLikeFactualQuestion('how much is ETH right now')).toBe(true);
    expect(looksLikeFactualQuestion("what's the current price of gold?")).toBe(true);
  });

  it('catches general information-seeking questions', () => {
    expect(looksLikeFactualQuestion('who is the prime minister of Norway?')).toBe(true);
    expect(looksLikeFactualQuestion('when was TypeScript released')).toBe(true);
    expect(looksLikeFactualQuestion('what is the capital of France?')).toBe(true);
    expect(looksLikeFactualQuestion('how many planets are in the solar system')).toBe(true);
    expect(looksLikeFactualQuestion('which is faster, rust or go?')).toBe(true);
  });

  it('catches fresh-data asks (price/weather/latest/current)', () => {
    expect(looksLikeFactualQuestion('btc price')).toBe(true);
    expect(looksLikeFactualQuestion('latest version of node')).toBe(true);
    expect(looksLikeFactualQuestion('weather in Oslo today')).toBe(true);
    expect(looksLikeFactualQuestion('current exchange rate usd to nok')).toBe(true);
  });
});

describe('looksLikeFactualQuestion — must NOT catch real build requests', () => {
  it('does not catch explicit build requests, even ones mentioning prices', () => {
    expect(looksLikeFactualQuestion('build me a dashboard that shows the btc price')).toBe(false);
    expect(looksLikeFactualQuestion('make a landing page')).toBe(false);
    expect(looksLikeFactualQuestion('create a price tracker app')).toBe(false);
    expect(looksLikeFactualQuestion('scaffold a crypto portfolio site')).toBe(false);
  });

  it('does not catch how-to-build requests', () => {
    expect(looksLikeFactualQuestion('how do I build a price widget')).toBe(false);
    expect(looksLikeFactualQuestion('how to make a react component')).toBe(false);
  });

  it('does not catch long, complex build briefs', () => {
    const longBuild = 'I want you to create a full e-commerce site with a product catalog, a shopping cart, checkout, user accounts, and an admin dashboard with analytics and order management';
    expect(looksLikeFactualQuestion(longBuild)).toBe(false);
  });

  it('is consistent with isExplicitBuildExecutionRequest (mutually exclusive on builds)', () => {
    const builds = ['build me an app', 'create a website', 'make a tinder clone'];
    for (const b of builds) {
      expect(isExplicitBuildExecutionRequest(b)).toBe(true);
      expect(looksLikeFactualQuestion(b)).toBe(false);
    }
  });
});

describe('looksLikeFactualQuestion — edge cases', () => {
  it('returns false for empty/whitespace', () => {
    expect(looksLikeFactualQuestion('')).toBe(false);
    expect(looksLikeFactualQuestion('   ')).toBe(false);
  });
  it('does not over-trigger on a statement that is not a question or fresh-data ask', () => {
    expect(looksLikeFactualQuestion('add a dark mode toggle to the settings panel')).toBe(false);
  });
});
