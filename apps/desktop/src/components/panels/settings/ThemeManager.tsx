/**
 * Theme manager — presets, custom themes, and inline editor in one cohesive flow.
 */

import { useCallback, useState } from 'react';
import { Check, Copy, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  applyThemeById,
  deleteCustomTheme,
  duplicateCustomTheme,
  isThemeCardActive,
  listCustomThemeEntries,
  ODYSSEUS_THEME_PRESETS,
  withThemeTransition,
  type StoredCustomTheme,
} from '../../../lib/odysseus-theme.js';
import { ThemeColorEditor } from './ThemeColorEditor.js';

const BUILTIN_PRESETS = [
  { id: 'dark', label: 'Dark', swatch: ['#282c34', '#9cdef2', '#111111', '#e06c75'] },
  { id: 'light', label: 'Light', swatch: ['#f0ebe3', '#5a5248', '#faf6f0', '#c47d5a'] },
  { id: 'midnight', label: 'Midnight', swatch: ['#0d1117', '#c9d1d9', '#161b22', '#f85149'] },
  { id: 'claude', label: 'Claude', swatch: ['#262624', '#f5f4f0', '#30302e', '#c6613f'] },
  { id: 'gpt', label: 'GPT', swatch: ['#212121', '#ececec', '#171717', '#949494'] },
];

interface ThemeManagerProps {
  activeId: string;
  onActiveChange: (themeId: string) => void;
  editingId: string | null;
  onEditingChange: (id: string | null) => void;
}

