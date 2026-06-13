/**
 * Inline five-color theme editor — live preview, no modal overlay.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  applyOdysseusColors,
  CORE_COLOR_FIELDS,
  customThemeLabelForBase,
  loadCustomThemes,
  ODYSSEUS_THEME_PRESETS,
  pickOdysseusCoreColors,
  saveCustomThemeFromPreset,
  updateCustomTheme,
  type OdysseusCoreColors,
} from '../../../lib/odysseus-theme.js';

interface ThemeColorEditorProps {
  /** Customize a built-in preset → saves as `{base}-custom`. */
  basePresetId?: string;
  /** Edit an existing saved custom theme in place. */
  customThemeId?: string;
  onSaved: (themeId: string) => void;
  onCancel: () => void;
}

export function ThemeColorEditor({
  basePresetId,
  customThemeId,
  onSaved,
  onCancel,
}: ThemeColorEditorProps) {
  const editingCustom = Boolean(customThemeId);
  const stored = customThemeId ? loadCustomThemes()[customThemeId] : undefined;
  const resolvedBase = stored?.basePresetId ?? basePresetId ?? 'dark';
  const preset = ODYSSEUS_THEME_PRESETS[resolvedBase];
  const presetLabel = preset?.label ?? resolvedBase;

  const [label, setLabel] = useState(() => {
    if (stored?.label) return stored.label;
    return customThemeLabelForBase(resolvedBase);
  });

  const [draft, setDraft] = useState<OdysseusCoreColors>(() => {
    if (stored) return pickOdysseusCoreColors(stored);
    const saved = basePresetId ? loadCustomThemes()[`${basePresetId}-custom`] : undefined;
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
    const themeId = editingCustom && customThemeId
      ? updateCustomTheme(customThemeId, draft, label)
      : saveCustomThemeFromPreset(resolvedBase, draft, label);
    setDirty(false);
    onSaved(themeId);
  };

  const handleReset = () => {
    if (editingCustom && stored) {
      setDraft(pickOdysseusCoreColors(stored));
      setLabel(stored.label);
    } else {
      const base = pickOdysseusCoreColors(preset ?? ODYSSEUS_THEME_PRESETS.dark);
      setDraft(base);
      setLabel(customThemeLabelForBase(resolvedBase));
    }
    applyOdysseusColors(editingCustom && stored ? stored : preset ?? ODYSSEUS_THEME_PRESETS.dark);
    setDirty(false);
  };

  return (
    <div className="mt-3 border-t border-[color:var(--border)] pt-3">
      <p className="mb-3 text-xs text-[color:var(--color-muted)]">
        {editingCustom
          ? `Editing your saved theme — changes apply live.`
          : `Customizing ${presetLabel} — saves as a theme under Your themes.`}
      </p>

      <label className="mb-3 flex flex-col gap-1">
        <span className="text-xs font-medium text-[color:var(--fg)]">Theme name</span>
        <input
          type="text"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setDirty(true);
          }}
          maxLength={48}
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--input-bg,var(--panel))] px-3 py-2 text-sm text-[color:var(--fg)]"
          placeholder="My theme"
        />
      </label>

      <div className="space-y-2">
        {CORE_COLOR_FIELDS.map(({ key, label: fieldLabel, hint }) => (
          <label
            key={key}
            className="flex items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-3 py-2"
          >
            <input
              type="color"
              value={draft[key] as string}
              onChange={(e) => updateColor(key, e.target.value)}
              className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-[color:var(--border)] bg-transparent p-0.5"
              aria-label={fieldLabel}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-[color:var(--fg)]">{fieldLabel}</span>
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
          disabled={!dirty || !label.trim()}
          className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent-soft)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          {editingCustom ? 'Save changes' : `Save ${label.trim() || customThemeLabelForBase(resolvedBase)}`}
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
