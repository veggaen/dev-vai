/**
 * ThorsenPanel — Desktop UI for the Thorsen Meta-Kernel.
 *
 * Provides:
 *   1. Intent Builder — structured form to compose ThorsenIntent packets
 *   2. Thorsen Curve — live latency indicator showing sync state
 *   3. Artifact Viewer — displays synthesized code with copy/save
 *   4. Template List — shows available deterministic templates
 *   5. Pulse Monitor — continuous sync state measurement
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Orbit, Zap, Copy, Check, ChevronDown, Play,
  FileCode2, CircleDot, GitBranch,
} from 'lucide-react';
import {
  thorsenSynthesize,
  thorsenPulse,
  thorsenTemplates,
  type ThorsenIntent,
  type ThorsenResponse,
  type ThorsenSyncState,
  type ThorsenAction,
  type ThorsenDomain,
  type ThorsenLogicType,
  type ThorsenTargetEnv,
  type ThorsenLanguage,
  type ThorsenTemplate,
  type PipelineTrace,
  type PipelineStage,
} from '../lib/thorsen.js';

/* ── Constants ────────────────────────────────────────────────── */

const ACTIONS: { value: ThorsenAction; label: string }[] = [
  { value: 'create', label: 'Create' },
  { value: 'optimize', label: 'Optimize' },
  { value: 'debug', label: 'Debug' },
  { value: 'explain', label: 'Explain' },
  { value: 'transpile', label: 'Transpile' },
  { value: 'test', label: 'Test' },
];

const DOMAINS: { value: ThorsenDomain; label: string }[] = [
  { value: 'calculator', label: 'Calculator' },
  { value: 'component', label: 'Component' },
  { value: 'api-route', label: 'API Route' },
  { value: 'utility', label: 'Utility' },
  { value: 'dataset', label: 'Dataset' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'vai-drill', label: 'Vai Drill' },
  { value: 'custom', label: 'Custom' },
];

const LOGIC_TYPES: { value: ThorsenLogicType; label: string }[] = [
  { value: 'functional', label: 'Functional' },
  { value: 'stateful', label: 'Stateful' },
  { value: 'reactive', label: 'Reactive' },
  { value: 'declarative', label: 'Declarative' },
];

const TARGETS: { value: ThorsenTargetEnv; label: string }[] = [
  { value: 'node', label: 'Node.js' },
  { value: 'browser', label: 'Browser' },
  { value: 'wsl2', label: 'WSL2' },
  { value: 'docker', label: 'Docker' },
  { value: 'edge', label: 'Edge' },
];

const LANGUAGES: { value: ThorsenLanguage; label: string }[] = [
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'auto', label: 'Auto' },
];

const SYNC_COLORS: Record<ThorsenSyncState, string> = {
  wormhole: '#10b981', // emerald
  parallel: '#f59e0b', // amber
  linear: '#ef4444',   // red
};

const SYNC_LABELS: Record<ThorsenSyncState, string> = {
  wormhole: 'Wormhole',
  parallel: 'Parallel',
  linear: 'Linear',
};

/* ── Component ────────────────────────────────────────────────── */

