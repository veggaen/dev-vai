/**
 * Inline five-color theme editor — live preview, no modal overlay.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  applyOdysseusColors,
  CORE_COLOR_FIELDS,
  customThemeLabelForBase,
  customThemeIdForBase,
  loadCustomThemes,
  ODYSSEUS_THEME_PRESETS,
  pickOdysseusCoreColors,
  saveCustomThemeFromPreset,
  type OdysseusCoreColors,
} from '../../../lib/odysseus-theme.js';

interface ThemeColorEditorProps {
  basePresetId: string;
  onSaved: (themeId: string) => void;
  onCancel: () => void;
}

export function ThemeColorEditor({ basePresetId, onSaved, onCancel }: ThemeColorEditorProps) {
  const preset = ODYSSEUS_THEME_PRESETS[basePresetId];
  const presetLabel = preset?.label ?? basePresetId;

  const [draft, setDraft] = useState<OdysseusCoreColors>(() => {
    const saved = loadCustomThemes()[customThemeIdForBase(basePresetId)];
    if (saved) return pickOdysseusCoreColors(saved);
    return pickOdysseusCoreColors(preset ?? ODYSSEUS_THEME_PRESETS.dark);
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    applyOdysseusColors(draft);
  }, [draft]);

  const updateColor = useCallback((key: keyof OdysseusCoreColors, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleSave = () => {
    const themeId = saveCustomThemeFromPreset(basePresetId, draft);
    setDirty(false);
    onSaved(themeId);
  };

  const handleReset = () => {
    const base = pickOdysseusCoreColors(preset ?? ODYSSEUS_THEME_PRESETS.dark);
    setDraft(base);
    applyOdysseusColors(base);
    setDirty(false);
  };

  return (
    <div className="mt-3 border-t border-[color:var(--border)] pt-3">
      <p className="mb-3 text-xs text-[color:var(--color-muted)]">
        Editing {presetLabel} — changes apply live across the app.
      </p>
      <div className="space-y-2">
        {CORE_COLOR_FIELDS.map(({ key, label, hint }) => (
          <label
            key={key}
            className="flex items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-3 py-2"
          >
            <input
              type="color"
              value={draft[key] as string}
              onChange={(e) => updateColor(key, e.target.value)}
              className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-[color:var(--border)] bg-transparent p-0.5"
              aria-label={label}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-[color:var(--fg)]">{label}</span>
              <span className="block text-[10px] text-[color:var(--color-muted)]">{hint}</span>
            </span>
            <input
              type="text"
              value={draft[key] as string}
              onChange={(e) => updateColor(key, e.target.value)}
              className="w-20 shrink-0 rounded border border-[color:var(--border)] bg-[color:var(--input-bg,var(--panel))] px-2 py-1 font-mono text-[10px]"
              spellCheck={false}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty}
          className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent-soft)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          Save {customThemeLabelForBase(basePresetId)}
        </button>
        <button type="button" onClick={handleReset} className="rounded-lg border border-[color:var(--border)] px-3 py-1.5 text-xs">
          Reset
        </button>
        <button type="button" onClick={onCancel} className="ml-auto rounded-lg px-3 py-1.5 text-xs text-[color:var(--color-muted)]">
          Done
        </button>
      </div>
    </div>
  );
}
