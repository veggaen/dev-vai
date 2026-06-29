import { describe, it, expect } from 'vitest';
import {
  runCommandEvidence,
  isAllowlistedCommand,
  hasRunEvidence,
  type CommandRunner,
  type RawRunResult,
} from './run-evidence.js';

/** Fake runner returning a fixed raw result — no real process spawns. */
function fakeRunner(raw: RawRunResult): CommandRunner {
  return async () => raw;
}

describe('isAllowlistedCommand — safe verification gate', () => {
  it('allows bare test/build/typecheck runners', () => {
    expect(isAllowlistedCommand('vitest', ['run'])).toBe(true);
    expect(isAllowlistedCommand('tsc', ['--noEmit'])).toBe(true);
    expect(isAllowlistedCommand('eslint', ['.'])).toBe(true);
    expect(isAllowlistedCommand('node', ['-e', 'process.exit(0)'])).toBe(true);
    expect(isAllowlistedCommand('/usr/bin/vitest', ['run'])).toBe(true); // path-stripped
    expect(isAllowlistedCommand('vitest.cmd', ['run'])).toBe(true);      // ext-stripped (win)
  });

  it('allows package managers ONLY with a verification subcommand', () => {
    expect(isAllowlistedCommand('pnpm', ['test'])).toBe(true);
    expect(isAllowlistedCommand('npm', ['run', 'build'])).toBe(true);
    expect(isAllowlistedCommand('npx', ['vitest', 'run'])).toBe(true);
  });

  it('REJECTS arbitrary / destructive commands', () => {
    expect(isAllowlistedCommand('rm', ['-rf', '/'])).toBe(false);
    expect(isAllowlistedCommand('curl', ['http://evil'])).toBe(false);
    expect(isAllowlistedCommand('bash', ['-c', 'whoami'])).toBe(false);
    expect(isAllowlistedCommand('git', ['push'])).toBe(false);
  });

  it('REJECTS package-manager mutating/network subcommands', () => {
    expect(isAllowlistedCommand('npm', ['install', 'evil-pkg'])).toBe(false);
    expect(isAllowlistedCommand('pnpm', ['add', 'malware'])).toBe(false);
    expect(isAllowlistedCommand('npm', ['publish'])).toBe(false);
    expect(isAllowlistedCommand('pnpm', ['dlx', 'anything'])).toBe(false);
  });

  it('REJECTS a forbidden token even alongside a safe subcommand', () => {
    expect(isAllowlistedCommand('npm', ['run', 'test', 'install'])).toBe(false);
    expect(isAllowlistedCommand('npx', ['vitest', '--registry', 'http://evil'])).toBe(false);
  });

  it('rejects npx pointing at a non-allowlisted tool', () => {
    expect(isAllowlistedCommand('npx', ['some-random-cli'])).toBe(false);
  });

  it('allows read-only git verbs for council self-verification', () => {
    expect(isAllowlistedCommand('git', ['status', '--porcelain'])).toBe(true);
    expect(isAllowlistedCommand('git', ['diff', '--stat'])).toBe(true);
    expect(isAllowlistedCommand('git', ['rev-parse', 'HEAD'])).toBe(true);
    expect(isAllowlistedCommand('git', ['log', '-1'])).toBe(true);
  });

  it('REJECTS mutating git verbs (only read-only verbs are gated in)', () => {
    expect(isAllowlistedCommand('git', ['push'])).toBe(false);
    expect(isAllowlistedCommand('git', ['commit', '-m', 'x'])).toBe(false);
    expect(isAllowlistedCommand('git', ['reset', '--hard'])).toBe(false);
    expect(isAllowlistedCommand('git', ['checkout', '.'])).toBe(false);
    expect(isAllowlistedCommand('git', [])).toBe(false); // no verb at all
  });

  it('allows `tauri info` but not build/dev', () => {
    expect(isAllowlistedCommand('tauri', ['info'])).toBe(true);
    expect(isAllowlistedCommand('tauri', ['build'])).toBe(false);
    expect(isAllowlistedCommand('tauri', ['dev'])).toBe(false);
  });

  it('allows rustc version/explain checks but blocks cargo install/publish', () => {
    expect(isAllowlistedCommand('rustc', ['--version'])).toBe(true);
    expect(isAllowlistedCommand('cargo', ['check'])).toBe(true);
    expect(isAllowlistedCommand('cargo', ['install', 'evil'])).toBe(false); // FORBIDDEN_TOKENS
    expect(isAllowlistedCommand('cargo', ['publish'])).toBe(false);
  });
});

describe('runCommandEvidence — refuses before spawning', () => {
  it('returns ok:false for a non-allowlisted command WITHOUT calling the runner', async () => {
    let called = false;
    const runner: CommandRunner = async () => { called = true; return { exitCode: 0, stdout: '', stderr: '', timedOut: false }; };
    const ev = await runCommandEvidence('rm', ['-rf', '/'], { runner });
    expect(ev.ok).toBe(false);
    expect(ev.error).toMatch(/allowlist/i);
    expect(called).toBe(false);
    expect(hasRunEvidence(ev)).toBe(false);
  });

  it('allowUnlisted opens the gate for an explicitly trusted caller', async () => {
    const ev = await runCommandEvidence('some-tool', ['--x'], {
      runner: fakeRunner({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }),
      allowUnlisted: true,
    });
    expect(ev.ok).toBe(true);
  });
});

describe('runCommandEvidence — result shaping', () => {
  it('shapes a passing run (exit 0)', async () => {
    const ev = await runCommandEvidence('vitest', ['run'], {
      runner: fakeRunner({ exitCode: 0, stdout: 'Tests 12 passed', stderr: '', timedOut: false }),
    });
    expect(ev.ok).toBe(true);
    expect(ev.passed).toBe(true);
    expect(ev.exitCode).toBe(0);
    expect(ev.stdout).toContain('12 passed');
    expect(ev.id).toMatch(/^run:vitest:\d+$/);
  });

  it('shapes a failing run (exit 1) — passed is false', async () => {
    const ev = await runCommandEvidence('vitest', ['run'], {
      runner: fakeRunner({ exitCode: 1, stdout: '', stderr: '1 failed', timedOut: false }),
    });
    expect(ev.passed).toBe(false);
    expect(ev.exitCode).toBe(1);
    expect(ev.stderr).toContain('failed');
  });

  it('shapes a timed-out run — passed false, timedOut true, exit null', async () => {
    const ev = await runCommandEvidence('vitest', ['run'], {
      runner: fakeRunner({ exitCode: null, stdout: '', stderr: '', timedOut: true }),
    });
    expect(ev.timedOut).toBe(true);
    expect(ev.passed).toBe(false);
    expect(ev.exitCode).toBeNull();
  });

  it('marks output truncated when it hits the cap', async () => {
    const big = 'x'.repeat(100);
    const ev = await runCommandEvidence('vitest', ['run'], {
      runner: fakeRunner({ exitCode: 0, stdout: big, stderr: '', timedOut: false }),
      maxOutputBytes: 50,
    });
    expect(ev.truncated).toBe(true);
  });

  it('returns ok:false when the runner throws (spawn failure)', async () => {
    const runner: CommandRunner = async () => { throw new Error('ENOENT'); };
    const ev = await runCommandEvidence('vitest', ['run'], { runner });
    expect(ev.ok).toBe(false);
    expect(ev.error).toMatch(/spawn failed/i);
  });
});
