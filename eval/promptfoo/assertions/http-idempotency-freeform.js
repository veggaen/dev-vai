/**
 * Free-form idempotency answers — deterministic gate before llm-rubric.
 * Rejects TLS/HTTPS rabbit holes common when retrieval confuses "HTTP".
 */
module.exports = (output) => {
  const text = typeof output === 'string' ? output : '';
  const lower = text.toLowerCase();

  if (!/idempot/i.test(text)) {
    return {
      pass: false,
      score: 0,
      reason: 'Must mention idempotency / idempotent operations',
    };
  }

  const httpish =
    /\bhttp\b|rest|api|request|method|client|server|retry|put|post|patch|delete|safe\b/i.test(lower);
  if (!httpish) {
    return {
      pass: false,
      score: 0,
      reason: 'Answer should stay in HTTP/API / retry context',
    };
  }

  if (/\*\*how https|^https\s*=|tls handshake/i.test(lower)) {
    return {
      pass: false,
      score: 0,
      reason: 'Answer drifted into TLS/HTTPS tutorial instead of idempotency',
    };
  }

  if (text.trim().length < 40) {
    return { pass: false, score: 0, reason: 'Answer too short to be a useful explanation' };
  }

  return { pass: true, score: 1, reason: 'Deterministic idempotency gate OK' };
};
