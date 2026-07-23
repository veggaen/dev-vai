import { useCallback, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useShortcutsStore } from '../../../stores/shortcutsStore.js';
import {
  formatCapturedShortcut,
  getDefaultShortcut,
  GLOBAL_DICTATION_SHORTCUTS,
} from '../../../lib/keyboard-shortcuts.js';
import { SettingsCard, SettingsSection } from './SettingsShell.js';

export function ShortcutCustomizer() {
  const getAll = useShortcutsStore((s) => s.getAll);
  const setOverride = useShortcutsStore((s) => s.setOverride);
  const clearOverride = useShortcutsStore((s) => s.clearOverride);
  const resetAll = useShortcutsStore((s) => s.resetAll);
  const overrides = useShortcutsStore((s) => s.overrides);

  const shortcuts = getAll();
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const startRecording = useCallback((id: string) => {
    setRecordingId(id);
  }, []);

  const handleKeyCapture = useCallback((e: React.KeyboardEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setRecordingId(null);
      return;
    }
    const captured = formatCapturedShortcut(e.nativeEvent);
    if (!captured) return;
    if (id === 'globalDictation' && !(GLOBAL_DICTATION_SHORTCUTS as readonly string[]).includes(captured)) {
      toast.error(`Use one of: ${GLOBAL_DICTATION_SHORTCUTS.join(', ')}`);
      return;
    }
    setOverride(id as Parameters<typeof setOverride>[0], captured);
    setRecordingId(null);
    toast.success('Shortcut updated');
  }, [setOverride]);

  const categories = [
    { key: 'voice', label: 'Voice' },
    { key: 'navigation', label: 'Navigation' },
    { key: 'workspace', label: 'Workspace' },
    { key: 'panels', label: 'Panels' },
    { key: 'modes', label: 'Chat modes' },
  ] as const;

  return (
    <SettingsSection
      title="Keyboard shortcuts"
      description="Click Record, then press the key combination you want. Escape cancels. Reset restores Vai defaults."
    >
      <SettingsCard className="overflow-hidden p-0">
        <div className="flex items-center justify-end border-b border-[color:var(--border)] px-4 py-2">
          <button
            type="button"
            onClick={() => {
              resetAll();
              toast.success('Shortcuts reset to defaults');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[color:var(--color-muted)] transition-colors hover:bg-[color:var(--panel-bg-muted)] hover:text-[color:var(--fg)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset all
          </button>
        </div>

        {categories.map(({ key, label }) => {
          const items = shortcuts.filter((s) => s.category === key);
          if (items.length === 0) return null;
          return (
            <section key={key} aria-label={label}>
              <h4 className="border-b border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-subheader)]">
                {label}
              </h4>
              <ul className="list-none divide-y divide-[color:var(--border)]">
                {items.map((item) => {
                  const isRecording = recordingId === item.id;
                  const isCustom = Boolean(overrides[item.id]);
                  const isGlobalDictation = item.id === 'globalDictation';
                  return (
                    <li key={item.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[color:var(--fg)]">{item.description}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {isGlobalDictation && (
                          <select
                            aria-label="Global dictation shortcut"
                            value={item.keys}
                            onChange={(event) => {
                              const selected = event.target.value;
                              if (selected === getDefaultShortcut('globalDictation').keys) {
                                clearOverride('globalDictation');
                              } else {
                                setOverride('globalDictation', selected);
                              }
                              toast.success('Shortcut updated');
                            }}
                            className="min-w-[10rem] rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-3 py-1.5 font-mono text-[11px] text-[color:var(--fg)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-ring)]"
                          >
                            {GLOBAL_DICTATION_SHORTCUTS.map((shortcut) => (
                              <option key={shortcut} value={shortcut}>{shortcut}</option>
                            ))}
                          </select>
                        )}
                        {!isGlobalDictation && (
                          <>
                        <kbd
                          tabIndex={0}
                          onFocus={() => startRecording(item.id)}
                          onKeyDown={(e) => isRecording && handleKeyCapture(e, item.id)}
                          className={`min-w-[7rem] rounded-lg border px-3 py-1.5 text-center font-mono text-[11px] transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-ring)] ${
                            isRecording
                              ? 'border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]'
                              : 'border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] text-[color:var(--fg)]'
                          }`}
                        >
                          {isRecording ? 'Press keys…' : item.keys}
                        </kbd>
                        <button
                          type="button"
                          onClick={() => startRecording(item.id)}
                          className="rounded-lg border border-[color:var(--border)] px-2 py-1.5 text-[11px] text-[color:var(--color-muted)] hover:text-[color:var(--fg)]"
                        >
                          Record
                        </button>
                          </>
                        )}
                        {isCustom && (
                          <button
                            type="button"
                            onClick={() => clearOverride(item.id)}
                            className="rounded-lg px-2 py-1.5 text-[11px] text-[color:var(--color-muted)] hover:text-[color:var(--fg)]"
                          >
                            Default
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </SettingsCard>
    </SettingsSection>
  );
}
