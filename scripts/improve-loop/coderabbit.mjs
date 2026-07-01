/**
 * coderabbit — optional CodeRabbit CLI augmentation for council peer review.
 *
 * V3gga's ask: let council peers run their proposed change through CodeRabbit (free tier) so they
 * can IMPROVE their own suggestion before it's finalized — and work around CodeRabbit's free-tier
 * rate-limiting with a cooldown.
 *
 * CodeRabbit CLI (`cr` / `coderabbit`) has an `--agent` mode that emits structured JSON for agent
 * integrations. This module: (1) PROBES whether the binary is actually runnable; (2) runs a diff
 * through `cr --agent` and DEFENSIVELY parses the findings; (3) enforces a persisted ROLLING-HOUR
 * COOLDOWN so we never blow the free-tier limit (~3–4 reviews/hour).
 *
 * HONEST STATUS (2026-07): the CodeRabbit CLI does not yet support Windows (vendor: "coming soon").
 * On this machine the probe returns false and every entry point NO-OPS gracefully — peers simply
 * proceed without CodeRabbit. The seam + the cooldown are built and tested now so it lights up the
 * moment the binary is present (Windows support, or run under WSL/Linux/macOS).
 *
 * Pure logic (parse + cooldown math) is unit-tested; the `cr` spawn + fs are injected.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Free-tier budget: keep a safety margin under the documented ~3–4 reviews/hour so a burst of peers
// can't trip the server-side limit. Tunable via VAI_CODERABBIT_MAX_PER_HOUR.
export const DEFAULT_MAX_PER_HOUR = Number(process.env.VAI_CODERABBIT_MAX_PER_HOUR ?? 3);
export const HOUR_MS = 60 * 60 * 1000;
// Where the rolling-hour call log persists (so the cooldown survives process restarts — the limit
// is server-side per wall-clock hour, so in-memory-only would forget and over-call after a restart).
export const DEFAULT_BUDGET_PATH = 'scripts/improve-loop/.coderabbit-budget.json';

const CR_BINS = process.platform === 'win32' ? ['cr.exe', 'cr.cmd', 'coderabbit.exe', 'coderabbit.cmd', 'cr', 'coderabbit'] : ['cr', 'coderabbit'];

/**
 * Is a CodeRabbit CLI actually runnable here? Tries each candidate binary with `--version`. Returns
 * { available, bin, detail }. `run` is injected for tests; defaults to a real spawnSync probe.
 */
export function isCodeRabbitAvailable({ run = defaultProbe } = {}) {
  for (const bin of CR_BINS) {
    const r = run(bin, ['--version']);
    if (r && r.ok) return { available: true, bin, detail: (r.out || '').trim().slice(0, 80) };
  }
  return { available: false, bin: null, detail: 'CodeRabbit CLI not found on PATH (Windows support pending; peers proceed without it)' };
}

/**
 * DEFENSIVELY normalize `cr --agent` JSON into findings [{ file, line, severity, message }]. The
 * exact schema isn't publicly pinned, so we accept a range of shapes (findings[]/comments[]/
 * issues[]/reviews[]; file|path|filename; line|line_number|startLine; severity|level|type;
 * message|body|comment|description). Unknown/garbage → []. Never throws.
 */
export function parseCodeRabbitAgentOutput(raw) {
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch {
    // The CLI sometimes prints a banner before the JSON — try to salvage the first {...} or [...].
    const m = String(raw ?? '').match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/);
    if (!m) return [];
    try { data = JSON.parse(m[1]); } catch { return []; }
  }
  const arrays = collectFindingArrays(data);
  const out = [];
  for (const item of arrays) {
    if (!item || typeof item !== 'object') continue;
    const file = str(item.file ?? item.path ?? item.filename ?? item.location?.file ?? item.location?.path);
    const line = num(item.line ?? item.line_number ?? item.startLine ?? item.location?.line ?? item.location?.startLine);
    const severity = str(item.severity ?? item.level ?? item.type ?? item.kind ?? 'info').toLowerCase() || 'info';
    const message = str(item.message ?? item.body ?? item.comment ?? item.description ?? item.title ?? item.summary);
    if (!message) continue; // a finding with no text is not actionable
    out.push({ file: file || null, line: line ?? null, severity, message });
  }
  return out;
}

/** Compact the findings into a short block a peer can read + act on (feed back into its prompt). */
export function formatFindingsForPeer(findings, { max = 6 } = {}) {
  if (!findings.length) return '';
  const top = findings.slice(0, max);
  const lines = top.map((f) => `- [${f.severity}]${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : ''}: ${f.message}`);
  const more = findings.length > max ? `\n  (+${findings.length - max} more)` : '';
  return `CodeRabbit flagged the following on this change — address them if valid:\n${lines.join('\n')}${more}`;
}

