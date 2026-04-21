/**
 * Scenario-bench (in-process). Reads the same declarative packs used by
 * scripts/vai-scenario-bench.mjs (which runs over WS against the live runtime).
 *
 * In-process mode exposes `lastResponseMeta` so we can assert on strategy
 * in addition to the content-level checks, which WS doesn't currently expose.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaiEngine } from '../src/models/vai-engine.js';

interface AssertSpec {
  minLength?: number;
  maxLength?: number;
  minWords?: number;
  maxWords?: number;
  contains?: string[];
  anyOfContains?: string[];
  notContains?: string[];
  strategyIn?: string[];
  strategyNotIn?: string[];
}

interface Scenario {
  id: string;
  systemPrompt?: string;
  messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>;
  assert?: AssertSpec;
  /**
   * If set, the scenario is treated as a known-failing todo: it is skipped
   * rather than executed. The value should be a short reason (e.g.
   * "dispatcher has no language-aware routing for Ruby"). Scenarios marked
   * pending still ship in the corpus so they can be lifted incrementally as
   * the hand chain improves.
   */
  pending?: string;
}

interface Pack {
  id: string;
  label?: string;
  scenarios: Scenario[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = join(__dirname, '..', '..', '..', 'eval', 'scenarios');

function loadPacks(): Pack[] {
  const entries = readdirSync(PACKS_DIR, { withFileTypes: true });
  const packs: Pack[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const full = join(PACKS_DIR, entry.name);
    const pack = JSON.parse(readFileSync(full, 'utf-8'));
    if (pack?.id && Array.isArray(pack.scenarios)) packs.push(pack);
  }
  packs.sort((a, b) => a.id.localeCompare(b.id));
  return packs;
}

function makeRegex(pattern: string): RegExp {
  const m = /^\/(.+)\/([gimsuy]*)$/.exec(pattern);
  if (m) {
    const flags = m[2].includes('i') ? m[2] : m[2] + 'i';
    return new RegExp(m[1], flags);
  }
  return new RegExp(pattern, 'i');
}

function evaluateAssertions(text: string, strategy: string | null, spec: AssertSpec | undefined) {
  const failures: string[] = [];
  if (!spec) return { passed: true, failures };
  const length = text.length;
  const words = text.trim().split(/\s+/).filter(Boolean).length;

  if (typeof spec.minLength === 'number' && length < spec.minLength) failures.push(`length ${length} < minLength ${spec.minLength}`);
  if (typeof spec.maxLength === 'number' && length > spec.maxLength) failures.push(`length ${length} > maxLength ${spec.maxLength}`);
  if (typeof spec.minWords === 'number' && words < spec.minWords) failures.push(`words ${words} < minWords ${spec.minWords}`);
  if (typeof spec.maxWords === 'number' && words > spec.maxWords) failures.push(`words ${words} > maxWords ${spec.maxWords}`);

  for (const pat of spec.contains ?? []) {
    if (!makeRegex(pat).test(text)) failures.push(`missing: ${pat}`);
  }
  if (Array.isArray(spec.anyOfContains) && spec.anyOfContains.length > 0) {
    const anyMatch = spec.anyOfContains.some((p) => makeRegex(p).test(text));
    if (!anyMatch) failures.push(`no anyOfContains matched: ${spec.anyOfContains.join(' | ')}`);
  }
  for (const pat of spec.notContains ?? []) {
    if (makeRegex(pat).test(text)) failures.push(`forbidden present: ${pat}`);
  }
  if (Array.isArray(spec.strategyIn) && spec.strategyIn.length > 0) {
    if (!strategy || !spec.strategyIn.includes(strategy)) failures.push(`strategy "${strategy ?? 'unknown'}" not in [${spec.strategyIn.join(', ')}]`);
  }
  if (Array.isArray(spec.strategyNotIn) && spec.strategyNotIn.length > 0) {
    if (strategy && spec.strategyNotIn.includes(strategy)) failures.push(`strategy "${strategy}" is in forbidden [${spec.strategyNotIn.join(', ')}]`);
  }
  return { passed: failures.length === 0, failures };
}

const SCENARIOS_ENABLED = process.env.VAI_SCENARIOS === '1' || process.env.VAI_SCENARIOS === 'true';
const INCLUDE_PENDING = process.env.VAI_SCENARIOS_INCLUDE_PENDING === '1' || process.env.VAI_SCENARIOS_INCLUDE_PENDING === 'true';
const packs = SCENARIOS_ENABLED ? loadPacks() : [];

describe.skipIf(!SCENARIOS_ENABLED)('Vai scenario bench (in-process) — set VAI_SCENARIOS=1 to run', () => {
  let engine: VaiEngine;
  beforeEach(() => {
    engine = new VaiEngine();
  });

  for (const pack of packs) {
    describe(`pack: ${pack.id} — ${pack.label ?? ''}`, () => {
      for (const scenario of pack.scenarios) {
        if (scenario.pending && !INCLUDE_PENDING) {
          it.skip(`${scenario.id} [pending: ${scenario.pending}]`, () => {});
          continue;
        }
        it(scenario.id, async () => {
          const messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }> = [];
          if (scenario.systemPrompt) messages.push({ role: 'system', content: scenario.systemPrompt });

          // Replay prior turns so context-referential / long-context packs work.
          // For each user turn except the last, we append the user message and
          // synthesize an assistant turn from VaiEngine so the last turn has a
          // realistic history to ground on.
          const userTurns = scenario.messages.filter((m) => m.role === 'user');
          for (let i = 0; i < userTurns.length - 1; i++) {
            messages.push({ role: 'user', content: userTurns[i].content });
            const priorResponse = await engine.chat({ messages, noLearn: true });
            messages.push({ role: 'assistant', content: priorResponse.message.content });
          }
          // Final turn — the one we actually assert on.
          const finalUser = userTurns[userTurns.length - 1];
          messages.push({ role: 'user', content: finalUser.content });

          const response = await engine.chat({ messages, noLearn: true });
          const text = response.message.content;
          const strategy = engine.lastResponseMeta?.strategy ?? null;
          const result = evaluateAssertions(text, strategy, scenario.assert);

          if (!result.passed) {
            const preview = text.length > 240 ? text.slice(0, 240) + '…' : text;
            throw new Error(
              `Scenario "${pack.id}/${scenario.id}" failed:\n` +
              result.failures.map((f) => `  - ${f}`).join('\n') +
              `\n\n  strategy: ${strategy ?? '(none)'}\n  length: ${text.length} words: ${text.trim().split(/\s+/).filter(Boolean).length}\n  preview: ${preview}`,
            );
          }
          expect(result.passed).toBe(true);
        }, 60_000);
      }
    });
  }
});
