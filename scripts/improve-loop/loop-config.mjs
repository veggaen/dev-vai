/**
 * loop-config — the ONE place the improvement loop's tunable knobs live.
 *
 * Before this module every threshold was a literal scattered across ~8 files (density floor in
 * process-engine, accept rate in acceptance-verifier, rest seconds inline in supervisor's argv
 * parsing…). Tuning the loop meant editing source; running two loops with different budgets meant
 * two checkouts. This module centralises the DEFAULTS and layers overrides on top:
 *
 *   defaults  ←  VAI_LOOP_* environment variables  ←  CLI flags
 *
 * Behaviour-preserving by contract: every default below is pinned to the literal the codebase
 * shipped with on 2026-07-02 (loop-config.test.mjs asserts each one). The existing exported
 * consts (DENSITY_FLOOR, ACCEPT_RATE, …) stay in their home modules — initialised from these
 * defaults — so their doc comments and test imports keep working.
 *
 * Import discipline: this module imports only the schema-free platform constants manifest. It
 * remains at the bottom of the loop dependency graph and imports no loop runtime behavior.
 */

import platformValues from '../../packages/constants/src/platform-values.json' with { type: 'json' };

function deepFreeze(obj) {
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') deepFreeze(v);
  }
  return Object.freeze(obj);
}

export const LOOP_DEFAULTS = deepFreeze({
  // process-engine: value-per-compute selection
  densityFloor: 0.05,      // min density to be worth running (DENSITY_FLOOR)
  minCost: 0.25,           // effective cost floor — no process is "free" (MIN_COST)
  maxDepth: 12,            // runCycle recursion cap for composed sub-processes
  // acceptance-verifier: fix verdicts
  acceptRate: 0.8,         // fraction of targeted failures recovered ⇒ fully accepted
  improveRate: 0.25,       // fraction recovered (breaking nothing) ⇒ kept as net improvement
  // change-worth: worthiness gate
  worthPassScore: 0.66,    // combined worth a change must clear to commit
  dimensionWeights: { meaningfulness: 0.35, engineeringQuality: 0.30, configurability: 0.15, futureProofness: 0.20 },
  // compute-roi: benefit-per-compute accounting
  qualityBar: 7,           // proposal impact at/above this is "qualified"
  roiFloor: 0.05,          // sustained realized ROI below this is plateau-low
  roiEps: 0.01,            // flat-band epsilon for the ROI slope
  // innovation-engine: experiment arc
  minMotionSample: 8,      // graded prompts a run needs to count as a motion sample
  retryCooldown: 3,        // closed experiments before a rejected variant is retryable (NOT days)
  // meaning-selector: lane importance
  laneWeights: { quality: 1.0, capability: 0.9, codebase: 0.85, reliability: 0.8, routing: 0.7 },
  // operator surfaces
  watchPort: platformValues.ports.selfImprovementWatch, // watch.mjs dashboard port
  adoptionBoardLimit: 50,  // bounded owner-review items returned at one boundary
  adoptionResumeShipments: 3, // positive measured shipments required before generation resumes
  adoptionTextLimit: 1000, // untrusted corpus text bound on JSON/operator surfaces
  // supervisor cadence
  restSeconds: 45,         // GPU breather between cycles
  computeBudget: 10,       // --engine compute units (≈ model calls) per cycle
  evictOnRest: true,       // evict Ollama models before the rest breather (frees VRAM)
});

/** camelCase → SNAKE_CASE for the VAI_LOOP_* env namespace. */
function envKeyOf(key) {
  return `VAI_LOOP_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

/** camelCase → --kebab-case flag name. */
function flagOf(key) {
  return `--${key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;
}

// Flags that already exist in the wild keep their historical names as aliases.
const FLAG_ALIASES = {
  restSeconds: ['--rest'],
  computeBudget: ['--budget'],
  watchPort: ['--port'],
};

const FALSY = new Set(['0', 'false', 'off', 'no']);

/** Parse a raw string override against the default's type. Returns undefined when invalid
 *  (an invalid override keeps the prior layer's value — tolerant, never crashes the loop). */
function coerce(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof fallback === 'boolean') return !FALSY.has(String(raw).trim().toLowerCase());
  if (typeof fallback === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (fallback && typeof fallback === 'object') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...fallback, ...parsed }; // shallow-merge: override only the named keys
      }
    } catch { /* invalid JSON → keep prior layer */ }
    return undefined;
  }
  return String(raw);
}

/** Read the value following a flag (any of the given names) from argv, or undefined. */
function flagValue(argv, names) {
  for (const name of names) {
    const eq = argv.find((a) => typeof a === 'string' && a.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const i = argv.indexOf(name);
    if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  }
  return undefined;
}

/**
 * Resolve the loop config: defaults ← VAI_LOOP_* env ← CLI flags.
 * Returns { config, sources } — both frozen. sources maps every key to where its
 * value came from ('default' | 'env' | 'flag') so the watch dashboard can show WHY
 * the loop is running with a given knob (no more "which env var did I leave set?").
 */
export function loadLoopConfig({ env = process.env, argv = [] } = {}) {
  const config = {};
  const sources = {};
  for (const [key, fallback] of Object.entries(LOOP_DEFAULTS)) {
    let value = fallback;
    let source = 'default';

    const fromEnv = coerce(env[envKeyOf(key)], fallback);
    if (fromEnv !== undefined) { value = fromEnv; source = 'env'; }

    const names = [...(FLAG_ALIASES[key] ?? []), flagOf(key)];
    const fromFlag = coerce(flagValue(argv, names), typeof value === 'object' ? value : fallback);
    if (fromFlag !== undefined) { value = fromFlag; source = 'flag'; }

    config[key] = value && typeof value === 'object' ? deepFreeze({ ...value }) : value;
    sources[key] = source;
  }
  return { config: Object.freeze(config), sources: Object.freeze(sources) };
}
