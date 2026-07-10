/**
 * VaiShell — the minimal, futuristic app shell.
 *
 * Calm by default: a single luminous V-emblem and one input dock. Everything else is
 * hidden and REVEALS through navigation —
 *   • sweep to the left edge → a slim icons-only rail springs in (primary destinations);
 *   • press ⌘K / Ctrl+K → a command palette surfaces every feature (search + arrow-keys),
 *     so the surface stays empty while the whole app is one keystroke away.
 *
 * Motion is soft and spring-eased (framer-motion); ambient loops (breathe/spin/pulse)
 * are CSS and respect prefers-reduced-motion. Actions are dispatched as window
 * CustomEvents so the shell stays decoupled from the feature implementations.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Home, Mic, FolderGit2, Settings, Palette, MessageSquarePlus, Search, CornerDownLeft,
} from 'lucide-react';
import { VaiMark } from '../brand/VaiMark.js';

const SPRING = { type: 'spring', stiffness: 420, damping: 34 } as const;

interface Command {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly Icon: typeof Home;
  readonly event: string;
}

const COMMANDS: readonly Command[] = [
  { id: 'new', label: 'New chat', hint: 'Ctrl+N', Icon: MessageSquarePlus, event: 'vai:new-chat' },
  { id: 'dictate', label: 'Dictate', hint: 'Hold Ctrl+Shift+Space', Icon: Mic, event: 'vai:start-dictation' },
  { id: 'workspace', label: 'Open workspace', hint: 'Ctrl+Shift+O', Icon: FolderGit2, event: 'vai:open-workspace' },
  { id: 'themes', label: 'Themes', Icon: Palette, event: 'vai:open-themes' },
  { id: 'voice', label: 'Voice settings', Icon: Settings, event: 'vai:open-voice-settings' },
];

const NAV: readonly Command[] = [
  COMMANDS[0], COMMANDS[1], COMMANDS[2],
];

function run(cmd: Command): void {
  window.dispatchEvent(new CustomEvent(cmd.event));
}

export function VaiShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [navActive, setNavActive] = useState('new');
  const inputRef = useRef<HTMLInputElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
  }, [query]);

  // ⌘K / Ctrl+K opens the palette; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        setQuery('');
        setActive(0);
      } else if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen]);

  useEffect(() => {
    if (paletteOpen) requestAnimationFrame(() => paletteInputRef.current?.focus());
  }, [paletteOpen]);

  const onPaletteKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') {
      const cmd = results[active];
      if (cmd) { run(cmd); setPaletteOpen(false); }
    }
  }, [results, active]);

  return (
    <div className="vai-shell relative h-full w-full overflow-hidden">
      <style>{`
        .vai-shell{background:radial-gradient(120% 80% at 50% 8%,#101725 0%,#0A0C11 42%,#06070A 100%);}
        .vai-shell .stars{position:absolute;inset:0;opacity:.5;animation:vsDrift 22s linear infinite;
          background-image:radial-gradient(1px 1px at 20% 30%,rgba(255,255,255,.5),transparent),
            radial-gradient(1px 1px at 72% 22%,rgba(255,255,255,.35),transparent),
            radial-gradient(1px 1px at 82% 62%,rgba(255,255,255,.4),transparent),
            radial-gradient(1px 1px at 33% 74%,rgba(255,255,255,.3),transparent),
            radial-gradient(1px 1px at 55% 46%,rgba(255,255,255,.25),transparent);}
        @keyframes vsDrift{to{transform:translateY(-12px)}}
        .vai-shell .glow{background:radial-gradient(circle,rgba(139,92,246,.30),rgba(34,211,238,.10) 45%,transparent 68%);
          filter:blur(8px);animation:vsBreathe 5s cubic-bezier(.22,1,.36,1) infinite}
        @keyframes vsBreathe{0%,100%{opacity:.7;transform:scale(.96)}50%{opacity:1;transform:scale(1.06)}}
        .vai-shell .arc{transform-origin:center;animation:vsSpin 14s linear infinite}
        @keyframes vsSpin{to{transform:rotate(360deg)}}
        @media (prefers-reduced-motion:reduce){.vai-shell .stars,.vai-shell .glow,.vai-shell .arc{animation:none}}
      `}</style>
      <div className="stars" aria-hidden />

      {/* ── centre emblem ── */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-7">
        <div className="relative grid h-44 w-44 place-items-center">
          <div className="glow absolute -inset-10 rounded-full" aria-hidden />
          <svg viewBox="0 0 176 176" fill="none" className="absolute inset-0">
            <defs><linearGradient id="vsArc" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#8B5CF6" /><stop offset="1" stopColor="#22D3EE" /></linearGradient></defs>
            <circle cx="88" cy="88" r="82" stroke="rgba(255,255,255,.10)" strokeWidth="1.5" />
            <circle className="arc" cx="88" cy="88" r="82" stroke="url(#vsArc)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="160 360" />
          </svg>
          <VaiMark size={76} animated />
        </div>
        <div className="pl-[.5em] text-[15px] font-medium uppercase tracking-[.5em] text-[color:var(--chat-muted,#7E8590)]">Vai</div>
      </div>

      {/* ── edge-reveal rail ── */}
      <motion.div initial="rest" whileHover="open" className="absolute inset-y-0 left-0 z-20 w-16">
        <div className="pointer-events-none absolute inset-y-[22%] left-0 w-[2px] rounded bg-gradient-to-b from-transparent via-violet-500/70 to-transparent opacity-60" />
        <motion.nav
          variants={{ rest: { x: '-140%', opacity: 0 }, open: { x: 0, opacity: 1 } }}
          transition={SPRING}
          className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col gap-1.5 rounded-2xl border border-white/10 bg-[#0c0e13]/75 p-2 shadow-2xl backdrop-blur-xl"
          aria-label="Primary navigation"
        >
          {NAV.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { setNavActive(c.id); run(c); }}
              className={`group relative grid h-10 w-10 place-items-center rounded-xl transition-colors ${
                navActive === c.id ? 'text-cyan-300' : 'text-[color:var(--chat-muted,#7E8590)] hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <c.Icon size={19} className="transition-transform duration-300 group-hover:scale-110" />
              <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 translate-x-[-4px] whitespace-nowrap rounded-lg border border-white/10 bg-[#181C23] px-2 py-1 text-[11.5px] opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100">
                {c.label}
              </span>
            </button>
          ))}
        </motion.nav>
      </motion.div>

      {/* ── bottom input dock ── */}
      <div className="absolute inset-x-0 bottom-7 z-10 flex justify-center">
        <div className="flex w-[min(560px,82%)] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 backdrop-blur-xl transition-all duration-500 focus-within:-translate-y-0.5 focus-within:border-violet-500/50 focus-within:bg-white/[0.06] focus-within:shadow-[0_0_0_4px_rgba(139,92,246,.12),0_18px_50px_rgba(0,0,0,.5)]">
          <input
            ref={inputRef}
            type="text"
            placeholder="Ask, speak, or press ⌘K…"
            aria-label="Ask Vai"
            className="min-w-0 flex-1 bg-transparent text-[14.5px] text-[color:var(--chat-body,#EAECEF)] outline-none placeholder:text-[color:var(--chat-muted,#7E8590)]"
          />
          <button type="button" onClick={() => run(COMMANDS[1])} title="Hold to dictate" className="grid h-[34px] w-[34px] place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-[#06070A] transition-transform duration-300 hover:scale-105">
            <Mic size={17} />
          </button>
        </div>
      </div>

      {/* ── command palette ── */}
      <AnimatePresence>
        {paletteOpen && (
          <motion.div
            className="absolute inset-0 z-40 flex items-start justify-center pt-[16vh]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setPaletteOpen(false)}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <motion.div
              className="relative w-[min(560px,90%)] overflow-hidden rounded-2xl border border-white/10 bg-[#0c0e13]/90 shadow-2xl backdrop-blur-2xl"
              initial={{ y: 10, scale: .98, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 8, scale: .98, opacity: 0 }}
              transition={SPRING}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
                <Search size={16} className="text-[color:var(--chat-muted,#7E8590)]" />
                <input
                  ref={paletteInputRef}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                  onKeyDown={onPaletteKey}
                  placeholder="Search Vai…"
                  className="flex-1 bg-transparent text-[14px] text-[color:var(--chat-body,#EAECEF)] outline-none placeholder:text-[color:var(--chat-muted,#7E8590)]"
                />
              </div>
              <div className="max-h-[46vh] overflow-auto p-1.5">
                {results.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => { run(c); setPaletteOpen(false); }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      i === active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <c.Icon size={17} className="text-[color:var(--chat-muted,#9AA0AA)]" />
                    <span className="flex-1 text-[13.5px] text-[color:var(--chat-body,#EAECEF)]">{c.label}</span>
                    {c.hint && <span className="text-[11px] text-[color:var(--chat-muted,#6A707B)]">{c.hint}</span>}
                    {i === active && <CornerDownLeft size={13} className="text-[color:var(--chat-muted,#6A707B)]" />}
                  </button>
                ))}
                {results.length === 0 && (
                  <div className="px-3 py-6 text-center text-[12.5px] text-[color:var(--chat-muted,#6A707B)]">No matches</div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default VaiShell;