export function ThemeManager({
  activeId,
  onActiveChange,
  editingId,
  onEditingChange,
}: ThemeManagerProps) {
  const [customThemes, setCustomThemes] = useState(() => listCustomThemeEntries());

  const refresh = useCallback(() => {
    setCustomThemes(listCustomThemeEntries());
  }, []);

  const selectTheme = useCallback((themeId: string) => {
    onEditingChange(null);
    withThemeTransition(() => applyThemeById(themeId));
    onActiveChange(themeId);
  }, [onActiveChange, onEditingChange]);

  const handleSaved = useCallback((themeId: string) => {
    refresh();
    selectTheme(themeId);
    toast.success('Theme saved');
  }, [refresh, selectTheme]);

  const handleDelete = useCallback((theme: StoredCustomTheme & { id: string }) => {
    if (!window.confirm(`Delete “${theme.label}”? This cannot be undone.`)) return;
    if (deleteCustomTheme(theme.id)) {
      refresh();
      if (activeId === theme.id) {
        selectTheme(theme.basePresetId in ODYSSEUS_THEME_PRESETS ? theme.basePresetId : 'dark');
      }
      if (editingId === theme.id) onEditingChange(null);
      toast.success('Theme deleted');
    }
  }, [activeId, editingId, onEditingChange, refresh, selectTheme]);

  const handleDuplicate = useCallback((theme: StoredCustomTheme & { id: string }) => {
    const newId = duplicateCustomTheme(theme.id);
    if (!newId) return;
    refresh();
    selectTheme(newId);
    toast.success('Theme duplicated');
  }, [refresh, selectTheme]);

  const editingCustom = editingId && customThemes.some((t) => t.id === editingId);
  const editingBase = editingId && BUILTIN_PRESETS.some((p) => p.id === editingId);

  return (
    <div className="space-y-6">
      <section aria-labelledby="theme-presets-heading">
        <h4 id="theme-presets-heading" className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-subheader)]">
          Presets
        </h4>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {BUILTIN_PRESETS.map((preset) => (
            <ThemeCard
              key={preset.id}
              id={preset.id}
              label={preset.label}
              swatch={preset.swatch}
              selected={isThemeCardActive(activeId, preset.id)}
              editing={editingId === preset.id}
              onSelect={() => selectTheme(preset.id)}
              onCustomize={() => onEditingChange(editingId === preset.id ? null : preset.id)}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="theme-custom-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 id="theme-custom-heading" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-subheader)]">
            Your themes
          </h4>
          <button
            type="button"
            onClick={() => onEditingChange(editingId === 'dark' ? null : 'dark')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border)] px-2.5 py-1.5 text-xs text-[color:var(--color-muted)] transition-colors hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)]"
          >
            <Plus className="h-3.5 w-3.5" />
            New from Dark
          </button>
        </div>

        {customThemes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[color:var(--border)] px-4 py-6 text-center text-sm text-[color:var(--color-muted)]">
            No custom themes yet. Pick a preset and choose Customize, or start from Dark.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {customThemes.map((theme) => (
              <div
                key={theme.id}
                className={`rounded-xl border p-3 transition-colors ${
                  isThemeCardActive(activeId, theme.id)
                    ? 'border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)]/30'
                    : 'border-[color:var(--border)] bg-[color:var(--panel)]'
                }`}
              >
                <button type="button" onClick={() => selectTheme(theme.id)} className="w-full text-left">
                  <SwatchStrip colors={[theme.bg, theme.fg, theme.panel, theme.red]} />
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm font-medium text-[color:var(--fg)]">{theme.label}</span>
                    {isThemeCardActive(activeId, theme.id) && (
                      <Check className="h-3.5 w-3.5 text-[color:var(--accent-text)]" aria-label="Active" />
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-[color:var(--color-muted)]">
                    Based on {ODYSSEUS_THEME_PRESETS[theme.basePresetId]?.label ?? theme.basePresetId}
                  </p>
                </button>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ThemeAction icon={Pencil} label="Edit" onClick={() => onEditingChange(editingId === theme.id ? null : theme.id)} />
                  <ThemeAction icon={Copy} label="Duplicate" onClick={() => handleDuplicate(theme)} />
                  <ThemeAction icon={Trash2} label="Delete" tone="danger" onClick={() => handleDelete(theme)} />
                </div>
                {editingId === theme.id && (
                  <ThemeColorEditor
                    customThemeId={theme.id}
                    onSaved={handleSaved}
                    onCancel={() => {
                      applyThemeById(activeId);
                      onEditingChange(null);
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {(editingBase || (editingId && !editingCustom)) && editingId && BUILTIN_PRESETS.some((p) => p.id === editingId) && (
        <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-medium text-[color:var(--fg)]">
              Customize {ODYSSEUS_THEME_PRESETS[editingId]?.label ?? editingId}
            </h4>
            <button type="button" onClick={() => { applyThemeById(activeId); onEditingChange(null); }} className="rounded-lg p-1 text-[color:var(--color-muted)] hover:text-[color:var(--fg)]" aria-label="Close editor">
              <X className="h-4 w-4" />
            </button>
          </div>
          <ThemeColorEditor
            basePresetId={editingId}
            onSaved={handleSaved}
            onCancel={() => {
              applyThemeById(activeId);
              onEditingChange(null);
            }}
          />
        </section>
      )}
    </div>
  );
}

function ThemeCard({
  label,
  swatch,
  selected,
  editing,
  onSelect,
  onCustomize,
}: {
  id: string;
  label: string;
  swatch: string[];
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onCustomize: () => void;
}) {
  return (
    <div className={`rounded-xl border p-3 transition-colors ${selected ? 'border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)]/25' : 'border-[color:var(--border)] bg-[color:var(--panel)]'}`}>
      <button type="button" onClick={onSelect} className="w-full text-left">
        <SwatchStrip colors={swatch} />
        <div className="mt-2 flex items-center gap-2 text-sm font-medium text-[color:var(--fg)]">
          {label}
          {selected && <Check className="h-3.5 w-3.5 text-[color:var(--accent-text)]" />}
        </div>
      </button>
      <button
        type="button"
        onClick={onCustomize}
        className={`mt-2 w-full rounded-lg border px-2 py-1.5 text-xs transition-colors ${
          editing
            ? 'border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]'
            : 'border-[color:var(--border)] text-[color:var(--color-muted)] hover:bg-[color:var(--panel-bg-muted)] hover:text-[color:var(--fg)]'
        }`}
      >
        {editing ? 'Close editor' : 'Customize'}
      </button>
    </div>
  );
}

function SwatchStrip({ colors }: { colors: string[] }) {
  return (
    <div className="flex h-10 overflow-hidden rounded-lg border border-[color:var(--border)]">
      {colors.map((color) => (
        <span key={color} className="flex-1" style={{ background: color }} />
      ))}
    </div>
  );
}

function ThemeAction({
  icon: Icon,
  label,
  onClick,
  tone = 'default',
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
        tone === 'danger'
          ? 'border-red-500/20 text-red-400 hover:bg-red-500/10'
          : 'border-[color:var(--border)] text-[color:var(--color-muted)] hover:bg-[color:var(--panel-bg-muted)] hover:text-[color:var(--fg)]'
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
