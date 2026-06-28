/**
 * Risk-tier classifier for the audit→fix→verify self-improvement loop.
 *
 * The autonomy contract (agreed with Vegga): verified SAFE fixes may auto-commit to the
 * dedicated `council/auto-improve` branch, but anything that touches a high-stakes surface is
 * PROPOSE-ONLY and must be flagged to Vegga ("as my friend, tell me anything major"). This
 * module decides which side of that line a proposed fix falls on — it is the safety gate, so
 * it errs toward PROPOSE-ONLY when unsure (a false "safe" auto-applies a risky change; a false
 * "risky" only asks a human, which is cheap).
 *
 * Pure + dependency-free (no I/O) so it unit-tests exhaustively without git/fs.
 */

/** A proposed fix in the consensus-fix shape: a grep-verified literal find/replace in a file. */
// type Proposal = { file: string; find: string; replace: string; why?: string }

/** Risk tiers. 'safe' may auto-apply on green verification; 'review' is propose-only + flag. */
export const RISK_TIER = { SAFE: 'safe', REVIEW: 'review' };

/** Max net lines a 'safe' auto-fix may add/remove. Bigger = a refactor → review. */
export const MAX_SAFE_NET_LINES = 8;

// Path globs that are inherently high-stakes — a change here is always propose-only.
const RISKY_PATH = /(?:^|\/)(?:schema|migrations?|auth|security|secret|credential|payment|billing|money|\.env|drizzle)/i;

// Content signals that a change WEAKENS verification or does something irreversible/dangerous.
// Matched against BOTH the removed (find) and added (replace) text.
const RISKY_CONTENT = [
  /\b(?:rm\s+-rf|drop\s+table|truncate|delete\s+from)\b/i,                      // destructive shell/sql
  /\b(?:rmSync|rmdirSync?|rmdir|unlinkSync?|unlink|rimraf|fs\.rm)\b/i,           // destructive fs (node)
  /\bDROP\b|\bDELETE\b.*\bWHERE\b/i,                                            // SQL
  /\.skip\(|\.only\(|xit\(|xdescribe\(|todo:/i,                                 // disabling tests
  /expect\([^)]*\)\.(?:not\.)?toBe(?:Truthy|Defined)?\(\)\s*;?\s*$/i,           // gutting an assertion
  /eslint-disable|@ts-(?:ignore|expect-error|nocheck)|biome-ignore/i,          // silencing the linter/types
  /process\.exit|dangerouslySetInnerHTML|eval\(|child_process|execSync/i,      // dangerous APIs
];

// Signals checked on the ADDED (replace) side only — a change that INTRODUCES these is risky
// even if the removed line was innocent (the auditor-found bypasses 2026-06-22).
const RISKY_ADDED = [
  /process\.env\.[A-Z_]+|\b(?:secret|token|apikey|api_key|password|credential)\b/i, // secret/env access
  /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/,                                         // silent error swallow (empty catch)
  /\bawait\s+fetch\(|\b(?:https?\.request|axios|got)\(/i,                       // NEW network call / side effect
  /\beval\(|new\s+Function\(/,                                                  // dynamic code execution
  /\bglobalThis\s*\[|\bwindow\s*\[|\bFunction\b[^(]*\+/,                        // dynamic/obfuscated code access
];

// Behavior-change heuristic: WIDENING a regex (removing an anchor ^ or $, or trading a
// specific literal for a broad one) is the exact class that caused this session's Norway/hono
// over-broad-keyword bugs. If the find had an anchor and the replace dropped it, flag it.
function widensRegex(find, replace) {
  const isRegexLine = /\/[^/\n]+\/[gimsuy]*/.test(find) || /\/[^/\n]+\/[gimsuy]*/.test(replace);
  if (!isRegexLine) return false;
  const anchors = (s) => (s.match(/[\^$]/g) || []).length;
  return anchors(find) > anchors(replace); // lost an anchor → broader match
}

// A removal of these tokens (present in `find`, gone from `replace`) = weakening a guardrail.
const GUARDRAIL_TOKENS = [/factsQuarantined/, /verify\(/, /assert/, /redactSteeringText/, /isInfraError/];

/** Count net line delta of a find→replace (added minus removed, absolute). */
function netLineDelta(find, replace) {
  const f = String(find ?? '').split('\n').length;
  const r = String(replace ?? '').split('\n').length;
  return Math.abs(r - f);
}

/**
 * Classify a proposed fix. Returns { tier, reasons[] } — `reasons` is auditable (shown to
 * Vegga when it's propose-only, logged when it auto-applies). Never throws.
 */
export function classifyRisk(proposal) {
  const file = String(proposal?.file ?? '');
  const find = String(proposal?.find ?? '');
  const replace = String(proposal?.replace ?? '');
  const reasons = [];

  if (!file || !find) {
    return { tier: RISK_TIER.REVIEW, reasons: ['incomplete proposal (missing file or find) — cannot auto-apply'] };
  }
  if (RISKY_PATH.test(file)) reasons.push(`risky path: ${file}`);

  const both = `${find}\n${replace}`;
  for (const re of RISKY_CONTENT) {
    if (re.test(both)) reasons.push(`risky content matched ${re}`);
  }
  // Added-side-only signals (introducing a risky construct even if the removed line was clean).
  for (const re of RISKY_ADDED) {
    if (re.test(replace) && !re.test(find)) reasons.push(`introduces risky construct ${re}`);
  }
  // Behavior-change: a regex widening (lost an anchor) — the over-broad-keyword bug class.
  if (widensRegex(find, replace)) reasons.push('widens a regex (lost an anchor) — behavior-broadening, needs review');
  // Guardrail removal: token present in find but absent in replace.
  for (const re of GUARDRAIL_TOKENS) {
    if (re.test(find) && !re.test(replace)) reasons.push(`removes a guardrail token (${re})`);
  }
  const delta = netLineDelta(find, replace);
  if (delta > MAX_SAFE_NET_LINES) reasons.push(`large change: ${delta} net lines > ${MAX_SAFE_NET_LINES}`);

  return { tier: reasons.length > 0 ? RISK_TIER.REVIEW : RISK_TIER.SAFE, reasons };
}

/** Convenience: true when a proposal may auto-apply (verified-safe path). */
export function isAutoApplicable(proposal) {
  return classifyRisk(proposal).tier === RISK_TIER.SAFE;
}
