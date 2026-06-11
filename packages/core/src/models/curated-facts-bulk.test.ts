import { describe, expect, it } from 'vitest';
import { bulkFactsLookup } from './curated-facts-bulk.js';

describe('bulkFactsLookup definitional gate', () => {
  it('answers a genuine "what is X" entity question with the curated card', () => {
    const result = bulkFactsLookup('what is javascript?');
    expect(result).toBeTruthy();
    expect(result).toMatch(/programming language/i);
  });

  it('does not emit an entity card for a comparison that merely names the entity', () => {
    // Passes the "what's…" prefix but the subject is a contrast, not JavaScript.
    expect(
      bulkFactsLookup("what's the difference between deep cloning and shallow copying an object in javascript?"),
    ).toBeNull();
  });

  it('defers explicit comparisons to the reasoning path', () => {
    expect(bulkFactsLookup('what is the difference between python and rust')).toBeNull();
    expect(bulkFactsLookup('what is python vs java')).toBeNull();
    expect(bulkFactsLookup('what are the tradeoffs between typescript and javascript')).toBeNull();
  });
});
