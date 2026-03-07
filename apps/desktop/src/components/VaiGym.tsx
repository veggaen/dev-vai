/**
 * VaiGym — The Vai Training Gymnasium.
 *
 * Converts the ztemp_mds/vai-training-gymnasium.jsx artifact into
 * a production TSX component with Tailwind styling, Zustand state,
 * and server-side API calls for grading/generation.
 *
 * Views: dashboard | training | review | foundations | history
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, Target, Dna, ScrollText, RotateCcw, Sparkles,
  Dices, Send, ArrowLeft, Eye, Flame, Zap, Orbit, Grid3x3,
} from 'lucide-react';
import {
  useVaiGymStore,
  FOUNDATIONS, ANTI_PATTERNS, DIFFICULTY_LEVELS, SCORE_DIMENSIONS, SCENARIO_BANK,
} from '../stores/vaiGymStore.js';
import { runVisualTrainingRound } from './VaiGymRunner.js';

/* ── Abort controller for visual runner ───────────────────────── */

let runnerAbort: AbortController | null = null;

/* ── Nav tabs ──────────────────────────────────────────────────── */

const NAV_TABS = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: BarChart3 },
  { id: 'training' as const, label: 'Train', icon: Target },
  { id: 'foundations' as const, label: 'Foundations', icon: Dna },
  { id: 'history' as const, label: 'History', icon: ScrollText },
];

/* ── Helper: score color ───────────────────────────────────────── */

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

/* ── VaiDropdown — mouse-interactive dropdown (no native <select>) ─── */

interface VaiDropdownOption {
  value: string;
  label: string;
}

interface VaiDropdownProps {
  options: VaiDropdownOption[];
  value: string;
  onChange: (value: string) => void;
  'data-vai-dropdown'?: string;
  className?: string;
}

/**
 * Custom dropdown component that renders options as DOM elements.
 * Vai can hover over each option with the mouse and see hover effects —
 * unlike native <select> which renders OS-native widgets.
 *
 * Each option gets a `data-vai-dropdown-option` attribute for easy discovery.
 * The trigger button gets `data-vai-dropdown-trigger`.
 * The panel gets `data-vai-dropdown-panel`.
 */
