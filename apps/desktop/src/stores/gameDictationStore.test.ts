import { describe, expect, it } from 'vitest';
import { parseGameDictationSettings } from './gameDictationStore.js';

describe('game dictation settings', () => {
  it('defaults League Open & paste on only when no preference exists', () => {
    expect(parseGameDictationSettings(null)).toBe(true);
    expect(parseGameDictationSettings('not-json')).toBe(false);
    expect(parseGameDictationSettings('{}')).toBe(false);
  });

  it('persists only an explicit opt-out', () => {
    expect(parseGameDictationSettings('{"leagueOpenAndPaste":true}')).toBe(true);
    expect(parseGameDictationSettings('{"leagueOpenAndPaste":false}')).toBe(false);
  });
});
