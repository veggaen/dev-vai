import { describe, expect, it } from 'vitest';
import {
  ODYSSEUS_THEME_PRESETS,
  computeAdvancedDefaults,
} from './odysseus-theme.js';

describe('odysseus-theme', () => {
  it('matches Odysseus dark preset core colors', () => {
    expect(ODYSSEUS_THEME_PRESETS.dark).toMatchObject({
      bg: '#282c34',
      fg: '#9cdef2',
      panel: '#111111',
      border: '#355a66',
      red: '#e06c75',
    });
  });

  it('derives sidebar and input from panel/border', () => {
    const adv = computeAdvancedDefaults(ODYSSEUS_THEME_PRESETS.dark);
    expect(adv.sidebarBg).toBe('#111111');
    expect(adv.inputBg).toBe('#111111');
    expect(adv.inputBorder).toBe('#355a66');
    expect(adv.sendBtnBg).toBe('#e06c75');
    expect(adv.userBubbleBg).toBe('#282c34');
    expect(adv.aiBubbleBg).toBe('#111111');
  });

  it('derives brand from accent red', () => {
    const adv = computeAdvancedDefaults(ODYSSEUS_THEME_PRESETS.light);
    expect(adv.brandColor).toBe('#c47d5a');
    expect(adv.sendBtnBg).toBe('#c47d5a');
  });
});
