/**
 * infer-run-command — turn an exec/verify question into the actual allowlisted command to run.
 *
 * The gap this closes (the loop's chosen feature: "Real-World Tool Invocation"): Vai HAS an exec
 * capability and a safe command runner (run-evidence.ts), but they were never connected in a live
 * turn — exec ran in SHADOW only and nothing attached run evidence, so "do the tests pass?" always
 * got the non-answer "I can answer that by running it, but no command was run". This maps the
 * question → the right verification command for the project, so the turn can ACTUALLY run it and
 * answer from the real exit code. Pure: it reads the project shape (package.json) via an injected
 * reader, never spawns. The safe runner (runCommandEvidence) does the spawning, allowlist-gated.
 */

export interface InferredCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** Which verification the user asked for, for the answer's framing. */
  readonly kind: 'test' | 'build' | 'typecheck' | 'lint';
  /** Why this command was chosen (for the trace). */
  readonly reason: string;
}

/** A minimal project-shape probe: does package.json have a script with this name? Injected reader
 *  so this stays pure/testable; the live caller passes a real fs read of <cwd>/package.json. */
export interface ProjectProbe {
  /** Parsed package.json scripts map, or null when there's no package.json. */
  readonly scripts: Record<string, string> | null;
  /** True when this looks like a Node/TS project (package.json present). */
  readonly hasPackageJson: boolean;
}

const KIND_RE: Array<{ kind: InferredCommand['kind']; re: RegExp }> = [
  { kind: 'typecheck', re: /\b(typecheck|type-check|tsc|types?\s+(?:pass|check)|compile)\b/i },
  { kind: 'lint', re: /\b(lint|eslint|biome)\b/i },
  { kind: 'build', re: /\b(build|compiles?|does it build|is the build)\b/i },
  { kind: 'test', re: /\b(tests?|test suite|specs?|passing|do the tests|are the tests)\b/i },
];

/** The package.json script name we prefer for each verification kind, in order. */
const SCRIPT_PREFERENCE: Record<InferredCommand['kind'], string[]> = {
  test: ['test', 'test:unit', 'vitest'],
  build: ['build'],
  typecheck: ['typecheck', 'type-check', 'tsc'],
  lint: ['lint', 'eslint'],
};

/** Direct command fallback when there's no matching package script (still allowlisted). */
const DIRECT_FALLBACK: Record<InferredCommand['kind'], { command: string; args: string[] } | null> = {
  test: null,                                   // tests need a script/config — don't guess a bare runner
  build: null,
  typecheck: { command: 'npx', args: ['tsc', '--noEmit'] },
  lint: { command: 'npx', args: ['eslint', '.'] },
};

/** Classify which verification the question is about. Defaults to 'test' for a generic "does it pass". */
export function inferKind(text: string): InferredCommand['kind'] {
  for (const { kind, re } of KIND_RE) if (re.test(text ?? '')) return kind;
  return 'test';
}

/**
 * Infer the command to run for an exec/verify question, given the project shape. Returns null when
 * no safe command can be chosen (no package.json + no direct fallback) — the caller then keeps the
 * honest "no command was run" answer rather than guessing.
 * @param pm package manager to invoke scripts with (default 'npm'); the runner allowlists npm/pnpm/yarn.
 */
export function inferRunCommand(text: string, probe: ProjectProbe, pm: string = 'npm'): InferredCommand | null {
  const kind = inferKind(text);

  // 1) Prefer a real package.json script (npm run <script>) — the project's own verification.
  if (probe.hasPackageJson && probe.scripts) {
    for (const name of SCRIPT_PREFERENCE[kind]) {
      if (probe.scripts[name]) {
        // `npm test` is special-cased by npm; everything else uses `run`.
        const args = name === 'test' && pm === 'npm' ? ['test'] : ['run', name];
        return { command: pm, args, kind, reason: `project has a "${name}" script` };
      }
    }
  }

  // 2) Direct allowlisted fallback (typecheck/lint can run without a script).
  const direct = DIRECT_FALLBACK[kind];
  if (direct) return { command: direct.command, args: [...direct.args], kind, reason: `no "${kind}" script — running ${direct.command} ${direct.args.join(' ')} directly` };

  // 3) Nothing safe to run.
  return null;
}
