import { describe, expect, it } from 'vitest';
import { prepareBaselineTranscript } from './useVoiceDictation.js';

describe('prepareBaselineTranscript', () => {
  it('preserves a native acceptance nonce byte-for-byte', () => {
    expect(prepareBaselineTranscript('vai-00deadbeef', true)).toEqual({
      text: 'vai-00deadbeef',
      applied: [],
    });
  });

  it('keeps ordinary dictation grooming enabled', () => {
    expect(prepareBaselineTranscript('hello there')).toMatchObject({ text: 'Hello there' });
  });
});
