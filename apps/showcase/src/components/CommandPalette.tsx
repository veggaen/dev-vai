import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SECTIONS } from './Nav';

export type PaletteAction = {
  id: string;
  label: string;
  hint: string;
  run: () => void;
};

export default function CommandPalette({
  open,
  onClose,
  onWarp,
  onHue,
}: {
  open: boolean;
  onClose: () => void;
  onWarp: () => void;
  onHue: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions = useMemo<PaletteAction[]>(
    () => [
      ...SECTIONS.map((s) => ({
        id: `goto-${s.id}`,
        label: `Go to ${s.label}`,
        hint: 'navigate',
        run: () => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' }),
      })),
      { id: 'warp', label: 'Toggle hyperdrive', hint: 'mode', run: onWarp },
      { id: 'hue', label: 'Shift accent spectrum', hint: 'theme', run: onHue },
      { id: 'top', label: 'Back to top', hint: 'navigate', run: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
      {
        id: 'copy',
        label: 'Copy page URL',
        hint: 'share',
        run: () => void navigator.clipboard?.writeText(window.location.href).catch(() => undefined),
      },
    ],
    [onWarp, onHue],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(q) || a.hint.includes(q));
  }, [actions, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setCursor(0), [query]);

  const commit = (action?: PaletteAction) => {
    if (!action) return;
    onClose();
    // let the exit animation start before scrolling
    setTimeout(action.run, 80);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(filtered[cursor]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-4 pt-[16vh] backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          data-testid="palette-overlay"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -10 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="glass w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl shadow-black/60"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            data-testid="palette"
          >
            <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
              <span className="text-pulse-400">⌘</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Type a command…"
                className="w-full bg-transparent text-sm text-white placeholder-zinc-500 outline-none"
                data-testid="palette-input"
              />
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">esc</kbd>
            </div>
            <ul className="max-h-72 overflow-y-auto p-2" role="listbox">
              {filtered.length === 0 && (
                <li className="px-4 py-6 text-center font-mono text-xs text-zinc-500">no signal on that frequency</li>
              )}
              {filtered.map((a, i) => (
                <li key={a.id} role="option" aria-selected={i === cursor}>
                  <button
                    onClick={() => commit(a)}
                    onMouseEnter={() => setCursor(i)}
                    data-action={a.id}
                    className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm transition-colors ${
                      i === cursor ? 'bg-white/10 text-white' : 'text-zinc-400'
                    }`}
                  >
                    <span>{a.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">{a.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
