/**
 * VeggaAI v0 Eval Tasks — Self-Test Suite
 *
 * Pre-registered eval tasks that test VAI's local engine capabilities.
 * No external API keys required — these evaluate the knowledge store,
 * math engine, conversational handler, and code generation.
 *
 * Call `seedVaiEvalTasks()` at startup to register all tasks.
 */

import { registerEvalTasks, type EvalTask } from '@vai/core';

const comprehensionTasks: EvalTask[] = [
  // ── Math ──
  {
    id: 'math-basic-add',
    track: 'comprehension',
    description: 'Basic addition',
    prompt: 'What is 15 + 27?',
    expected: { strategy: 'contains', value: '42' },
    tags: ['math'],
  },
  {
    id: 'math-percentage',
    track: 'comprehension',
    description: 'Percentage calculation',
    prompt: 'What is 25% of 200?',
    expected: { strategy: 'contains', value: '50' },
    tags: ['math'],
  },
  {
    id: 'math-factorial',
    track: 'comprehension',
    description: 'Factorial computation',
    prompt: 'What is factorial of 6?',
    expected: { strategy: 'contains', value: '720' },
    tags: ['math'],
  },
  {
    id: 'math-sqrt',
    track: 'comprehension',
    description: 'Square root',
    prompt: 'What is the square root of 144?',
    expected: { strategy: 'contains', value: '12' },
    tags: ['math'],
  },
  {
    id: 'math-gcd',
    track: 'comprehension',
    description: 'GCD computation',
    prompt: 'GCD of 48 and 18',
    expected: { strategy: 'contains', value: '6' },
    tags: ['math'],
  },

  // ── Conversational ──
  {
    id: 'conv-greeting',
    track: 'comprehension',
    description: 'Responds to greeting',
    prompt: 'Hello!',
    expected: { strategy: 'regex', value: 'hello|hi|hey|veggaai|vai' },
    tags: ['conversational'],
  },
  {
    id: 'conv-identity',
    track: 'comprehension',
    description: 'Knows its own identity',
    prompt: 'What are you?',
    expected: { strategy: 'contains', value: 'VeggaAI|VAI|local-first' },
    tags: ['conversational'],
  },

  // ── Code Generation ──
  {
    id: 'code-fizzbuzz',
    track: 'comprehension',
    description: 'Generates fizzbuzz',
    prompt: 'Write a fizzbuzz function in TypeScript',
    expected: { strategy: 'contains', value: 'function|fizz|buzz|Fizz|Buzz' },
    tags: ['code'],
  },
  {
    id: 'code-fibonacci',
    track: 'comprehension',
    description: 'Generates fibonacci',
    prompt: 'Write a fibonacci function in TypeScript',
    expected: { strategy: 'contains', value: 'function|fibonacci|fib' },
    tags: ['code'],
  },

  // ── Binary/Hex ──
  {
    id: 'binary-convert',
    track: 'comprehension',
    description: 'Converts decimal to binary',
    prompt: 'Convert 255 to binary',
    expected: { strategy: 'contains', value: '11111111' },
    tags: ['math', 'binary'],
  },

  // ── Knowledge (bootstrap) ──
  {
    id: 'know-self-awareness',
    track: 'comprehension',
    description: 'Knows what it can do',
    prompt: 'What do you know about?',
    expected: { strategy: 'regex', value: 'learn|knowledge|sources|teach' },
    tags: ['meta'],
  },

  // ── Empty/Edge ──
  {
    id: 'edge-gibberish',
    track: 'comprehension',
    description: 'Handles gibberish gracefully',
    prompt: 'asdfghjkl',
    expected: { strategy: 'regex', value: 'keyboard|noise|question|try' },
    tags: ['edge'],
  },
];

export function seedVaiEvalTasks(): void {
  registerEvalTasks('comprehension', comprehensionTasks);
}
