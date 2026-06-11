/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ODYSSEUS_THEME_PRESETS,
  VAI_ACTIVE_THEME_ID_KEY,
  VAI_CUSTOM_THEMES_KEY,
  applyThemeById,
  computeAdvancedDefaults,
  getActiveThemeId,
  isThemeCardActive,
  listCustomThemeEntries,
  loadCustomThemes,
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

  it('theme card active state is mutually exclusive by id', () => {
    expect(isThemeCardActive('dark', 'dark')).toBe(true);
    expect(isThemeCardActive('dark-custom', 'dark')).toBe(false);
    expect(isThemeCardActive('dark-custom', 'dark-custom')).toBe(true);
    expect(isThemeCardActive('dark', 'dark-custom')).toBe(false);
  });

  it('derives brand from accent red', () => {
    const adv = computeAdvancedDefaults(ODYSSEUS_THEME_PRESETS.light);
    expect(adv.brandColor).toBe('#c47d5a');
    expect(adv.sendBtnBg).toBe('#c47d5a');
  });

  describe('custom theme storage', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('migrates legacy custom themes stored under preset ids', () => {
      localStorage.setItem(
        VAI_CUSTOM_THEMES_KEY,
        JSON.stringify({
          dark: {
            bg: '#111111',
            fg: '#ffffff',
            panel: '#222222',
            border: '#333333',
            red: '#00ff00',
            label: 'Dark Custom',
            basePresetId: 'dark',
          },
        }),
      );
      localStorage.setItem(VAI_ACTIVE_THEME_ID_KEY, 'dark');

      const themes = loadCustomThemes();
      expect(themes['dark-custom']).toMatchObject({ bg: '#111111', red: '#00ff00' });
      expect(themes.dark).toBeUndefined();
      expect(getActiveThemeId()).toBe('dark-custom');
    });

    it('applies built-in preset even when legacy custom shared the same key', () => {
      localStorage.setItem(
        VAI_CUSTOM_THEMES_KEY,
        JSON.stringify({
          dark: {
            bg: '#111111',
            fg: '#ffffff',
            panel: '#222222',
            border: '#333333',
            red: '#00ff00',
            label: 'Dark Custom',
            basePresetId: 'dark',
          },
        }),
      );

      loadCustomThemes();
      applyThemeById('dark');

      expect(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()).toBe('#282c34');
      expect(getActiveThemeId()).toBe('dark');
    });

    it('listCustomThemeEntries keeps storage id when entry wrongly includes preset id', () => {
      localStorage.setItem(
        VAI_CUSTOM_THEMES_KEY,
        JSON.stringify({
          'dark-custom': {
            id: 'dark',
            bg: '#00aa00',
            fg: '#ffffff',
            panel: '#222222',
            border: '#333333',
            red: '#e06c75',
            label: 'Dark Custom',
            basePresetId: 'dark',
          },
        }),
      );

      const entries = listCustomThemeEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('dark-custom');
      expect(entries[0].bg).toBe('#00aa00');
      expect(isThemeCardActive('dark-custom', entries[0].id)).toBe(true);
      expect(isThemeCardActive('dark', entries[0].id)).toBe(false);
    });

    it('applies saved custom theme by dark-custom id', () => {
      localStorage.setItem(
        VAI_CUSTOM_THEMES_KEY,
        JSON.stringify({
          'dark-custom': {
            bg: '#111111',
            fg: '#ffffff',
            panel: '#222222',
            border: '#333333',
            red: '#00ff00',
            label: 'Dark Custom',
            basePresetId: 'dark',
          },
        }),
      );

      applyThemeById('dark-custom');

      expect(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()).toBe('#111111');
      expect(getActiveThemeId()).toBe('dark-custom');
    });
  });
});
