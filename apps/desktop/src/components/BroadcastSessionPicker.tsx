/**
 * BroadcastSessionPicker — Compact dropdown for selecting which chat session
 * to target within the connected IDE (e.g. "IMPROVING VAIS RESPONSE QUALITY").
 */

import { useMemo } from 'react';
import { Hash } from 'lucide-react';
import { CompactCombobox, type ComboboxItem } from './CompactCombobox.js';

export interface ChatSessionInfo {
  sessionId: string;
  title: string;
  lastModified: number;
  chatApp: string;
}

interface BroadcastSessionPickerProps {
  sessions: ChatSessionInfo[];
  /** Filter sessions to this chat app id (optional) */
  chatAppFilter?: string;
  value: string;
  onChange: (sessionId: string) => void;
}

export function BroadcastSessionPicker({ sessions, chatAppFilter, value, onChange }: BroadcastSessionPickerProps) {
  const filtered = useMemo(() => {
    const list = chatAppFilter ? sessions.filter((s) => s.chatApp === chatAppFilter) : sessions;
    return [...list].sort((a, b) => b.lastModified - a.lastModified);
  }, [sessions, chatAppFilter]);

  const items = useMemo<ComboboxItem[]>(() => {
    return filtered.map((s) => {
      const age = Date.now() - s.lastModified;
      const hint = age < 60_000 ? 'just now'
        : age < 3600_000 ? `${Math.floor(age / 60_000)}m ago`
        : age < 86400_000 ? `${Math.floor(age / 3600_000)}h ago`
        : `${Math.floor(age / 86400_000)}d ago`;

      return {
        id: s.sessionId,
        label: s.title || 'Untitled Session',
        hint,
        icon: (
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-500/10">
            <Hash className="h-3 w-3 text-amber-400/70" />
          </div>
        ),
      };
    });
  }, [filtered]);

  const hasSessions = filtered.length > 0;
  const selectedTitle = filtered.find((s) => s.sessionId === value)?.title;
  const triggerLabel = selectedTitle
    ? (selectedTitle.length > 20 ? selectedTitle.slice(0, 20) + '…' : selectedTitle)
    : 'New session';

  return (
    <CompactCombobox
      items={items}
      value={value}
      onChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      placeholder={triggerLabel}
      searchPlaceholder="Search sessions…"
      accent="amber"
      triggerIcon={<Hash className="h-3 w-3 text-amber-400/60" />}
      dropdownWidth="w-72"
      maxHeight={280}
      position="above"
      emptyMessage={chatAppFilter ? 'No sessions for this app yet' : 'No sessions available yet'}
      disabled={!hasSessions}
    />
  );
}
