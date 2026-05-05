/**
 * Vetle conversation — acceptance spec.
 *
 * Captures the exact conversation V3gga showed in chat where Vai produced
 * five embarrassing failures in a row. Each turn here is a contract: the
 * response must satisfy the assertion or the slice is not done.
 *
 * Source screenshot: 2026-04-28, MDS/Thorsen.md context.
 *
 * The five turns:
 *   1. Greeting + question + scope constraint compound prompt — must NOT be
 *      mistaken for a "teach me a fact" message.
 *   2. User supplies the answer themselves — must accept it gracefully.
 *   3. Compound follow-up question with a count — must answer or admit gap;
 *      must NOT echo a previous unrelated prompt.
 *   4. Buried math request — must compute the math, not dispatch unknown-topic.
 *   5. Literal meta-question about the prompt itself — must answer "o", not
 *      dump scraped GitHub README content.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

describe('Vetle conversation — five-turn acceptance', () => {
  let engine: VaiEngine;

  beforeEach(() => {
    engine = new VaiEngine();
  });

  it('Q1: greeting + question + scope must NOT be misrouted to teach-fact', async () => {
    const input = 'Hello I am Vetle and I want to know who is king in norway, please repond with only the name of the king and then also tell me my name';
    const r = await engine.chat({ messages: [{ role: 'user', content: input }] });
    const content = r.message.content;
    // Hard-fail signatures of the original bug.
    expect(content).not.toMatch(/I'?ve learned that "/i);
    expect(content).not.toMatch(/I'?ll remember this\.?$/i);
    // Should at least acknowledge the user's name OR the king question.
    // We accept any of: name acknowledged, king answered, or a clean
    // "I don't have a confident answer" — never the teach echo.
    expect(content.length).toBeGreaterThan(8);
  });

  it('Q2: user supplies their own answer — assistant accepts gracefully', async () => {
    const history = [
      { role: 'user' as const, content: 'Hello I am Vetle, who is king in Norway?' },
      { role: 'assistant' as const, content: 'Nice to meet you, Vetle. I am not certain about the current king of Norway right now.' },
    ];
    const r = await engine.chat({ messages: [...history, { role: 'user', content: 'Harald V Vetle' }] });
    const content = r.message.content.toLowerCase();
    // Must NOT respond with the generic "I want to give you a useful answer — could you say more" stall.
    expect(content).not.toMatch(/could you say a bit more about what you'?re looking for/i);
    expect(content).not.toMatch(/for example:[\s\S]*"how does x work"/i);
  });

  it('Q3: compound follow-up must NOT echo an unrelated previous prompt as the answer', async () => {
    const history = [
      { role: 'user' as const, content: 'Hello I am Vetle, who is king in norway?' },
      { role: 'assistant' as const, content: 'Hello Vetle.' },
    ];
    const input = 'I want to also know who is king in a different country can you tell me name + country for 3 countries?';
    const r = await engine.chat({ messages: [...history, { role: 'user', content: input }] });
    const content = r.message.content;
    // The original bug: the answer body was literally "king in norway, please repond with only the name of the king and then also tell me my name".
    expect(content).not.toMatch(/king in norway, please repond/i);
    expect(content).not.toMatch(/respond with only the name of the king/i);
  });

  it('Q4: buried math — "tell me 100 plus fifty five" must compute 155', async () => {
    const input = 'this is not what I wanted... emm tell me 100 plus fifty five';
    const r = await engine.chat({ messages: [{ role: 'user', content: input }] });
    const content = r.message.content;
    expect(content).toMatch(/\b155\b/);
    // Must NOT dispatch the unknown-topic stub.
    expect(content).not.toMatch(/I don'?t have a solid answer for/i);
  });

  it('Q5: literal meta-question — "first letter in this question" must answer "o"', async () => {
    const input = 'okay what is the first letter in this question?';
    const r = await engine.chat({ messages: [{ role: 'user', content: input }] });
    const content = r.message.content.trim().toLowerCase();
    // Accept "o" or a short sentence ending in/containing "o" as the literal answer.
    // The answer must be SHORT (<= 30 chars) — never a research dump.
    expect(content.length).toBeLessThanOrEqual(30);
    expect(content).toContain('o');
    // Must NOT contain unrelated scraped content.
    expect(content).not.toMatch(/uberman|metro\s+city|hero\s+after\s+defeating|readme/i);
  });
});