function VaiDropdown({ options, value, onChange, 'data-vai-dropdown': dropdownId, className }: VaiDropdownProps) {
  const [open, setOpen] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.value === value);

  const handleSelect = useCallback((optValue: string) => {
    onChange(optValue);
    setOpen(false);
    setHoveredIdx(-1);
  }, [onChange]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setHoveredIdx(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setHoveredIdx(-1); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className={`relative ${open ? 'z-50' : ''}`} data-vai-dropdown={dropdownId || 'true'}>
      {/* Trigger button — Vai clicks this to open */}
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        data-vai-dropdown-trigger={dropdownId || 'true'}
        data-vai-dropdown-value={value}
        data-vai-dropdown-text={selected?.label || ''}
        className={`flex items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-[13px] text-zinc-200 outline-none transition-all hover:border-zinc-500 hover:bg-zinc-800 focus:border-indigo-500 ${
          open ? 'border-indigo-500 ring-1 ring-indigo-500/30' : ''
        } ${className || ''}`}
        style={{ minWidth: 180 }}
      >
        <span className="truncate">{selected?.label || 'Select...'}</span>
        <svg
          className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel — each option is a hoverable DOM element */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            data-vai-dropdown-panel={dropdownId || 'true'}
            className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/40"
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHovered = idx === hoveredIdx;
              return (
                <div
                  key={opt.value}
                  data-vai-dropdown-option={opt.value}
                  data-vai-dropdown-option-text={opt.label}
                  data-vai-dropdown-option-idx={idx}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(-1)}
                  onClick={() => handleSelect(opt.value)}
                  className={`cursor-pointer px-3 py-2 text-[13px] transition-all ${
                    isSelected
                      ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                      : isHovered
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  {opt.label}
                  {isSelected && <span className="ml-2 text-[10px] text-indigo-400">✓</span>}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}



/* ── Main component ────────────────────────────────────────────── */

export function VaiGym() {
  const store = useVaiGymStore();
  const responseRef = useRef<HTMLTextAreaElement>(null);

  // Initialize on mount
  useEffect(() => {
    store.init();
  }, []); // init once on mount

  const { progress, loading, view } = store;

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-zinc-950">
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-5xl"
        >
          🧠
        </motion.div>
        <span className="text-sm text-zinc-500">Loading Vai's Training Data...</span>
      </div>
    );
  }

  const avg = progress.totalSessions > 0 ? Math.round(progress.totalScore / progress.totalSessions) : 0;
  const currentLevel = DIFFICULTY_LEVELS.find(d => d.id === progress.level) ?? DIFFICULTY_LEVELS[0];

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/60 bg-zinc-950/90 px-5 py-3 backdrop-blur-sm">
        <div className="group/header flex items-center gap-3">
          <motion.span
            className="text-2xl"
            whileHover={{ rotate: [0, -15, 15, 0], scale: 1.1 }}
            transition={{ duration: 0.5 }}
          >🧠</motion.span>
          <div>
            <div className="bg-gradient-to-r from-zinc-100 via-indigo-200 to-zinc-100 bg-clip-text text-base font-bold tracking-tight text-transparent">Vai Training Gymnasium</div>
            <div className="text-[11px] text-zinc-500 transition-colors group-hover/header:text-zinc-400">Deliberate practice for cognitive foundations</div>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <StatBadge label="Level" value={currentLevel.label} color={currentLevel.color} />
          <StatBadge label="Avg Score" value={`${avg}/100`} color={avg >= 80 ? '#10b981' : avg >= 60 ? '#f59e0b' : '#ef4444'} />
          <StatBadge label="Sessions" value={String(progress.totalSessions)} color="#e2e4e9" />
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-zinc-600">Streak</div>
            <div className="flex items-center gap-1 text-sm font-bold text-amber-400">
              <Flame className="h-3.5 w-3.5" /> {progress.streaks.current}
            </div>
          </div>
        </div>
      </div>

      {/* ── Nav ── */}
      <div className="flex gap-0 overflow-x-auto border-b border-zinc-800/60 bg-zinc-950/80 px-3">
        {NAV_TABS.map(tab => {
          const Icon = tab.icon;
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => store.setView(tab.id)}
              className={`group/tab relative flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13px] font-medium transition-all duration-200 ${
                active
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:bg-indigo-500/5 hover:text-zinc-300'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 transition-transform duration-200 group-hover/tab:scale-110 ${
                active ? 'text-indigo-400 drop-shadow-[0_0_4px_rgba(99,102,241,0.5)]' : ''
              }`} />
              <span className="transition-transform duration-200 group-hover/tab:translate-x-0.5">{tab.label}</span>
              {active && (
                <motion.div
                  layoutId="gym-tab-glow"
                  className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />
              )}
            </button>
          );
        })}

        {/* Visual runner button — always visible */}
        <div className="ml-auto flex items-center pr-2">
          <button
            onClick={() => {
              if (store.runnerActive) {
                // Stop the runner
                runnerAbort?.abort();
                runnerAbort = null;
                store.setRunnerActive(false);
                store.setRunnerStep('');
              } else {
                // Start a visual training round
                runnerAbort = new AbortController();
                runVisualTrainingRound(runnerAbort.signal, {
                  foundation: store.selectedFoundation ?? undefined,
                  difficulty: store.selectedDifficulty,
                  cursorLabel: 'Vai',
                });
              }
            }}
            className={`group/eye flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
              store.runnerActive
                ? 'bg-violet-500/20 text-violet-400 shadow-sm shadow-violet-500/10'
                : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 hover:shadow-sm'
            }`}
            title="Watch Vai train visually"
          >
            <Eye className="h-3.5 w-3.5 transition-all duration-200 group-hover/eye:scale-110 group-hover/eye:drop-shadow-[0_0_4px_rgba(139,92,246,0.5)]" />
            {store.runnerActive ? `Stop Vai (${store.runnerStep})` : 'Watch Vai'}
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {view === 'dashboard' && <DashboardView />}
            {view === 'training' && <TrainingView responseRef={responseRef} />}
            {view === 'review' && <ReviewView />}
            {view === 'foundations' && <FoundationsView />}
            {view === 'history' && <HistoryView />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Stat Badge ────────────────────────────────────────────────── */

function StatBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="group/stat cursor-default text-right transition-transform duration-200 hover:-translate-y-0.5">
      <div className="text-[10px] uppercase tracking-widest text-zinc-600 transition-colors group-hover/stat:text-zinc-500">{label}</div>
      <div className="text-sm font-bold transition-all duration-200 group-hover/stat:drop-shadow-[0_0_6px_currentColor]" style={{ color }}>{value}</div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DASHBOARD VIEW
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function DashboardView() {
  const store = useVaiGymStore();
  const { progress, selectedFoundation, selectedDifficulty, generating } = store;

  return (
    <div className="mx-auto grid max-w-[900px] grid-cols-1 gap-4 md:grid-cols-2">
      {/* Foundation Mastery */}
      <Card title="Foundation Mastery">
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FOUNDATIONS.map(f => {
            const data = progress.foundationScores[f.id];
            const avg = data?.attempts > 0 ? Math.round(data.totalScore / data.attempts) : 0;
            return (
              <div key={f.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-all duration-200 hover:bg-zinc-800/50 hover:shadow-sm hover:shadow-indigo-500/5">
                <span className="w-6 text-center text-base transition-transform duration-200 group-hover:scale-125 group-hover:drop-shadow-md">{f.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] text-zinc-500 transition-colors group-hover:text-zinc-200">
                    {f.name}
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-zinc-800">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${avg}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: f.color }}
                    />
                  </div>
                </div>
                <span className="w-7 text-right text-[11px] font-semibold transition-transform duration-200 group-hover:scale-110" style={{ color: f.color }}>
                  {avg || '—'}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Anti-Pattern Defense */}
      <Card title="Anti-Pattern Defense">
        <div className="mt-3 space-y-0">
          {ANTI_PATTERNS.map(a => {
            const data = progress.antiPatternDodges[a.id];
            const rate = data?.encountered > 0 ? Math.round((data.dodged / data.encountered) * 100) : 0;
            return (
              <div key={a.id} className="group flex items-center gap-3 border-b border-zinc-800/40 py-2 transition-all duration-200 last:border-0 hover:bg-zinc-800/20 hover:pl-1">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-zinc-500 transition-colors duration-200 group-hover:text-zinc-200">
                    {a.name}
                  </div>
                  <div className="text-[10px] text-zinc-700 transition-colors group-hover:text-zinc-600">{a.trap}</div>
                </div>
                <span className={`text-xs font-bold ${
                  rate >= 80 ? 'text-emerald-400' : rate >= 50 ? 'text-amber-400' : data?.encountered === 0 ? 'text-zinc-700' : 'text-red-400'
                }`}>
                  {data?.encountered > 0 ? `${rate}%` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Start Training */}
      <div className="md:col-span-2">
        <Card title="Start Training" className="relative z-20 overflow-visible">
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <VaiDropdown
              data-vai-dropdown="foundation"
              value={selectedFoundation ?? ''}
              onChange={v => store.setSelectedFoundation(v || null)}
              options={[
                { value: '', label: 'Any Foundation' },
                ...FOUNDATIONS.map(f => ({ value: f.id, label: `${f.icon} ${f.name}` })),
              ]}
            />

            <VaiDropdown
              data-vai-dropdown="difficulty"
              value={selectedDifficulty}
              onChange={v => store.setSelectedDifficulty(v)}
              options={DIFFICULTY_LEVELS.map(d => ({ value: d.id, label: d.label }))}
            />

            <button
              onClick={() => store.startRandomScenario()}
              className="group/btn flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/25"
              data-vai-gym-bank-btn
            >
              <Dices className="h-4 w-4 transition-transform duration-300 group-hover/btn:rotate-180" /> From Scenario Bank
            </button>

            <button
              onClick={() => store.startGeneratedScenario()}
              disabled={generating}
              className="group/btn2 flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-[13px] font-semibold text-zinc-400 transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-500/40 hover:text-zinc-200 hover:shadow-lg hover:shadow-violet-500/10 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4 transition-all duration-300 group-hover/btn2:rotate-12 group-hover/btn2:text-violet-400 group-hover/btn2:drop-shadow-[0_0_4px_rgba(139,92,246,0.6)]" />
              {generating ? 'Generating...' : 'AI-Generated Scenario'}
            </button>

            <button
              onClick={() => store.startThorsenDrill()}
              disabled={generating}
              className="group/btn3 flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-[13px] font-semibold text-zinc-400 transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-500/40 hover:text-zinc-200 hover:shadow-lg hover:shadow-cyan-500/10 disabled:opacity-50"
              data-vai-gym-thorsen-btn
            >
              <Orbit className="h-4 w-4 transition-all duration-300 group-hover/btn3:rotate-180 group-hover/btn3:text-cyan-400 group-hover/btn3:drop-shadow-[0_0_4px_rgba(34,211,238,0.6)]" />
              {generating ? 'Generating...' : 'Thorsen Drill'}
            </button>
          </div>

          <div className="mt-2.5 text-[11px] text-zinc-600">
            Bank: {SCENARIO_BANK.filter(s => !selectedFoundation || s.foundation === selectedFoundation).length} scenarios available
            {selectedFoundation && ` for ${FOUNDATIONS.find(f => f.id === selectedFoundation)?.name}`}
            {' · '} 50 Thorsen drills across 10 foundations (5 per foundation)
          </div>
        </Card>

        {/* Thorsen Engine Status */}
        <div className="mt-4">
          <ThorsenHealthCard />
        </div>

        {/* Thorsen Coverage Heatmap */}
        <div className="mt-4">
          <ThorsenCoverageGrid />
        </div>

        {/* Reset */}
        <div className="mt-4 text-right">
          <button
            onClick={() => store.resetProgress()}
            className="text-[11px] text-zinc-700 transition-colors hover:text-zinc-500"
          >
            <RotateCcw className="mr-1 inline h-3 w-3" /> Reset All Progress
          </button>
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TRAINING VIEW
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function TrainingView({ responseRef }: { responseRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const store = useVaiGymStore();
  const { activeScenario, response, grading } = store;

  if (!activeScenario) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-zinc-600">
        <Target className="h-12 w-12" />
        <div className="text-sm">Select a scenario from the Dashboard to begin training</div>
        <button
          onClick={() => store.setView('dashboard')}
          className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  const foundation = FOUNDATIONS.find(f => f.id === activeScenario.foundation);
  const difficulty = DIFFICULTY_LEVELS.find(d => d.id === activeScenario.difficulty);
  const wordCount = response.split(/\s+/).filter(Boolean).length;

  return (
    <div className="mx-auto max-w-[800px] space-y-4">
      {/* Scenario card */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{foundation?.icon}</span>
            <span className="text-[13px] font-semibold" style={{ color: foundation?.color }}>
              {foundation?.name}
            </span>
          </div>
          <span
            className="rounded-full px-3 py-0.5 text-[11px] font-semibold"
            style={{
              backgroundColor: `${difficulty?.color}22`,
              color: difficulty?.color,
            }}
          >
            {activeScenario.difficulty}
          </span>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm leading-relaxed text-zinc-200">
          {activeScenario.situation}
        </div>

        <div className="mt-2.5 text-[11px] text-zinc-600">
          ⚠️ Traps set: {activeScenario.anti_pattern_traps
            .map(id => ANTI_PATTERNS.find(a => a.id === id)?.name)
            .filter(Boolean)
            .join(', ')}
        </div>
      </Card>

      {/* Response area */}
      <Card>
        <div className="mb-2 text-xs font-semibold text-zinc-500">Vai's Response</div>
        <textarea
          ref={responseRef}
          value={response}
          onChange={e => store.setResponse(e.target.value)}
          placeholder="Type Vai's response to this scenario. Be the Vai you want to become..."
          rows={10}
          className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-3 text-sm leading-relaxed text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-indigo-500/50"
          data-vai-gym-textarea
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-zinc-600">{wordCount} words</span>
          <div className="flex gap-2">
            <button
              onClick={() => { store.setView('dashboard'); }}
              className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              <ArrowLeft className="mr-1 inline h-3 w-3" /> Cancel
            </button>
            <button
              onClick={() => store.submitResponse()}
              disabled={grading || !response.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white transition-all hover:-translate-y-px hover:shadow-lg hover:shadow-indigo-500/25 disabled:opacity-50 disabled:hover:translate-y-0"
              data-vai-gym-submit
            >
              {grading ? (
                <>
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                    <Zap className="h-3.5 w-3.5" />
                  </motion.div>
                  Grading...
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" /> Submit for Grading
                </>
              )}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   REVIEW VIEW
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function ReviewView() {
  const store = useVaiGymStore();
  const { lastGrade, activeScenario } = store;

  if (!lastGrade) {
    return (
      <div className="py-20 text-center text-sm text-zinc-600">
        No grade yet. Complete a training session first.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[800px] space-y-4">
      {/* Overall Score */}
      <Card>
        <div className="text-center">
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            className={`text-6xl font-extrabold leading-none ${scoreColor(lastGrade.overall)}`}
          >
            {lastGrade.overall}
          </motion.div>
          <div className="mt-1 text-[13px] text-zinc-500">
            {lastGrade.overall >= 90 ? 'Exceptional' : lastGrade.overall >= 80 ? 'Excellent' : lastGrade.overall >= 70 ? 'Good' : lastGrade.overall >= 50 ? 'Needs Work' : 'Review Foundations'}
          </div>
        </div>
      </Card>

      {/* Score Breakdown */}
      <Card title="Score Breakdown">
        <div className="mt-3 space-y-0">
          {SCORE_DIMENSIONS.map(dim => {
            const score = lastGrade.scores?.[dim.id] ?? 0;
            return (
              <div key={dim.id} className="flex items-center gap-3 border-b border-zinc-800/40 py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-zinc-400">
                    {dim.label} <span className="text-zinc-700">({Math.round(dim.weight * 100)}%)</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${score}%` }}
                      transition={{ duration: 0.5, delay: 0.1 }}
                      className={`h-full rounded-full ${scoreBg(score)}`}
                    />
                  </div>
                </div>
                <span className={`w-8 text-right text-[13px] font-bold ${scoreColor(score)}`}>
                  {score}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Feedback */}
      <Card title="Feedback">
        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-[13px] leading-relaxed text-zinc-300">
          {lastGrade.feedback}
        </div>

        {lastGrade.strengths?.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-400">Strengths</div>
            {lastGrade.strengths.map((s, i) => (
              <div key={i} className="py-0.5 text-xs text-zinc-400">✅ {s}</div>
            ))}
          </div>
        )}

        {lastGrade.improvements?.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-400">Improvements</div>
            {lastGrade.improvements.map((s, i) => (
              <div key={i} className="py-0.5 text-xs text-zinc-400">🔧 {s}</div>
            ))}
          </div>
        )}

        {lastGrade.anti_patterns_triggered?.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-red-400">Anti-Patterns Triggered</div>
            {lastGrade.anti_patterns_triggered.map((id, i) => {
              const ap = ANTI_PATTERNS.find(a => a.id === id);
              return (
                <div key={i} className="py-0.5 text-xs text-red-400">
                  🚨 {ap?.name ?? id}: {ap?.trap}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Hidden Need Reveal */}
      {activeScenario && (
        <Card title="💡 The Hidden Need">
          <div className="mt-2 text-[13px] leading-relaxed text-zinc-300">
            {activeScenario.hidden_need}
          </div>
          <div className="mt-3 text-xs text-zinc-500">
            <strong className="text-zinc-400">Ideal traits:</strong>{' '}
            {activeScenario.ideal_traits?.join(' · ')}
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="flex justify-center gap-3">
        <button
          onClick={() => { store.setView('training'); }}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Retry Same
        </button>
        <button
          onClick={() => { store.setView('dashboard'); }}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition-all hover:-translate-y-px hover:shadow-lg hover:shadow-indigo-500/25"
        >
          <BarChart3 className="h-3.5 w-3.5" /> Dashboard
        </button>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FOUNDATIONS VIEW
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function FoundationsView() {
  const store = useVaiGymStore();
  const { progress } = store;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {FOUNDATIONS.map(f => {
        const data = progress.foundationScores[f.id];
        const avg = data?.attempts > 0 ? Math.round(data.totalScore / data.attempts) : 0;
        const scenarios = SCENARIO_BANK.filter(s => s.foundation === f.id);
        return (
          <motion.div
            key={f.id}
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className="group/fcard cursor-pointer rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 backdrop-blur-sm transition-all duration-300 hover:border-opacity-60 hover:shadow-xl hover:shadow-black/20"
            style={{ '--fcard-color': f.color } as React.CSSProperties}
            onClick={() => { store.setSelectedFoundation(f.id); store.setView('dashboard'); }}
          >
            {/* Gradient border overlay on hover */}
            <div
              className="pointer-events-none absolute -inset-px rounded-xl opacity-0 transition-opacity duration-300 group-hover/fcard:opacity-100"
              style={{ background: `linear-gradient(135deg, ${f.color}20, transparent 60%, ${f.color}15)` }}
            />
            <div className="relative">
              <div className="mb-2 flex items-center gap-2.5">
                <motion.span
                  className="text-2xl"
                  whileHover={{ rotate: [0, -10, 10, 0] }}
                  transition={{ duration: 0.4 }}
                >{f.icon}</motion.span>
                <div>
                  <div className="text-sm font-bold transition-all duration-200 group-hover/fcard:drop-shadow-[0_0_6px_var(--fcard-color)]" style={{ color: f.color }}>{f.name}</div>
                  <div className="text-[11px] text-zinc-600 transition-colors group-hover/fcard:text-zinc-500">{data?.attempts ?? 0} attempts · Best: {data?.bestScore || '—'}</div>
                </div>
              </div>
              <div className="mb-3 text-xs leading-relaxed text-zinc-500 transition-colors duration-200 group-hover/fcard:text-zinc-400">{f.desc}</div>
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${avg}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: f.color }}
                  />
                </div>
                <span className="text-sm font-bold transition-all duration-200 group-hover/fcard:scale-110" style={{ color: f.color }}>{avg || '—'}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="text-[10px] text-zinc-700 transition-colors group-hover/fcard:text-zinc-600">{scenarios.length} bank scenarios</div>
                <div className="text-[10px] text-zinc-800 transition-all duration-200 group-hover/fcard:translate-x-0.5 group-hover/fcard:text-zinc-500">→</div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   HISTORY VIEW
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function HistoryView() {
  const { progress } = useVaiGymStore();

  return (
    <div className="mx-auto max-w-[700px]">
      <Card title={`Training History (${progress.history.length} sessions)`}>
        {progress.history.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-zinc-600">
            No sessions yet. Start training to see your progress.
          </div>
        ) : (
          <div className="mt-3">
            {[...progress.history].reverse().map((entry, i) => {
              const f = FOUNDATIONS.find(x => x.id === entry.foundation);
              return (
                <div key={i} className="flex items-center gap-3 border-b border-zinc-800/40 py-2.5 last:border-0">
                  <span className="text-base">{f?.icon ?? '?'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-zinc-300">{entry.scenario}...</div>
                    <div className="text-[10px] text-zinc-600">
                      {new Date(entry.date).toLocaleDateString()} · {entry.difficulty}
                    </div>
                  </div>
                  <span className={`text-base font-extrabold ${scoreColor(entry.score)}`}>
                    {entry.score}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SHARED — Card
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ── Thorsen Engine Health Card ─────────────────────────────────── */

interface ThorsenHealth {
  grade: string;
  totalTemplates: number;
  successRate: number;
  verifiedRate: number;
  wormholeRate: number;
  avgScore: number;
}

function ThorsenHealthCard() {
  const [health, setHealth] = useState<ThorsenHealth | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3006/api/thorsen/self-improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) return;
      const data = await res.json();
      setHealth({
        grade: data.grade,
        totalTemplates: data.totalTemplates,
        successRate: data.stats.successRate,
        verifiedRate: data.stats.verifiedRate,
        wormholeRate: data.stats.wormholeRate,
        avgScore: data.stats.avgScore,
      });
    } catch {
      // Server unreachable — leave as null
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  const gradeColor = health?.grade === 'A' ? 'text-emerald-400'
    : health?.grade === 'B' ? 'text-cyan-400'
    : health?.grade === 'C' ? 'text-amber-400'
    : 'text-zinc-500';

  const gradeGlow = health?.grade === 'A' ? 'drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]'
    : health?.grade === 'B' ? 'drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]'
    : '';

  return (
    <Card title="Thorsen Engine">
      <div className="mt-3 flex items-center gap-6">
        {/* Grade badge */}
        <div className="flex flex-col items-center">
          <div className={`text-3xl font-black tracking-tight transition-all duration-500 ${gradeColor} ${gradeGlow}`}>
            {loading ? '...' : health?.grade ?? '—'}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-zinc-600">Grade</div>
        </div>

        {/* Stats grid */}
        {health && (
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <div>
              <div className="text-[10px] text-zinc-600">Templates</div>
              <div className="text-sm font-semibold text-zinc-300">{health.totalTemplates}</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-600">Success</div>
              <div className="text-sm font-semibold text-emerald-400">{Math.round(health.successRate * 100)}%</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-600">Verified</div>
              <div className="text-sm font-semibold text-cyan-400">{Math.round(health.verifiedRate * 100)}%</div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-600">Wormhole</div>
              <div className="text-sm font-semibold text-violet-400">{Math.round(health.wormholeRate * 100)}%</div>
            </div>
          </div>
        )}

        {!health && !loading && (
          <div className="text-[11px] text-zinc-600">Engine offline — start runtime to see status</div>
        )}

        {/* Refresh */}
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="rounded-md p-1.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400 disabled:opacity-50"
        >
          <RotateCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </Card>
  );
}

/* ── Thorsen Coverage Grid ───────────────────────────────────────── */

interface CoverageData {
  actions: string[];
  domains: string[];
  matrix: Array<{
    action: string;
    domain: string;
    covered: boolean;
    logicType: string | null;
    templateKey: string | null;
  }>;
  stats: { total: number; covered: number; uncovered: number; coveragePercent: number };
}

function ThorsenCoverageGrid() {
  const [data, setData] = useState<CoverageData | null>(null);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://localhost:3006/api/thorsen/coverage')
      .then(r => r.json())
      .then(d => setData(d as CoverageData))
      .catch(() => {});
  }, []);

  if (!data) return null;

  const { actions, domains, matrix, stats } = data;

  // Build lookup: "action:domain" → cell
  const lookup = new Map(matrix.map(c => [`${c.action}:${c.domain}`, c]));

  // Action display names
  const actionLabels: Record<string, string> = {
    create: 'CREATE', optimize: 'OPTIM', debug: 'DEBUG',
    explain: 'EXPLN', test: 'TEST', transpile: 'TRANS',
  };

  // Colors for logic types
  const logicColors: Record<string, string> = {
    functional: 'bg-emerald-500/70 border-emerald-400/40',
    reactive: 'bg-cyan-500/70 border-cyan-400/40',
    stateful: 'bg-violet-500/70 border-violet-400/40',
    declarative: 'bg-amber-500/70 border-amber-400/40',
  };

  return (
    <Card title="Coverage Heatmap">
      <div className="mt-3">
        {/* Stats summary */}
        <div className="mb-3 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Grid3x3 className="h-3.5 w-3.5 text-zinc-500" />
            <span className="text-[11px] text-zinc-500">
              {stats.covered}/{stats.total} cells
            </span>
          </div>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${stats.coveragePercent}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500"
            />
          </div>
          <span className="text-[11px] font-semibold text-emerald-400">{stats.coveragePercent}%</span>
        </div>

        {/* Grid */}
        <div className="mt-2 overflow-x-auto">
          <div className="min-w-fit">
            {/* Column headers (domains) — tall container for rotated labels */}
            <div className="flex">
              <div className="w-14 shrink-0" /> {/* spacer for row labels */}
              {domains.map(d => (
                <div key={d} className="relative flex h-14 w-16 shrink-0 items-end justify-center px-0.5 pb-1.5">
                  <span className="absolute bottom-1 left-1/2 origin-bottom-left -translate-x-1/2 -rotate-45 whitespace-nowrap text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                    {d}
                  </span>
                </div>
              ))}
            </div>

            {/* Rows (actions) */}
            <div className="flex flex-col gap-1">
            {actions.map(action => (
              <div key={action} className="flex items-center">
                <div className="w-14 shrink-0 pr-2 text-right text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  {actionLabels[action] ?? action.slice(0, 5).toUpperCase()}
                </div>
                {domains.map(domain => {
                  const cell = lookup.get(`${action}:${domain}`);
                  const cellKey = `${action}:${domain}`;
                  const isHovered = hoveredCell === cellKey;
                  const covered = cell?.covered ?? false;
                  const logicType = cell?.logicType ?? '';
                  const colorClass = covered
                    ? (logicColors[logicType] ?? 'bg-emerald-500/70 border-emerald-400/40')
                    : 'bg-zinc-800/40 border-zinc-700/30';

                  return (
                    <div
                      key={cellKey}
                      className="relative w-16 shrink-0 px-0.5 py-[1px]"
                      onMouseEnter={() => setHoveredCell(cellKey)}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      <motion.div
                        whileHover={{ scale: 1.12 }}
                        className={`relative flex h-7 items-center justify-center rounded border transition-all duration-200 ${
                          colorClass
                        } ${isHovered ? 'shadow-md ring-1 ring-white/20' : ''}`}
                      >
                        {covered && (
                          <span className="text-[9px] font-semibold uppercase leading-none text-white/90">
                            {logicType?.slice(0, 3)}
                          </span>
                        )}
                        {!covered && (
                          <span className="text-[7px] text-zinc-600">—</span>
                        )}
                      </motion.div>

                      {/* Tooltip */}
                      <AnimatePresence>
                        {isHovered && (
                          <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 4 }}
                            className="absolute z-50 mt-1 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] shadow-lg"
                          >
                            <span className="font-semibold text-zinc-200">{action}:{domain}</span>
                            {covered ? (
                              <span className="ml-1 text-emerald-400">✓ {logicType}</span>
                            ) : (
                              <span className="ml-1 text-zinc-600">— uncovered</span>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-3">
          {Object.entries(logicColors).map(([type, cls]) => (
            <div key={type} className="flex items-center gap-1.5">
              <div className={`h-2.5 w-2.5 rounded-sm border ${cls}`} />
              <span className="text-[9px] capitalize text-zinc-500">{type}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm border border-zinc-800 bg-zinc-800/40" />
            <span className="text-[9px] text-zinc-600">uncovered</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Shared Card Component ──────────────────────────────────────── */

function Card({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      whileHover={{ scale: 1.005 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`group/card relative rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm transition-all duration-300 hover:border-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/5 ${className || ''}`}
    >
      {/* Subtle gradient glow on hover */}
      <div className="pointer-events-none absolute -inset-px overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500/0 via-violet-500/0 to-purple-500/0 opacity-0 transition-opacity duration-500 group-hover/card:from-indigo-500/10 group-hover/card:via-violet-500/5 group-hover/card:to-purple-500/10 group-hover/card:opacity-100" />
      <div className="relative">
        {title && (
          <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-indigo-400 transition-colors duration-300 group-hover/card:text-indigo-300">
            <div className="h-1 w-1 rounded-full bg-indigo-500 opacity-0 transition-all duration-300 group-hover/card:opacity-100 group-hover/card:shadow-[0_0_6px_rgba(99,102,241,0.6)]" />
            {title}
          </div>
        )}
        {children}
      </div>
    </motion.div>
  );
}
