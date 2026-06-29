import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasScenarioPrelude, preludeForPromptClass } from './context-scenarios.mjs';

test('followup/context-carry rows get deterministic prior conversation context', () => {
  assert.match(
    preludeForPromptClass('followup/context-carry', 'and what about the second one?')[0],
    /Next\.js and Vite/,
  );
  assert.match(
    preludeForPromptClass('followup/context-carry', 'can you make that simpler?')[0],
    /recursion/i,
  );
  assert.match(
    preludeForPromptClass('followup/context-carry', 'why is it better than the alternative?')[0],
    /SQLite or Postgres/i,
  );
  assert.match(
    preludeForPromptClass('followup/context-carry', 'what would you change about it?')[0],
    /Vai observes chat turns/i,
  );
});

test('non-context classes stay standalone', () => {
  assert.deepEqual(preludeForPromptClass('answer/freshness-staleness', 'who is current?'), []);
  assert.equal(hasScenarioPrelude('answer/freshness-staleness', 'who is current?'), false);
  assert.equal(hasScenarioPrelude('followup/context-carry', 'and what about the second one?'), true);
});
