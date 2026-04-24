/**
 * BroadcastTargetPicker — IDE type selector.
 *
 * Shows IDE types (VS Code, Cursor, Antigravity) from connected companion clients.
 * Each entry represents one IDE type (deduplicated on the backend).
 * Online/offline status is shown. Multi-select: pick which IDE types to target.
 *
 * Chat app and session selection are handled by separate pickers in the strip.
 */

import { useMemo, useCallback } from 'react';
import { Monitor, Plus, Check } from 'lucide-react';
import { CompactCombobox, type ComboboxItem } from './CompactCombobox.js';
import type { CompanionClientSummary } from '../stores/collabStore.js';

/* ── IDE icon colors ─────────────────────────────────────────── */

const IDE_COLORS: Record<string, string> = {
  vscode: '#007ACC',
  cursor: '#00D1B2',
  claude: '#D97706',
  antigravity: '#A855F7',
  augment: '#10B981',
};

function ideBadgeColor(target: string): string {
  return IDE_COLORS[target.toLowerCase()] ?? '#6B7280';
}

/* ── Per-IDE configuration (kept for API compat) ─────────────── */

export interface PerIdeConfig {
  clientId: string;
  chatMode: string;
  sessionId: string;
}

/* ── IDE display names ───────────────────────────────────────── */

const IDE_LABELS: Record<string, string> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  desktop: 'Desktop',
};

function ideLabel(target: string): string {
  return IDE_LABELS[target.toLowerCase()] ?? target;
}

/* ── Props ────────────────────────────────────────────────────── */

interface BroadcastTargetPickerProps {
  clients: CompanionClientSummary[];
  value: string[];
  onChange: (ids: string[]) => void;
  onConnectIde?: () => void;
  perIdeConfigs: PerIdeConfig[];
  onPerIdeConfigChange: (configs: PerIdeConfig[]) => void;
}

/* ── Helpers ──────────────────────────────────────────────────── */

function isClientOnline(c: CompanionClientSummary): boolean {
  const thirtyMinAgo = Date.now() - 30 * 60_000;
  const lastActivity = Math.max(
    c.lastPolledAt ? new Date(c.lastPolledAt).getTime() : 0,
    c.lastSeenAt ? new Date(c.lastSeenAt).getTime() : 0,
  );
  return lastActivity > thirtyMinAgo;
}

/* ── Component ───────────────────────────────────────────────── */

export function BroadcastTargetPicker({
  clients,
  value,
  onChange,
  onConnectIde,
}: BroadcastTargetPickerProps) {

  /** Build the items list — one per IDE type */
  const allItems = useMemo<ComboboxItem[]>(() => {
    const onlineClients = clients.filter(isClientOnline);

    // "All IDEs" aggregate option when multiple are online
    const header: ComboboxItem[] = onlineClients.length > 1
      ? [{
          id: '__all__',
          label: `All IDEs (${onlineClients.length})`,
          hint: '●',
          icon: (
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/10">
              <Monitor className="h-3 w-3 text-emerald-400" />
            </div>
          ),
        }]
      : [];

    const items: ComboboxItem[] = clients.map((c) => {
      const online = isClientOnline(c);
      const color = ideBadgeColor(c.launchTarget);
      return {
        id: c.id,
        label: ideLabel(c.launchTarget),
        hint: online ? '● online' : '○ offline',
        icon: (
          <div
            className="flex h-5 w-5 items-center justify-center rounded-md"
            style={{ backgroundColor: `${color}20` }}
          >
            <Monitor className="h-3 w-3" style={{ color }} />
          </div>
        ),
        disabled: !online,
      };
    });

    return [...header, ...items];
  }, [clients]);

  /** Handle selection */
  const handleChange = useCallback((next: string | string[]) => {
    const arr = Array.isArray(next) ? next : [next];
    const ideIds = arr.filter((id) => !id.startsWith('hdr:'));

    // "All IDEs" toggle
    if (ideIds.includes('__all__') && !value.includes('__all__')) {
      const onlineIds = clients.filter(isClientOnline).map((c) => c.id);
      onChange(['__all__', ...onlineIds]);
    } else if (!ideIds.includes('__all__') && value.includes('__all__')) {
      onChange([]);
    } else {
      onChange(ideIds.filter((id) => id !== '__all__'));
    }
  }, [value, clients, onChange]);

  /** Custom item rendering */
  const renderItem = useCallback((item: ComboboxItem, selected: boolean) => {
    return (
      <>
        {item.icon && <span className="shrink-0">{item.icon}</span>}
        <span className={`flex-1 truncate text-xs ${
          selected ? 'text-violet-200' : 'text-zinc-300'
        }`}>
          {item.label}
        </span>
        {item.hint && (
          <span className={`shrink-0 text-[10px] ${
            item.hint.startsWith('●') ? 'text-emerald-400/70' : 'text-zinc-600'
          }`}>
            {item.hint}
          </span>
        )}
        {selected && (
          <Check className="h-3 w-3 shrink-0 text-emerald-400" />
        )}
      </>
    );
  }, []);

  const selectedCount = value.filter((id) => id !== '__all__').length;
  const triggerLabel = selectedCount === 0
    ? 'Send to…'
    : selectedCount === clients.length && clients.length > 1
      ? 'All IDEs'
      : selectedCount === 1
        ? ideLabel(clients.find((c) => c.id === value.find((id) => id !== '__all__'))?.launchTarget || '')
        : `${selectedCount} IDEs`;

  return (
    <div className="flex items-center gap-1">
      <CompactCombobox
        items={allItems}
        value={value}
        onChange={handleChange}
        placeholder={triggerLabel}
        searchPlaceholder="Search IDEs…"
        multi
        accent="violet"
        triggerIcon={<Monitor className="h-3 w-3 text-violet-400/60" />}
        dropdownWidth="w-56"
        maxHeight={280}
        position="above"
        renderItem={renderItem}
      />

      {onConnectIde && (
        <button
          onClick={onConnectIde}
          className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg border border-dashed border-zinc-700/60 text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-300"
          title="Connect IDE"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
