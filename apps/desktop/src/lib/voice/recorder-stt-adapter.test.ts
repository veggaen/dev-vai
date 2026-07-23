import { describe, expect, it } from 'vitest';
import { mergeTranscriptionSegments } from './recorder-stt-adapter.js';

describe('mergeTranscriptionSegments', () => {
  it('keeps long-hold segment order and normalizes boundary whitespace', () => {
    expect(mergeTranscriptionSegments([
      ' first forty-five seconds ',
      '',
      'the next segment\ncontinues',
      ' final tail ',
    ])).toBe('first forty-five seconds the next segment continues final tail');
  });

  it('returns an empty transcript when every segment is silent', () => {
    expect(mergeTranscriptionSegments(['', '   ', '\n'])).toBe('');
  });
});
