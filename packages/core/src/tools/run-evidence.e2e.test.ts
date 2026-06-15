import { describe, it, expect } from 'vitest';
import { runCommandEvidence } from './run-evidence.js';

/**
 * END-TO-END: spawn REAL `node` processes (node is on the allowlist) and assert the
 * captured evidence matches the actual run — exit codes, stdout, and the kill-on-timeout
 * path. Proves the spawn runner, not just the fake one.
 */

describe('runCommandEvidence — real node processes', () => {
  it('captures a passing run (exit 0) with stdout', async () => {
    const ev = await runCommandEvidence('node', ['-e', 'console.log("hello from node"); process.exit(0)']);
    expect(ev.ok).toBe(true);
    expect(ev.passed).toBe(true);
    expect(ev.exitCode).toBe(0);
    expect(ev.stdout).toContain('hello from node');
    expect(ev.durationMs).toBeGreaterThanOrEqual(0);
    expect(ev.id).toMatch(/^run:node:\d+$/);
  }, 20_000);

  it('captures a failing run (exit 1) with stderr', async () => {
    const ev = await runCommandEvidence('node', ['-e', 'console.error("boom"); process.exit(1)']);
    expect(ev.ok).toBe(true);
    expect(ev.passed).toBe(false);
    expect(ev.exitCode).toBe(1);
    expect(ev.stderr).toContain('boom');
  }, 20_000);

  it('kills and flags a run that exceeds the timeout', async () => {
    const ev = await runCommandEvidence('node', ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 500 });
    expect(ev.ok).toBe(true);
    expect(ev.timedOut).toBe(true);
    expect(ev.passed).toBe(false);
  }, 20_000);

  it('refuses a non-allowlisted real command before spawning', async () => {
    const ev = await runCommandEvidence('whoami', []);
    expect(ev.ok).toBe(false);
    expect(ev.error).toMatch(/allowlist/i);
  });
});
