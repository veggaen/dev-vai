/**
 * Odysseus-style settings shell — left nav, right panel content.
 * Rendered inside the wide SettingsDrawer (~80% viewport).
 */

import { useMemo, useState } from 'react';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import {
  Palette,
  Bot,
  Link2,
  Cog,
  Keyboard,
  User,
  Mic,
  Pencil,
  Search,
  Settings2,
  ShieldCheck,
  X as XIcon,
} from 'lucide-react';
import {
  isThemeCardActive,
  ODYSSEUS_THEME_PRESETS,
} from '../../../lib/odysseus-theme.js';
import { ThemeColorEditor } from './ThemeColorEditor.js';

export type SettingsTabId =
  | 'appearance'
  | 'ai'
  | 'voice'
  | 'integrations'
  | 'operations'
  | 'engine'
  | 'shortcuts'
  | 'account';

interface SettingsNavItem {
  id: SettingsTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly?: boolean;
}

const NAV_ITEMS: SettingsNavItem[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'ai', label: 'AI defaults', icon: Bot },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'integrations', label: 'Integrations', icon: Link2 },
  { id: 'operations', label: 'Workspace & trust', icon: ShieldCheck },
  { id: 'engine', label: 'Engine', icon: Cog, ownerOnly: true },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'account', label: 'Account', icon: User, ownerOnly: true },
];

/**
 * Searchable keyword index per settings section, so typing "mic", "hotkey" or
 * "dark mode" finds the right tab even when the word isn't in the tab label.
 * Kept here (next to NAV_ITEMS) so a new section must add its keywords in the
 * same place it registers its nav entry.
 */
const SETTINGS_SEARCH_INDEX: Record<SettingsTabId, string> = {
  appearance:
    'appearance theme themes color colors dark light midnight claude gpt preset custom font density background accent swatch',
  ai: 'ai defaults model models council roundtable seats depth process quick balanced deep response reasoning system prompt',
  voice:
    'voice dictation mic microphone speech speak talk transcribe transcription whisper stt tts text to speech read aloud audio input device vocabulary language',
  integrations:
    'integrations connect ollama api key cloud openai anthropic extension browser vscode companion mcp',
  operations:
    'workspace trust security capability health degraded environment remote pairing ssh memory skills personas compare sharing publish backlinks graph export hardware models',
  engine:
    'engine runtime memory knowledge ingest retrieval index database learning training owner',
  shortcuts: 'shortcuts keyboard hotkey keys keybinding binding customize send steer',
  account: 'account profile login sign out email password owner session',
};

function matchesSettingsQuery(item: SettingsNavItem, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = `${item.label.toLowerCase()} ${SETTINGS_SEARCH_INDEX[item.id] ?? ''}`;
  return terms.every((term) => haystack.includes(term));
}

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
  const [query, setQuery] = useState('');
  const availableNav = NAV_ITEMS.filter((item) => !item.ownerOnly || showOwnerSections);
  const visibleNav = useMemo(
    () => availableNav.filter((item) => matchesSettingsQuery(item, query)),
    // availableNav is derived from a constant + boolean, so showOwnerSections is the real dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, showOwnerSections],
  );

  return (
    <div className="settings-shell flex h-full min-h-0 items-stretch max-[640px]:flex-col">
      <nav className="settings-nav flex h-full w-52 shrink-0 flex-col gap-1 self-stretch border-r border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] p-3 max-[640px]:h-auto max-[640px]:w-full max-[640px]:flex-row max-[640px]:overflow-x-auto max-[640px]:border-b max-[640px]:border-r-0 max-[640px]:p-2" aria-label="Settings sections">
        <div className="relative mb-2 max-[640px]:hidden">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--color-muted)]" aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              } else if (e.key === 'Enter' && visibleNav.length > 0) {
                onTabChange(visibleNav[0].id);
              }
            }}
            placeholder="Search settings"
            aria-label="Search settings"
            className="w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--input-bg,var(--panel))] py-2 pl-8 pr-7 text-[12px] text-[color:var(--fg)] placeholder:text-[color:var(--color-muted)] focus:border-[color:var(--accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-ring)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear settings search"
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-[color:var(--color-muted)] transition-colors hover:text-[color:var(--fg)]"
            >
              <XIcon className="h-3 w-3" />
            </button>
          )}
        </div>
        {visibleNav.length === 0 && (
          <p className="px-3 py-4 text-center text-[11px] leading-5 text-[color:var(--color-muted)]">
            Nothing matches “{query.trim()}”.
          </p>
        )}
        {visibleNav.map((item) => {
          const Icon = item.icon;
          return (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            aria-current={activeTab === item.id ? 'page' : undefined}
            className={`settings-nav-item flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium max-[640px]:shrink-0 max-[640px]:py-2 ${
              activeTab === item.id
                ? 'is-active text-[color:var(--fg)]'
                : 'text-[color:var(--color-muted)] hover:bg-[color:var(--panel)] hover:text-[color:var(--fg)]'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0 opacity-85" aria-hidden />
            <span className="min-w-0 truncate">{item.label}</span>
          </button>
          );
        })}
      </nav>

      <div className="settings-panel min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 md:px-8 md:py-6">
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
    { id: 'dark', label: 'Vai Ink', swatch: ['#0b0d10', '#f2eee8', '#15181d', '#ff6b5f'] },
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
    const isEditing = isCustom
      ? editingPresetId === cardId
      : editingPresetId === basePresetId;
    const selected = isThemeCardActive(activeId, cardId);

    return (
    <div
      key={preset.id}
      className={`vai-selection-surface group relative rounded-xl ${
        isEditing ? 'is-editing col-span-full p-4' : 'p-3'
      } ${selected && !isEditing ? 'is-selected' : ''}`}
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

        <button
          type="button"
          onClick={() => (isEditing ? onEndEdit() : onStartEdit(isCustom ? cardId : basePresetId))}
          className={`vai-selection-control flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            isEditing
              ? 'is-active text-[color:var(--fg)]'
              : 'text-[color:var(--color-muted)] opacity-0 hover:text-[color:var(--fg)] group-hover:opacity-100 focus:opacity-100'
          }`}
          title={
            isEditing
              ? 'Close editor'
              : isCustom
                ? `Edit ${preset.label}`
                : `Customize ${ODYSSEUS_THEME_PRESETS[basePresetId]?.label ?? basePresetId}`
          }
          aria-label={isEditing ? 'Close editor' : isCustom ? `Edit ${preset.label}` : `Customize ${preset.label}`}
        >
          {isCustom ? <Pencil className="h-3.5 w-3.5" /> : <Settings2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      {isEditing && (
        <ThemeColorEditor
          basePresetId={isCustom ? undefined : basePresetId}
          customThemeId={isCustom ? cardId : undefined}
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
