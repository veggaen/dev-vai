/**
 * Inline five-color theme editor — live preview with explicit cancel/restore.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
  basePresetId?: string;
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

  const snapshotRef = useRef<OdysseusCoreColors>(
    stored
      ? pickOdysseusCoreColors(stored)
      : pickOdysseusCoreColors(preset ?? ODYSSEUS_THEME_PRESETS.dark),
  );

  const [label, setLabel] = useState(() => stored?.label ?? customThemeLabelForBase(resolvedBase));
  const [draft, setDraft] = useState<OdysseusCoreColors>(() => ({ ...snapshotRef.current }));
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
    snapshotRef.current = { ...draft };
    onSaved(themeId);
  };

  const handleCancel = () => {
    applyOdysseusColors(snapshotRef.current);
    onCancel();
  };

  const handleReset = () => {
    const baseline = editingCustom && stored
      ? pickOdysseusCoreColors(stored)
      : pickOdysseusCoreColors(preset ?? ODYSSEUS_THEME_PRESETS.dark);
    setDraft(baseline);
    setLabel(stored?.label ?? customThemeLabelForBase(resolvedBase));
    applyOdysseusColors(baseline);
    setDirty(false);
  };

  return (
    <div className="mt-4 space-y-4 border-t border-[color:var(--border)] pt-4">
      <p className="text-xs leading-relaxed text-[color:var(--color-muted)]">
        Five core colors drive the entire shell. Changes preview live — save when you are happy, or cancel to restore.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-[color:var(--fg)]">Theme name</span>
        <input
          type="text"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setDirty(true);
          }}
          maxLength={48}
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--input-bg,var(--panel))] px-3 py-2 text-sm text-[color:var(--fg)] focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-ring)]"
          placeholder="My theme"
        />
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        {CORE_COLOR_FIELDS.map(({ key, label: fieldLabel, hint }) => (
          <label
            key={key}
            className="flex items-center gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-3 py-2.5"
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
              className="w-[4.5rem] shrink-0 rounded border border-[color:var(--border)] bg-[color:var(--input-bg,var(--panel))] px-2 py-1 font-mono text-[10px]"
              spellCheck={false}
            />
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--border)] pt-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || !label.trim()}
          className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save theme
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-lg border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--color-muted)] hover:text-[color:var(--fg)]"
        >
          Reset draft
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="ml-auto rounded-lg px-3 py-2 text-xs text-[color:var(--color-muted)] hover:text-[color:var(--fg)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
