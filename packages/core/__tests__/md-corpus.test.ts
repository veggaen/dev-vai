/**
 * MD-sourced corpus regression harness.
 *
 * Cases live in eval/corpus-md/<category>/<id>.md and are compiled to
 * eval/generated/corpus.ts via `pnpm corpus:build`. Edit the MD, not the TS.
 *
 * Pending-feature cases (e.g. AI↔AI audience-adaptation) are intentionally
 * skipped here so they don't block the green bar; they ship as regressions
 * once the corresponding engine arm lands.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';
import { CORPUS, type CorpusRegex } from '../../../eval/generated/corpus.js';

function compile(r: CorpusRegex): RegExp {
  return new RegExp(r.pattern, r.flags);
}

describe('MD corpus (eval/corpus-md → eval/generated/corpus.ts)', () => {
  for (const spec of CORPUS) {
    const skip = spec.expectedStatus === 'pending-feature';
    const block = skip ? describe.skip : describe;
    block(`${spec.id} — ${spec.title}`, () => {
      let engine: VaiEngine;
      const messages: { role: 'user' | 'assistant'; content: string }[] = [];

      beforeEach(() => {
        engine = new VaiEngine();
        messages.length = 0;
      });

      it(`pattern=${spec.pattern} category=${spec.category}`, async () => {
        for (let i = 0; i < spec.turns.length; i++) {
          const turn = spec.turns[i];
          if (turn.role !== 'user') {
            // Scripted assistant turns (rare) — inject without calling engine.
            messages.push({ role: 'assistant', content: turn.say });
            continue;
          }
          messages.push({ role: 'user', content: turn.say });
          const r = await engine.chat({ messages: messages.slice() });
          const content = r.message.content;
          messages.push({ role: 'assistant', content });

          const label = `[turn ${i}] ${turn.say.slice(0, 60)}`;
          const trimmed = content.trim();
          if (turn.min_len != null) {
            expect(trimmed.length, `${label} min_len`).toBeGreaterThanOrEqual(turn.min_len);
          }
          if (turn.max_len != null) {
            expect(trimmed.length, `${label} max_len`).toBeLessThanOrEqual(turn.max_len);
          }
          for (const re of turn.must) {
            expect(content, `${label} must match ${re.pattern}/${re.flags}`).toMatch(compile(re));
          }
          for (const re of turn.must_not) {
            expect(content, `${label} must NOT match ${re.pattern}/${re.flags}`).not.toMatch(compile(re));
          }
        }
      }, 30_000);
    });
  }
});