export function ThorsenPanel() {
  // Intent form state
  const [action, setAction] = useState<ThorsenAction>('create');
  const [domain, setDomain] = useState<ThorsenDomain>('calculator');
  const [logicType, setLogicType] = useState<ThorsenLogicType>('functional');
  const [targetEnv, setTargetEnv] = useState<ThorsenTargetEnv>('node');
  const [language, setLanguage] = useState<ThorsenLanguage>('typescript');
  const [spec, setSpec] = useState('');

  // Results
  const [result, setResult] = useState<ThorsenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Pulse monitor
  const [syncState, setSyncState] = useState<ThorsenSyncState | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const pulseInterval = useRef<ReturnType<typeof setInterval>>(undefined);

  // Templates
  const [templates, setTemplates] = useState<ThorsenTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  // History
  const [history, setHistory] = useState<Array<{ intent: ThorsenIntent; response: ThorsenResponse; timestamp: number }>>([]);

  // Load templates on mount
  useEffect(() => {
    thorsenTemplates().then(r => setTemplates(r.templates)).catch(() => {});
  }, []);

  // Pulse monitor — measure sync every 2s
  useEffect(() => {
    const pulse = async () => {
      try {
        const r = await thorsenPulse();
        setSyncState(r.state);
        setLatency(r.latencyMs);
      } catch {
        setSyncState(null);
        setLatency(null);
      }
    };
    pulse();
    pulseInterval.current = setInterval(pulse, 2000);
    return () => clearInterval(pulseInterval.current);
  }, []);

  const handleSynthesize = useCallback(async () => {
    setLoading(true);
    setError(null);
    const intent: ThorsenIntent = {
      action,
      domain,
      logicType,
      targetEnv,
      language,
      spec: spec.trim() || undefined,
      timestampUs: Date.now() * 1000,
    };

    try {
      const response = await thorsenSynthesize(intent);
      setResult(response);
      setHistory(h => [{ intent, response, timestamp: Date.now() }, ...h].slice(0, 20));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Synthesis failed');
    }
    setLoading(false);
  }, [action, domain, logicType, targetEnv, language, spec]);

  const handleCopy = useCallback(() => {
    if (!result) return;
    navigator.clipboard.writeText(result.artifact.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result]);

  const handleTemplateClick = useCallback((t: ThorsenTemplate) => {
    setAction(t.action as ThorsenAction);
    setDomain(t.domain as ThorsenDomain);
    setLogicType(t.logicType as ThorsenLogicType);
    setShowTemplates(false);
  }, []);

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <motion.div
            animate={{ rotate: syncState === 'wormhole' ? 360 : 0 }}
            transition={{ duration: 3, repeat: syncState === 'wormhole' ? Infinity : 0, ease: 'linear' }}
          >
            <Orbit className="h-5 w-5 text-violet-400" />
          </motion.div>
          <div>
            <div className="bg-gradient-to-r from-violet-400 via-zinc-100 to-violet-400 bg-clip-text text-base font-bold tracking-tight text-transparent">
              Thorsen Wormhole
            </div>
            <div className="text-[11px] text-zinc-500">Intent → Artifact pipeline</div>
          </div>
        </div>

        {/* Live sync indicator */}
        <div className="flex items-center gap-3">
          {syncState && latency !== null && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-1.5"
            >
              <motion.div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: SYNC_COLORS[syncState] }}
                animate={{
                  boxShadow: [
                    `0 0 0px ${SYNC_COLORS[syncState]}`,
                    `0 0 8px ${SYNC_COLORS[syncState]}`,
                    `0 0 0px ${SYNC_COLORS[syncState]}`,
                  ],
                }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <span className="text-[11px] font-semibold" style={{ color: SYNC_COLORS[syncState] }}>
                {SYNC_LABELS[syncState]}
              </span>
              <span className="text-[10px] text-zinc-600">{latency.toFixed(0)}ms</span>
            </motion.div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-[800px] space-y-4">

          {/* Intent Builder Card */}
          <div className="group/card relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm transition-all duration-300 hover:border-violet-500/30">
            <div className="pointer-events-none absolute -inset-px rounded-xl bg-gradient-to-br from-violet-500/0 via-purple-500/0 to-indigo-500/0 opacity-0 transition-opacity duration-500 group-hover/card:from-violet-500/10 group-hover/card:via-purple-500/5 group-hover/card:to-indigo-500/10 group-hover/card:opacity-100" />
            <div className="relative">
              <div className="mb-4 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-violet-400">
                <div className="h-1 w-1 rounded-full bg-violet-500 shadow-[0_0_6px_rgba(139,92,246,0.6)]" />
                Intent Packet
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {/* Action */}
                <SelectField label="Action" value={action} onChange={v => setAction(v as ThorsenAction)} options={ACTIONS} />
                {/* Domain */}
                <SelectField label="Domain" value={domain} onChange={v => setDomain(v as ThorsenDomain)} options={DOMAINS} />
                {/* Logic Type */}
                <SelectField label="Logic" value={logicType} onChange={v => setLogicType(v as ThorsenLogicType)} options={LOGIC_TYPES} />
                {/* Target */}
                <SelectField label="Target" value={targetEnv} onChange={v => setTargetEnv(v as ThorsenTargetEnv)} options={TARGETS} />
                {/* Language */}
                <SelectField label="Language" value={language} onChange={v => setLanguage(v as ThorsenLanguage)} options={LANGUAGES} />
              </div>

              {/* Spec (free-form) */}
              {domain === 'custom' && (
                <div className="mt-3">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Specification</label>
                  <input
                    value={spec}
                    onChange={e => setSpec(e.target.value)}
                    placeholder="Describe what to build..."
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 transition-all duration-200 focus:border-violet-500/50 focus:outline-none focus:shadow-[0_0_12px_rgba(139,92,246,0.15)]"
                  />
                </div>
              )}

              {/* Synthesize button */}
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleSynthesize}
                  disabled={loading}
                  className="group/btn flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-violet-500 hover:shadow-lg hover:shadow-violet-500/25 disabled:opacity-50"
                >
                  {loading ? (
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                      <Zap className="h-4 w-4" />
                    </motion.div>
                  ) : (
                    <Play className="h-4 w-4 transition-transform duration-200 group-hover/btn:scale-110" />
                  )}
                  {loading ? 'Synthesizing...' : 'Synthesize'}
                </button>

                <button
                  onClick={() => setShowTemplates(!showTemplates)}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-all duration-200 hover:border-zinc-600 hover:text-zinc-300"
                >
                  <FileCode2 className="h-3.5 w-3.5" />
                  Templates ({templates.length})
                  <ChevronDown className={`h-3 w-3 transition-transform ${showTemplates ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Templates dropdown */}
          <AnimatePresence>
            {showTemplates && templates.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50"
              >
                <div className="p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                    Deterministic Templates (instant, verified)
                  </div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {templates.map(t => (
                      <button
                        key={t.key}
                        onClick={() => handleTemplateClick(t)}
                        className="group/tpl flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-all duration-200 hover:bg-zinc-800/60"
                      >
                        <CircleDot className="h-3 w-3 text-violet-400 transition-transform group-hover/tpl:scale-125" />
                        <span className="text-zinc-300 group-hover/tpl:text-zinc-100">{t.action}</span>
                        <span className="text-zinc-600">:</span>
                        <span className="text-zinc-400 group-hover/tpl:text-zinc-200">{t.domain}</span>
                        <span className="text-zinc-700">({t.logicType})</span>
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-red-800/50 bg-red-950/30 p-3 text-sm text-red-400"
            >
              {error}
            </motion.div>
          )}

          {/* Result */}
          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                {/* Sync status bar */}
                <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <motion.div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: SYNC_COLORS[result.sync.state] }}
                      animate={{
                        scale: [1, 1.2, 1],
                        boxShadow: [`0 0 0px ${SYNC_COLORS[result.sync.state]}`, `0 0 12px ${SYNC_COLORS[result.sync.state]}`, `0 0 0px ${SYNC_COLORS[result.sync.state]}`],
                      }}
                      transition={{ duration: 1.5, repeat: 2 }}
                    />
                    <span className="text-sm font-bold" style={{ color: SYNC_COLORS[result.sync.state] }}>
                      {SYNC_LABELS[result.sync.state]}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500">{result.sync.latencyMs.toFixed(1)}ms</span>
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-xs text-zinc-600">
                      Score: <span className="font-bold text-violet-400">{(result.artifact.thorsenScore * 100).toFixed(0)}%</span>
                    </span>
                    {result.artifact.verified && (
                      <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                        VERIFIED
                      </span>
                    )}
                  </div>
                </div>

                {/* Pipeline Trace */}
                {result.trace && <PipelineTraceView trace={result.trace} />}

                {/* Code artifact */}
                <div className="group/code relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm transition-all duration-300 hover:border-violet-500/20">
                  <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-2">
                    <div className="flex items-center gap-2">
                      <FileCode2 className="h-3.5 w-3.5 text-zinc-500" />
                      <span className="text-xs font-medium text-zinc-400">{result.artifact.filename}</span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">{result.artifact.language}</span>
                    </div>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-zinc-500 transition-all hover:bg-zinc-800 hover:text-zinc-300"
                    >
                      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <pre className="max-h-[50vh] overflow-auto p-4 text-[13px] leading-relaxed text-zinc-300">
                    <code>{result.artifact.code}</code>
                  </pre>
                  {result.artifact.verifyOutput && (
                    <div className="border-t border-zinc-800/60 bg-zinc-950/50 px-4 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Output</div>
                      <pre className="mt-1 text-xs text-emerald-400/80">{result.artifact.verifyOutput}</pre>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* History */}
          {history.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                Recent Syntheses ({history.length})
              </div>
              <div className="space-y-1">
                {history.map((h, i) => (
                  <div
                    key={i}
                    className="group/hist flex items-center gap-3 rounded-lg px-2 py-1.5 transition-all duration-200 hover:bg-zinc-800/40"
                  >
                    <div
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: SYNC_COLORS[h.response.sync.state] }}
                    />
                    <span className="text-xs text-zinc-400 group-hover/hist:text-zinc-200">
                      {h.intent.action}:{h.intent.domain}
                    </span>
                    <span className="text-[10px] text-zinc-600">{h.intent.logicType}</span>
                    <span className="ml-auto text-[10px] text-zinc-700">
                      {h.response.sync.latencyMs.toFixed(0)}ms
                    </span>
                    <span className="text-[10px] font-semibold text-violet-400/70">
                      {(h.response.artifact.thorsenScore * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Thorsen Curve visualization */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              Thorsen Curve
            </div>
            <div className="flex items-center gap-4">
              <CurveBar label="Linear" color="#ef4444" range=">200ms" active={syncState === 'linear'} />
              <CurveBar label="Parallel" color="#f59e0b" range="100-200ms" active={syncState === 'parallel'} />
              <CurveBar label="Wormhole" color="#10b981" range="<100ms" active={syncState === 'wormhole'} />
            </div>
            {latency !== null && (
              <div className="mt-2 text-center text-[10px] text-zinc-600">
                Current: <span className="font-bold" style={{ color: syncState ? SYNC_COLORS[syncState] : '#71717a' }}>{latency.toFixed(0)}ms</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────────── */

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 transition-all duration-200 focus:border-violet-500/50 focus:outline-none"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function CurveBar({
  label,
  color,
  range,
  active,
}: {
  label: string;
  color: string;
  range: string;
  active: boolean;
}) {
  return (
    <div className={`flex-1 rounded-lg border p-3 text-center transition-all duration-300 ${
      active ? 'border-opacity-60 shadow-lg' : 'border-zinc-800 opacity-50'
    }`} style={{ borderColor: active ? color : undefined, boxShadow: active ? `0 0 20px ${color}30` : undefined }}>
      <div className="text-xs font-bold" style={{ color: active ? color : '#71717a' }}>{label}</div>
      <div className="text-[10px] text-zinc-600">{range}</div>
      {active && (
        <motion.div
          className="mx-auto mt-1 h-1 w-8 rounded-full"
          style={{ backgroundColor: color }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}
    </div>
  );
}

/* ── Pipeline Trace Visualization ─────────────────────────────── */

const STAGE_LABELS: Record<PipelineStage, string> = {
  receive: 'Receive',
  normalize: 'Normalize',
  route: 'Route',
  synthesize: 'Synthesize',
  verify: 'Verify',
  score: 'Score',
};

const _STAGE_DESCRIPTIONS: Record<PipelineStage, string> = {
  receive: 'Validate intent packet',
  normalize: '4-field fingerprint + complexity',
  route: 'Pick strategy',
  synthesize: 'Generate code',
  verify: 'Parse + constraint check',
  score: 'Thorsen Curve classification',
};

const STAGE_ORDER: PipelineStage[] = ['receive', 'normalize', 'route', 'synthesize', 'verify', 'score'];

function PipelineTraceView({ trace }: { trace: PipelineTrace }) {
  const maxDuration = Math.max(...trace.stages.map(s => s.durationMs), 0.01);
  const inter = trace.intermediates;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
          <GitBranch className="h-3 w-3" />
          Pipeline Trace
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-zinc-600">{trace.traceId}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            trace.success ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {trace.success ? 'OK' : `FAIL @ ${trace.failedAt}`}
          </span>
          <span className="text-[10px] text-zinc-500">{trace.totalMs.toFixed(1)}ms total</span>
        </div>
      </div>

      {/* Stage waterfall */}
      <div className="space-y-1">
        {STAGE_ORDER.map((stageId, idx) => {
          const timing = trace.stages.find(s => s.stage === stageId);
          const durationMs = timing?.durationMs ?? 0;
          const widthPct = Math.max((durationMs / maxDuration) * 100, 2);
          const isFailed = trace.failedAt === stageId;

          // Color based on duration relative to total
          const ratio = durationMs / (trace.totalMs || 1);
          const barColor = isFailed ? '#ef4444'
            : ratio > 0.5 ? '#f59e0b'   // dominant stage
            : ratio > 0.1 ? '#8b5cf6'   // significant
            : '#3f3f46';                  // fast

          return (
            <motion.div
              key={stageId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="group/stage flex items-center gap-2"
            >
              {/* Stage number */}
              <span className="w-4 text-right text-[10px] text-zinc-700">{idx + 1}</span>

              {/* Stage label */}
              <span className="w-20 truncate text-[11px] font-medium text-zinc-400">
                {STAGE_LABELS[stageId]}
              </span>

              {/* Duration bar */}
              <div className="flex-1">
                <div className="h-4 rounded-sm bg-zinc-800/40">
                  <motion.div
                    className="h-full rounded-sm"
                    style={{ backgroundColor: barColor }}
                    initial={{ width: 0 }}
                    animate={{ width: `${widthPct}%` }}
                    transition={{ duration: 0.4, delay: idx * 0.06, ease: 'easeOut' }}
                  />
                </div>
              </div>

              {/* Duration text */}
              <span className="w-16 text-right font-mono text-[10px] text-zinc-500">
                {durationMs < 1 ? `${(durationMs * 1000).toFixed(0)}µs` : `${durationMs.toFixed(1)}ms`}
              </span>
            </motion.div>
          );
        })}
      </div>

      {/* Intermediates summary */}
      {inter && (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-zinc-800/40 pt-3">
          {/* Fingerprint */}
          {inter.normalized && (
            <div className="rounded-lg bg-zinc-800/30 px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-widest text-zinc-600">Fingerprint</div>
              <div className="mt-0.5 font-mono text-[11px] text-violet-400">{inter.normalized.fingerprint.key}</div>
              <div className="text-[10px] text-zinc-500">
                {inter.normalized.complexity} · {inter.normalized.templateAvailable ? 'template ✓' : 'no template'}
              </div>
            </div>
          )}

          {/* Routing */}
          {inter.routed && (
            <div className="rounded-lg bg-zinc-800/30 px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-widest text-zinc-600">Strategy</div>
              <div className="mt-0.5 text-[11px] font-semibold text-zinc-300">{inter.routed.strategy}</div>
              <div className="truncate text-[10px] text-zinc-500">{inter.routed.reason}</div>
            </div>
          )}

          {/* Scoring */}
          {inter.scored && (
            <div className="rounded-lg bg-zinc-800/30 px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-widest text-zinc-600">Score Factors</div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                {Object.entries(inter.scored.scoreFactors).map(([k, v]) => (
                  <span key={k} className="text-[10px]">
                    <span className="text-zinc-500">{k}:</span>
                    <span className={v >= 0 ? 'text-emerald-400' : 'text-red-400'}>{v >= 0 ? '+' : ''}{(v * 100).toFixed(0)}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Verification */}
          {inter.verified && inter.verified.constraintResults.length > 0 && (
            <div className="col-span-3 rounded-lg bg-zinc-800/30 px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-widest text-zinc-600">Constraints</div>
              <div className="mt-1 space-y-0.5">
                {inter.verified.constraintResults.map((cr, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[10px]">
                    <span className={cr.passed ? 'text-emerald-400' : 'text-red-400'}>{cr.passed ? '✓' : '✗'}</span>
                    <span className="text-zinc-400">{cr.constraint}</span>
                    {cr.reason && <span className="text-zinc-600">— {cr.reason}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
