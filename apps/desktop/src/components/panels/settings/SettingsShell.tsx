/**
 * Odysseus-style settings shell — left nav, right panel content.
 * Rendered inside the wide SettingsDrawer (~80% viewport).
 */

import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Settings2 } from 'lucide-react';
import {
  isThemeCardActive,
  ODYSSEUS_THEME_PRESETS,
} from '../../../lib/odysseus-theme.js';
import { ThemeColorEditor } from './ThemeColorEditor.js';

export type SettingsTabId =
  | 'appearance'
  | 'ai'
  | 'integrations'
  | 'engine'
  | 'shortcuts'
  | 'account';

interface SettingsNavItem {
  id: SettingsTabId;
  label: string;
  icon: ReactNode;
  ownerOnly?: boolean;
}

const NAV_ITEMS: SettingsNavItem[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a7 7 0 0 0 0 20 4 4 0 0 1 0-8 4 4 0 0 0 0-8" />
      </svg>
    ),
  },
  {
    id: 'ai',
    label: 'AI Defaults',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z" />
      </svg>
    ),
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
  {
    id: 'engine',
    label: 'Engine',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    ownerOnly: true,
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
      </svg>
    ),
  },
  {
    id: 'account',
    label: 'Account',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    ownerOnly: true,
  },
];

export function SettingsShell({
  activeTab,
  onTabChange,
  showOwnerSections,
  children,
}: {
  activeTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  showOwnerSections: boolean;
  children: ReactNode;
}) {
  const visibleNav = NAV_ITEMS.filter((item) => !item.ownerOnly || showOwnerSections);

  return (
    <div className="settings-shell flex h-full min-h-0 items-stretch">
      <nav className="settings-nav flex h-full w-52 shrink-0 flex-col gap-1 self-stretch border-r border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] p-3">
        {visibleNav.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={`settings-nav-item flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${
              activeTab === item.id
                ? 'bg-[color:var(--accent-soft)] text-[color:var(--fg)]'
                : 'text-[color:var(--color-muted)] hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)]'
            }`}
          >
            <span className="shrink-0 opacity-85">{item.icon}</span>
            <span className="min-w-0 truncate">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="settings-panel min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5 md:px-8 md:py-6">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </div>
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8 last:mb-0">
      <h3 className="text-base font-semibold text-[color:var(--fg)]">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-2xl text-[13px] leading-6 text-[color:var(--color-muted)]">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[color:var(--border)] bg-[color:var(--panel)] p-4 md:p-5 ${className}`}>
      {children}
    </div>
  );
}

export function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-subheader)]">
        {label}
      </label>
      {hint && <p className="text-xs leading-5 text-[color:var(--color-muted)]">{hint}</p>}
      {children}
    </div>
  );
}

export function SettingsSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--input-bg,var(--panel))] px-3 py-2.5 text-sm text-[color:var(--fg)] transition-colors focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-ring)] ${props.className ?? ''}`}
    />
  );
}

export function SettingsSwitch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[color:var(--fg)]">{label}</div>
        {description && (
          <div className="mt-1 text-xs leading-5 text-[color:var(--color-muted)]">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
          checked ? 'bg-[color:var(--accent)]' : 'bg-[color:var(--panel-bg-muted)]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-[color:var(--bg)] shadow transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export function SettingsShortcutRow({ keys, description }: { keys: string; description: string }) {
  return (
    <div className="flex flex-col gap-2 border-b border-[color:var(--border)] px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="min-w-0 flex-1 text-[13px] leading-5 text-[color:var(--color-muted)]">{description}</span>
      <kbd className="shrink-0 self-start rounded-md border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-2.5 py-1 font-mono text-[11px] text-[color:var(--fg)] sm:self-center">
        {keys}
      </kbd>
    </div>
  );
}

export function ThemePresetGrid({
  activeId,
  onSelect,
  editingPresetId,
  onStartEdit,
  onEndEdit,
  onThemeSaved,
  customThemes = [],
}: {
  activeId: string;
  onSelect: (id: string) => void;
  editingPresetId: string | null;
  onStartEdit: (basePresetId: string) => void;
  onEndEdit: () => void;
  onThemeSaved: (themeId: string) => void;
  customThemes?: { id: string; label: string; swatch: string[]; basePresetId: string }[];
}) {
  const presets = [
    { id: 'dark', label: 'Dark', swatch: ['#282c34', '#9cdef2', '#111111', '#e06c75'] },
    { id: 'light', label: 'Light', swatch: ['#f0ebe3', '#5a5248', '#faf6f0', '#c47d5a'] },
    { id: 'midnight', label: 'Midnight', swatch: ['#0d1117', '#c9d1d9', '#161b22', '#f85149'] },
    { id: 'claude', label: 'Claude', swatch: ['#262624', '#f5f4f0', '#30302e', '#c6613f'] },
    { id: 'gpt', label: 'GPT', swatch: ['#212121', '#ececec', '#171717', '#949494'] },
  ];

  const renderCard = (
    preset: { id: string; label: string; swatch: string[] },
    basePresetId: string,
    isCustom = false,
  ) => {
    const cardId = preset.id;
    const isEditing = !isCustom && editingPresetId === basePresetId;
    const selected = isThemeCardActive(activeId, cardId);

    return (
    <div
      key={preset.id}
      className={`group relative rounded-xl border transition-colors ${
        isEditing ? 'col-span-full border-[color:var(--accent)] bg-[color:var(--accent-soft)] p-4' : 'p-3'
      } ${
        selected && !isEditing
          ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] ring-1 ring-[color:var(--accent)]'
          : 'border-[color:var(--border)] bg-[color:var(--panel)] hover:border-[color:var(--accent)]'
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onSelect(cardId)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="mb-2.5 flex h-10 overflow-hidden rounded-lg border border-[color:var(--border)]">
            {preset.swatch.map((color) => (
              <span key={color} className="flex-1" style={{ background: color }} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[color:var(--fg)]">{preset.label}</span>
            {isCustom && (
              <span className="rounded-full border border-[color:var(--border)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[color:var(--color-muted)]">
                Custom
              </span>
            )}
          </div>
        </button>

        {!isCustom && (
          <button
            type="button"
            onClick={() => (isEditing ? onEndEdit() : onStartEdit(basePresetId))}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all ${
              isEditing
                ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--fg)]'
                : 'border-[color:var(--border)] bg-[color:var(--panel)] text-[color:var(--color-muted)] opacity-0 hover:border-[color:var(--accent)] hover:text-[color:var(--fg)] group-hover:opacity-100 focus:opacity-100'
            }`}
            title={isEditing ? 'Close color editor' : `Customize ${ODYSSEUS_THEME_PRESETS[basePresetId]?.label ?? basePresetId}`}
            aria-label={isEditing ? 'Close color editor' : `Customize ${preset.label}`}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isEditing && (
        <ThemeColorEditor
          basePresetId={basePresetId}
          onSaved={(themeId) => {
            onThemeSaved(themeId);
            onEndEdit();
          }}
          onCancel={onEndEdit}
        />
      )}
    </div>
  );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {presets.map((preset) => renderCard(preset, preset.id))}
      </div>

      {customThemes.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-subheader)]">
            Your themes
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {customThemes.map((theme) => renderCard(theme, theme.basePresetId, true))}
          </div>
        </div>
      )}
    </div>
  );
}
