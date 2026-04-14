/**
 * Assert output contains a numeric result (config.expected may be string or number).
 */
module.exports = (output, context) => {
  const expected = context.config?.expected;
  if (expected === undefined || expected === null) {
    return { pass: false, score: 0, reason: 'contains-number: missing config.expected' };
  }
  const hay = String(output).replace(/\*\*/g, '').replace(/`/g, '');
  const needle = String(expected);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^0-9])${escaped}(?:[^0-9]|$)`);
  if (!re.test(hay)) {
    return { pass: false, score: 0, reason: `Expected numeric result ${needle} not found in output` };
  }
  return { pass: true, score: 1, reason: `Found ${needle}` };
};
