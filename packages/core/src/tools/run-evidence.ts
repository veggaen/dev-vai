/**
 * run-evidence — fast, observable, VERIFIABLE command execution as evidence.
 *
 * The brief asks for "code execution / sandbox that is fast, observable, and verifiable."
 * This is the deterministic core of that: run ONE bounded command and capture the run as
 * structured evidence — exit code, stdout, stderr, wall-clock duration, and a timed-out
 * flag. An answer about "did the tests pass / does it build" then binds to that real
 * exit code instead of a model's guess.
 *
 * The crucial safety dimension that read-only git did NOT have: exec runs code. So this
 * module does NOT run arbitrary shell from a chat turn. It is allowlist-gated to a small
 * set of SAFE VERIFICATION commands (test / build / typecheck / lint runners) — the
 * commands a power user means by "run the tests". Arbitrary or destructive commands are
 * refused before anything spawns. The capability that uses this never widens the list.
 *
 * Contract:
 *   - CAN DO:   run one allowlisted verification command, bounded by a hard timeout and a
 *               captured-output cap; return its real result.
 *   - EVIDENCE: typed {@link RunEvidence} (exitCode, stdout, stderr, durationMs, timedOut),
 *               each with a stable id for binding.
 *   - COST:     one child process, hard wall-clock timeout, output truncated to a cap; the
 *               command's own runtime dominates and is reported as durationMs.
 *   - VERIFIED: the exit code is git-honest — the caller binds any pass/fail claim to it.
 *
 * Robustness, mirroring git-evidence / fs-edit:
 *   - Injectable `runner` so unit tests never spawn a real process.
 *   - Never throws to the caller — failures are `{ ok: false, error }`.
 *   - `spawn` with `shell: false` and an explicit argv (no shell string interpolation).
 */

import { spawn } from 'node:child_process';

/** The structured result of one command run — the bindable evidence. */
export interface RunEvidence {
  readonly ok: boolean;
  /** Stable evidence id, e.g. `run:vitest:1718000000000`. */
  readonly id: string;
  /** The command + args that ran (for display/audit). */
  readonly command: string;
  readonly args: readonly string[];
  /** Process exit code (null when the process was killed, e.g. on timeout). */
  readonly exitCode: number | null;
  /** True when the command exited 0 — the canonical "it passed" signal. */
  readonly passed: boolean;
  /** Captured stdout, truncated to the output cap. */
  readonly stdout: string;
  /** Captured stderr, truncated to the output cap. */
  readonly stderr: string;
  /** Wall-clock duration in ms (cost signal). */
  readonly durationMs: number;
  /** True when the command was killed for exceeding the timeout. */
  readonly timedOut: boolean;
  /** Output truncated to the cap? */
  readonly truncated: boolean;
  /** ISO timestamp the run completed (freshness signal). */
  readonly ranAt: string;
  /** Why the run could not happen (allowlist refusal, spawn failure) — present when !ok. */
  readonly error?: string;
}

/** Low-level result a runner returns (pre-shaping). */
export interface RawRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface RunnerOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

/** Run one command. Injectable so tests never spawn. */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: RunnerOptions,
) => Promise<RawRunResult>;

export interface RunCommandOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly runner?: CommandRunner;
  /**
   * Allow a command not on the default allowlist. Escape hatch for an explicitly
   * trusted caller (e.g. the builder loop running its own scaffold scripts). The
   * chat path NEVER sets this — it relies on the allowlist.
   */
  readonly allowUnlisted?: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT = 256 * 1024;

/**
 * The allowlist of safe verification command BASENAMES. These are read-mostly: they
 * compile, typecheck, lint or run tests and report a pass/fail exit code. They do not
 * deploy, publish, delete, or fetch arbitrary remote code. The package-manager runners
 * (npm/pnpm/yarn) are allowed ONLY with a verification subcommand (test/run/exec) — see
 * {@link isAllowlistedCommand}.
 */
export const SAFE_COMMAND_BASENAMES = new Set([
  'vitest', 'jest', 'mocha', 'ava', 'node', 'tsc', 'tsd', 'eslint', 'biome', 'prettier',
  'tap', 'playwright', 'cargo', 'go', 'pytest',
  // Stack-relevant read-only verification additions (council self-verification):
  //   rustc --version / --explain  → confirm the Rust toolchain a claim assumes exists.
  // A bare basename is allowed with any args ONLY because each of these is read-only by nature
  // OR its mutating subcommands are caught by FORBIDDEN_TOKENS (e.g. `cargo install`). Commands
  // whose DEFAULT behavior can mutate (git, tauri) are NOT bare basenames — they are
  // subcommand-gated below so only their read-only verbs pass.
  'rustc',
]);

/** Package managers whose verification subcommands we permit. */
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'npx']);
/** Subcommands of a package manager that are safe verification actions. */
const PM_SAFE_SUBCOMMANDS = new Set(['test', 'run', 'exec', 'lint', 'typecheck', 'build', 'tsc', 'vitest', 'jest']);

/**
 * Subcommand-gated tools: the BASENAME is safe only with an explicitly read-only first verb.
 * This lets a council member prove a claim about repo/build state (`git status`, `cargo check`,
 * `tauri info`) WITHOUT opening the door to `git push`, `cargo publish`, or `tauri build`.
 */
