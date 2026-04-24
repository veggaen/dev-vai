/**
 * BroadcastChatAppPicker — Compact dropdown for selecting which chat app
 * to target in the connected IDE (e.g. Chat, Claude, Augment, @vai).
 */

import { useMemo } from 'react';
import { MessageSquare } from 'lucide-react';
import { CompactCombobox, type ComboboxItem } from './CompactCombobox.js';

const APP_COLORS: Record<string, string> = {
  chat: '#007ACC',
  '@vai': '#10B981',
  claude: '#D97706',
  augment: '#10B981',
  continue: '#A855F7',
};

export interface ChatAppInfo {
  id: string;
  label: string;
}

interface BroadcastChatAppPickerProps {
  chatApps: ChatAppInfo[];
  value: string;
  onChange: (appId: string) => void;
}

export function BroadcastChatAppPicker({ chatApps, value, onChange }: BroadcastChatAppPickerProps) {
  const items = useMemo<ComboboxItem[]>(() => {
    return chatApps.map((app) => {
      const color = APP_COLORS[app.id.toLowerCase()] ?? '#6B7280';
      return {
        id: app.id,
        label: app.label,
        icon: (
          <div
            className="flex h-5 w-5 items-center justify-center rounded-md"
            style={{ backgroundColor: `${color}20` }}
          >
            <MessageSquare className="h-3 w-3" style={{ color }} />
          </div>
        ),
      };
    });
  }, [chatApps]);

  const selectedLabel = chatApps.find((a) => a.id === value)?.label || 'Chat';

  return (
    <CompactCombobox
      items={items}
      value={value}
      onChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      placeholder={selectedLabel}
      searchPlaceholder="Search apps…"
      accent="sky"
      triggerIcon={<MessageSquare className="h-3 w-3 text-sky-400/60" />}
      dropdownWidth="w-48"
      maxHeight={200}
      position="above"
    />
  );
}
