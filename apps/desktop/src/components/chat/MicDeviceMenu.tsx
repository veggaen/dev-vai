import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Mic } from 'lucide-react';
import { enumerateMicrophones } from '../../lib/voice/web-speech-adapter.js';
import type { MicDevice } from '../../lib/voice/stt-adapter.js';

interface MicDeviceMenuProps {
  /** Anchor position (where the user right-clicked), in viewport coordinates. */
  readonly at: { x: number; y: number };
  /** Currently selected device id ('' = system default). */
  readonly selectedId: string;
  readonly onSelect: (deviceId: string) => void;
  readonly onClose: () => void;
}

/**
 * Right-click microphone settings menu — the device picker that was missing when V3gga
 * right-clicked the mic icon and saw nothing.
 *
 * Lists the audio inputs from {@link enumerateMicrophones} (labels appear once mic permission
 * is granted) plus a "System default" entry, and persists the choice via the parent. Per the UI
 * rubric: dismiss on outside-click / Escape, animate transform+opacity only, every row is a real
 * button with an accessible label and a visible selected state.
 */
export function MicDeviceMenu({ at, selectedId, onSelect, onClose }: MicDeviceMenuProps) {
  const [devices, setDevices] = useState<MicDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    enumerateMicrophones()
      .then((list) => { if (alive) setDevices(list); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not list microphones.'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Clamp within the viewport so the menu never opens off-screen.
  const style: React.CSSProperties = {
    left: Math.min(at.x, window.innerWidth - 248),
    top: Math.min(at.y, window.innerHeight - 240),
  };

  const choose = (id: string) => { onSelect(id); onClose(); };

  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        role="menu"
        aria-label="Microphone settings"
        className="fixed z-50 w-60 overflow-hidden rounded-xl border border-white/10 bg-[color:var(--chat-surface,#1b1b22)] p-1 shadow-xl"
        style={style}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.12, ease: 'easeOut' }}
      >
        <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[color:var(--chat-muted)]">
          Microphone
        </div>

        <MenuRow
          label="System default"
          selected={selectedId === ''}
          onClick={() => choose('')}
        />

        {devices === null && !error && (
          <div className="px-3 py-2 text-xs text-[color:var(--chat-muted)]">Listing devices…</div>
        )}
        {error && (
          <div className="px-3 py-2 text-xs text-[color:var(--danger-text,#f88)]">{error}</div>
        )}
        {devices?.length === 0 && (
          <div className="px-3 py-2 text-xs text-[color:var(--chat-muted)]">No microphones found.</div>
        )}
        {devices?.map((d) => (
          <MenuRow
            key={d.deviceId}
            label={d.label}
            selected={selectedId === d.deviceId}
            onClick={() => choose(d.deviceId)}
          />
        ))}
      </motion.div>
    </AnimatePresence>
  );
}

function MenuRow({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[color:var(--chat-body)] transition-colors hover:bg-white/[0.06]"
    >
      <Mic className="h-3.5 w-3.5 shrink-0 text-[color:var(--chat-muted)]" aria-hidden="true" />
      <span className="flex-1 truncate">{label}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent-text)]" aria-hidden="true" />}
    </button>
  );
}

export default MicDeviceMenu;