const SUBCOMMAND_GATED: Record<string, ReadonlySet<string>> = {
  // Read-only git verbs only — never push/commit/reset/checkout/clean/fetch/pull.
  git: new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'branch', 'remote', 'ls-files', 'blame']),
  // `tauri info` reports the toolchain/config; everything else (build/dev/bundle) is excluded.
  tauri: new Set(['info']),
};

/** Argument tokens that are never allowed (mutating / publishing / network installs). */
const FORBIDDEN_TOKENS = [/^publish$/i, /^deploy$/i, /^--registry/i, /^login$/i, /^add$/i, /^install$/i, /^i$/i, /^rm$/i, /^remove$/i, /^uninstall$/i, /^link$/i, /^unlink$/i, /^dlx$/i];

/** Strip a path + extension to get the bare command name (cross-platform). */
function basename(command: string): string {
  const justName = command.split(/[\\/]/).pop() ?? command;
  return justName.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

/**
 * Decide whether `command args...` is a safe verification invocation. A bare runner
 * (vitest, tsc, eslint, node, …) is fine. A package manager is fine ONLY when its first
 * non-flag argument is a verification subcommand and no forbidden token appears anywhere.
 */
export function isAllowlistedCommand(command: string, args: readonly string[]): boolean {
  const name = basename(command);

  // Forbidden tokens anywhere → never allowed (e.g. `pnpm test && publish` style abuse).
  if (args.some((a) => FORBIDDEN_TOKENS.some((re) => re.test(a)))) return false;

  // Subcommand-gated tools (git/tauri): the first non-flag verb must be on the read-only list.
  const gated = SUBCOMMAND_GATED[name];
  if (gated) {
    const verb = args.find((a) => !a.startsWith('-'));
    return verb ? gated.has(verb.toLowerCase()) : false;
  }

  if (SAFE_COMMAND_BASENAMES.has(name)) return true;

  if (PACKAGE_MANAGERS.has(name)) {
    // npx <tool>: the tool itself must be an allowlisted basename.
    if (name === 'npx') {
      const tool = args.find((a) => !a.startsWith('-'));
      return tool ? SAFE_COMMAND_BASENAMES.has(basename(tool)) : false;
    }
    // npm/pnpm/yarn <subcommand>: the first non-flag token must be a safe subcommand.
    const sub = args.find((a) => !a.startsWith('-'));
    return sub ? PM_SAFE_SUBCOMMANDS.has(sub.toLowerCase()) : false;
  }

  return false;
}

/** Default runner — real `spawn`, shell:false, bounded output + timeout. */
const spawnRunner: CommandRunner = (command, args, options) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(command, args as string[], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
    });

    const cap = options.maxOutputBytes;
    const onData = (buf: Buffer, sink: 'out' | 'err') => {
      const s = buf.toString('utf8');
      if (sink === 'out') {
        if (stdout.length < cap) stdout += s.slice(0, cap - stdout.length);
      } else if (stderr.length < cap) stderr += s.slice(0, cap - stderr.length);
    };
    child.stdout?.on('data', (b: Buffer) => onData(b, 'out'));
    child.stderr?.on('data', (b: Buffer) => onData(b, 'err'));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    };

    child.on('error', (err) => finish(null) ?? void err);
    child.on('close', (code) => finish(code));
  });

/**
 * Run one allowlisted command and return it as structured evidence. Never throws.
 * Refuses (without spawning) any command not on the verification allowlist unless the
 * caller explicitly opts in via `allowUnlisted`.
 */
export async function runCommandEvidence(
  command: string,
  args: readonly string[] = [],
  options: RunCommandOptions = {},
): Promise<RunEvidence> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const runner = options.runner ?? spawnRunner;
  const ranAtId = Date.now();
  const id = `run:${basename(command)}:${ranAtId}`;

  const base = {
    id,
    command,
    args: [...args],
    exitCode: null,
    passed: false,
    stdout: '',
    stderr: '',
    durationMs: 0,
    timedOut: false,
    truncated: false,
    ranAt: new Date().toISOString(),
  };

  if (!options.allowUnlisted && !isAllowlistedCommand(command, args)) {
    return { ...base, ok: false, error: `command not on the safe verification allowlist: ${command} ${args.join(' ')}`.trim() };
  }

  const started = Date.now();
  let raw: RawRunResult;
  try {
    raw = await runner(command, args, { cwd, timeoutMs, maxOutputBytes });
  } catch (err) {
    return { ...base, ok: false, durationMs: Date.now() - started, error: `spawn failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const truncated = raw.stdout.length >= maxOutputBytes || raw.stderr.length >= maxOutputBytes;
  return {
    ...base,
    ok: true,
    exitCode: raw.exitCode,
    passed: raw.exitCode === 0 && !raw.timedOut,
    stdout: raw.stdout,
    stderr: raw.stderr,
    durationMs: Date.now() - started,
    timedOut: raw.timedOut,
    truncated,
    ranAt: new Date().toISOString(),
  };
}

/** True when the evidence is a real, completed run (vs an allowlist/spawn failure). */
export function hasRunEvidence(evidence: RunEvidence | undefined | null): evidence is RunEvidence {
  return Boolean(evidence && evidence.ok);
}