// ── the ROLLING-HOUR COOLDOWN (the free-tier workaround) ──────────────────────────────────────
/**
 * CodeRabbitBudget — persisted rolling-window rate limiter. Records the timestamp of each call and
 * refuses (with time-until-next) once `maxPerHour` calls fall inside the trailing hour. Persists to
 * a JSON file so the window survives restarts (the limit is server-side per wall-clock hour). fs is
 * injected for tests.
 */
export class CodeRabbitBudget {
  constructor({ path = DEFAULT_BUDGET_PATH, maxPerHour = DEFAULT_MAX_PER_HOUR, windowMs = HOUR_MS, fs = defaultFs, now = () => Date.now() } = {}) {
    this.path = path;
    this.maxPerHour = maxPerHour;
    this.windowMs = windowMs;
    this.fs = fs;
    this.now = now;
  }

  _load() {
    try { return this.fs.exists(this.path) ? JSON.parse(this.fs.read(this.path)) : { calls: [] }; }
    catch { return { calls: [] }; }
  }

  /** Timestamps still inside the trailing window (older ones have aged out). */
  _recent(state) {
    const cutoff = this.now() - this.windowMs;
    return (state.calls ?? []).filter((t) => Number(t) >= cutoff);
  }

  /** Can we call right now? Returns { ok, remaining, retryInMs, retryInMin }. Pure read (no write). */
  check() {
    const recent = this._recent(this._load());
    const remaining = Math.max(0, this.maxPerHour - recent.length);
    if (remaining > 0) return { ok: true, remaining, retryInMs: 0, retryInMin: 0 };
    // Cooling down: the oldest call in the window frees a slot when it ages out.
    const oldest = Math.min(...recent);
    const retryInMs = Math.max(0, oldest + this.windowMs - this.now());
    return { ok: false, remaining: 0, retryInMs, retryInMin: Math.ceil(retryInMs / 60000) };
  }

  /** Record a call (call AFTER a successful review). Trims the persisted window. Returns remaining. */
  record() {
    const state = this._load();
    const recent = this._recent(state);
    recent.push(this.now());
    try { this.fs.write(this.path, JSON.stringify({ calls: recent }, null, 0)); } catch { /* best-effort */ }
    return Math.max(0, this.maxPerHour - recent.length);
  }
}

/**
 * Run a change through CodeRabbit if it's available AND the cooldown allows — otherwise NO-OP with a
 * reason (peers proceed without it). `run(bin, args)` spawns the CLI (injected); `budget` is a
 * CodeRabbitBudget. `target` is the diff file / path list `cr` should review (caller decides).
 * Returns { ran, skipped, reason, findings, block }.
 */
export function reviewWithCodeRabbit({ target, bin, run = defaultProbe, budget } = {}) {
  const b = budget ?? new CodeRabbitBudget();
  const gate = b.check();
  if (!gate.ok) {
    return { ran: false, skipped: true, reason: `CodeRabbit cooling down (free-tier limit) — retry in ~${gate.retryInMin} min`, findings: [], block: '' };
  }
  const args = ['--agent'];
  if (target) args.push(target);
  const r = run(bin ?? CR_BINS[0], args);
  if (!r || !r.ok) {
    return { ran: false, skipped: true, reason: `CodeRabbit run failed: ${(r && r.detail) || 'unavailable'}`, findings: [], block: '' };
  }
  b.record(); // count the successful call against the hourly budget
  const findings = parseCodeRabbitAgentOutput(r.out);
  return { ran: true, skipped: false, reason: `CodeRabbit returned ${findings.length} finding(s)`, findings, block: formatFindingsForPeer(findings) };
}

// ── injected-by-default I/O ────────────────────────────────────────────────────────
function defaultProbe(bin, args) {
  try {
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120_000, shell: false });
    const ok = r.status === 0 && !r.error;
    return { ok, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, detail: r.error ? String(r.error.code ?? r.error.message) : `exit ${r.status}` };
  } catch (e) {
    return { ok: false, out: '', detail: String(e).slice(0, 80) };
  }
}
const defaultFs = {
  exists: (p) => existsSync(p),
  read: (p) => readFileSync(p, 'utf8'),
  write: (p, c) => writeFileSync(p, c),
};

// ── tiny helpers ────────────────────────────────────────────────────────────────
function collectFindingArrays(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const key of ['findings', 'comments', 'issues', 'reviews', 'results', 'annotations']) {
    if (Array.isArray(data[key])) return data[key];
  }
  // Some shapes nest under review/data.
  for (const key of ['review', 'data', 'result']) {
    if (data[key] && typeof data[key] === 'object') {
      const nested = collectFindingArrays(data[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}
function str(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
