/**
 * Baseline checks for every HTTP chat eval: non-empty output, size cap, optional latency ceiling.
 * config: { minChars?, maxChars?, maxLatencyMs? }
 */
module.exports = (output, context) => {
  const minChars = context.config?.minChars ?? 1;
  const maxChars = context.config?.maxChars ?? 100_000;
  const maxLatencyMs = context.config?.maxLatencyMs;
  const s = typeof output === 'string' ? output : '';

  if (s.trim().length < minChars) {
    return { pass: false, score: 0, reason: `Expected at least ${minChars} non-whitespace chars; got ${s.trim().length}` };
  }
  if (s.length > maxChars) {
    return { pass: false, score: 0, reason: `Output too long: ${s.length} chars (max ${maxChars})` };
  }

  if (maxLatencyMs != null && Number.isFinite(maxLatencyMs)) {
    const ms = context.providerResponse?.latencyMs;
    if (typeof ms === 'number' && ms > maxLatencyMs) {
      return {
        pass: false,
        score: 0,
        reason: `Round-trip latency ${ms}ms exceeds budget ${maxLatencyMs}ms`,
      };
    }
  }

  return { pass: true, score: 1, reason: 'Contract OK' };
};
