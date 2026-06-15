/**
 * git-evidence — deep, read-only git as VERIFIABLE EVIDENCE, not as a model prompt.
 *
 * The power-user questions "what changed in my repo", "who wrote this line", "what's
 * the history of X", "how far ahead is my branch" should never go through a language
 * model to be answered — git already knows the exact answer. This module shells the
 * read-only git plumbing for those questions and returns STRUCTURED evidence: real
 * commit SHAs, diff hunks, blame line-attributions, branch ahead/behind counts — each
 * item carrying a stable `id` so a downstream capability can bind every surfaced claim
 * to a real source (and refuse anything it can't bind).
 *
 * This is the deterministic, no-model-call ("wormhole") foundation: a verifiable tool
 * with an explicit contract —
 *   - CAN DO:   diff / blame / log / branch state, read-only.
 *   - EVIDENCE:  typed {@link GitEvidence} with per-item ids + measured `durationMs`.
 *   - COST:      one `execFile` per sub-command, hard timeout, capped buffer; risk ≈ 0
 *                (no command mutates the repo — only `diff`/`blame`/`log`/`rev-parse`/
 *                `branch`/`rev-list` are ever run, never through a shell).
 *   - VERIFIED:  the caller binds claims to item ids; this module guarantees every id
 *                maps to real git output it actually observed.
 *
 * Safety & robustness, mirroring {@link WorkspaceStatusReader}:
 *   - `execFile` (NOT `exec`) so arguments are never interpreted by a shell.
 *   - Injectable `runner` so unit tests feed canned output and never touch real git.
 *   - Never throws to the caller — any failure (no git, not a repo, timeout, oversized
 *     output) yields `{ ok: false, error }` and the rest of the turn proceeds unchanged.
 */

import { execFile } from 'node:child_process';

/** A single changed-file summary from `git diff --numstat` / name-status. */
export interface GitChangedFile {
  /** Stable evidence id, e.g. `git:file:src/foo.ts`. */
  readonly id: string;
  /** Repo-relative path (post-rename path for renames). */
  readonly path: string;
  /** Change kind from name-status: added / modified / deleted / renamed. */
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unknown';
  /** Lines added (null for binary files where git reports `-`). */
  readonly additions: number | null;
  /** Lines deleted (null for binary). */
  readonly deletions: number | null;
  /** Whether this change is staged (index) vs only in the working tree. */
  readonly staged: boolean;
}

/** One hunk header from a unified diff (`@@ -a,b +c,d @@`). */
export interface GitDiffHunk {
  /** Stable evidence id, e.g. `git:hunk:src/foo.ts:42`. */
  readonly id: string;
  readonly path: string;
  /** Starting line in the new file for this hunk. */
  readonly newStart: number;
  /** Line count in the new file for this hunk. */
  readonly newLines: number;
  /** The hunk header text, verbatim, for display. */
  readonly header: string;
}

/** One blame line-attribution: which commit/author last touched a line. */
export interface GitBlameLine {
  /** Stable evidence id, e.g. `git:blame:src/foo.ts:42`. */
  readonly id: string;
  readonly path: string;
  readonly line: number;
  /** Abbreviated commit SHA that last changed this line. */
  readonly sha: string;
  readonly author: string;
  /** Author time as ISO-8601, when parseable. */
  readonly authoredAt: string | null;
  /** The source line content, trimmed. */
  readonly content: string;
}

/** One commit from `git log`. */
export interface GitLogEntry {
  /** Stable evidence id = `git:commit:<sha>`. */
  readonly id: string;
  /** Abbreviated commit SHA. */
  readonly sha: string;
  readonly author: string;
  readonly authoredAt: string | null;
  readonly subject: string;
}

/** Current branch position relative to its upstream. */
export interface GitBranchState {
  /** Stable evidence id = `git:branch:<name>`. */
  readonly id: string;
  readonly current: string;
  /** Commits ahead of upstream (null when no upstream / unknown). */
  readonly ahead: number | null;
  /** Commits behind upstream (null when no upstream / unknown). */
  readonly behind: number | null;
  /** Upstream ref name, when one is configured. */
  readonly upstream: string | null;
}

/** Everything gathered for one git evidence request. */
export interface GitEvidence {
  readonly ok: boolean;
  /** Absolute repo root (from `git rev-parse --show-toplevel`). */
  readonly workspaceRoot?: string;
  /** Files changed (working tree + index) — present for diff/status requests. */
  readonly changedFiles: readonly GitChangedFile[];
  /** Diff hunk headers — present when a diff was requested. */
  readonly hunks: readonly GitDiffHunk[];
  /** Blame attributions — present when a blame target was given. */
  readonly blame: readonly GitBlameLine[];
  /** Recent commits — present when history was requested. */
  readonly log: readonly GitLogEntry[];
  /** Branch position — present when branch state was requested. */
  readonly branch: GitBranchState | null;
  /** ISO timestamp the evidence was gathered (freshness signal). */
  readonly gatheredAt: string;
  /** Total wall time across the git sub-commands (cost signal). */
  readonly durationMs: number;
  /** Why the gather failed (present when !ok). */
  readonly error?: string;
}

export interface GitRunnerOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
}

/** Run one git invocation. Injectable so tests never shell out. */
export type GitRunner = (
  args: readonly string[],
  options: GitRunnerOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface GatherGitEvidenceOptions {
  /** Repo directory to run in. Default `process.cwd()`. */
  readonly cwd?: string;
  /** Hard per-command timeout (ms). Default 5_000. */
  readonly timeoutMs?: number;
  /** Inject a fake runner (tests). Default shells real git via execFile. */
  readonly runner?: GitRunner;
  /** File to blame (repo-relative). Omit to skip blame. */
  readonly blamePath?: string;
  /**
   * Revision to blame against (e.g. 'HEAD'). Omit to blame the working-tree file —
   * note that uncommitted lines then attribute to "Not Committed Yet", which is git's
   * honest answer. Pass 'HEAD' to attribute committed authorship.
   */
  readonly blameRev?: string;
  /** How many recent commits to include in the log. Default 10, max 100. */
  readonly logLimit?: number;
  /** Skip the diff gather (e.g. branch-only question). Default false. */
  readonly skipDiff?: boolean;
  /** Skip the log gather. Default false. */
  readonly skipLog?: boolean;
  /** Skip the branch-state gather. Default false. */
  readonly skipBranch?: boolean;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_LOG_LIMIT = 10;
const MAX_LOG_LIMIT = 100;
const MAX_BLAME_LINES = 400;
const MAX_BUFFER = 2 * 1024 * 1024;

/** Field separator for `--pretty` (unit-separator is safe inside subjects). */
const SEP = '\x1f';

/** Default runner — real git through execFile (no shell). */
const execGit: GitRunner = (args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args as string[],
      { cwd: options.cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: options.timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });

function statusFromCode(code: string): GitChangedFile['status'] {
  switch (code[0]) {
    case 'A': return 'added';
    case 'M': return 'modified';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'C': return 'copied';
    default: return 'unknown';
  }
}

/**
 * Parse `git diff --numstat -z` style rows we request as plain `--numstat`
 * (additions \t deletions \t path). Binary files report `-` for the counts.
 */
function parseNumstat(stdout: string, staged: boolean): GitChangedFile[] {
  const out: GitChangedFile[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [addStr, delStr, ...pathParts] = parts;
    const path = pathParts.join('\t').trim();
    if (!path) continue;
    const additions = addStr === '-' ? null : Number.parseInt(addStr, 10);
    const deletions = delStr === '-' ? null : Number.parseInt(delStr, 10);
    out.push({
      id: `git:file:${path}`,
      path,
      // numstat alone doesn't carry status; refined by name-status merge below.
      status: 'modified',
      additions: Number.isNaN(additions as number) ? null : additions,
      deletions: Number.isNaN(deletions as number) ? null : deletions,
      staged,
    });
  }
  return out;
}

/** Merge `--name-status` codes onto numstat rows so each file has a real status. */
function applyNameStatus(files: GitChangedFile[], nameStatus: string): GitChangedFile[] {
  const codeByPath = new Map<string, string>();
  for (const raw of nameStatus.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const code = parts[0];
    // Renames are `R100\told\tnew` — key on the destination path.
    const path = (parts.length >= 3 ? parts[parts.length - 1] : parts[1]).trim();
    codeByPath.set(path, code);
  }
  return files.map((f) => {
    const code = codeByPath.get(f.path);
    return code ? { ...f, status: statusFromCode(code) } : f;
  });
}

/** Parse unified-diff hunk headers (`@@ -a,b +c,d @@ ctx`) keyed to their file. */
function parseHunks(diff: string): GitDiffHunk[] {
  const out: GitDiffHunk[] = [];
  let currentPath = '';
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      currentPath = line.slice('+++ b/'.length).trim();
      continue;
    }
    if (line.startsWith('+++ ')) {
      // `+++ /dev/null` (deletion) — keep prior path empty so we skip these hunks.
      currentPath = line.includes('/dev/null') ? '' : line.slice(4).replace(/^b\//, '').trim();
      continue;
    }
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (m && currentPath) {
        const newStart = Number.parseInt(m[1], 10);
        const newLines = m[2] ? Number.parseInt(m[2], 10) : 1;
        out.push({
          id: `git:hunk:${currentPath}:${newStart}`,
          path: currentPath,
          newStart,
          newLines,
          header: line.trim(),
        });
      }
    }
  }
  return out;
}

/**
 * Parse `git blame --line-porcelain`. Each line block starts with
 * `<sha> <orig> <final> [group]` then key/value lines, ending with a `\t`-prefixed
 * content line. We pull sha, author, author-time and content per final line.
 */
function parseBlame(porcelain: string, path: string): GitBlameLine[] {
  const out: GitBlameLine[] = [];
  const lines = porcelain.split(/\r?\n/);
  let sha = '';
  let finalLine = 0;
  let author = '';
  let authorTime: number | null = null;
  for (const line of lines) {
    const headerMatch = line.match(/^([0-9a-f]{7,40}) \d+ (\d+)(?: \d+)?$/);
    if (headerMatch) {
      sha = headerMatch[1].slice(0, 12);
      finalLine = Number.parseInt(headerMatch[2], 10);
      author = '';
      authorTime = null;
      continue;
    }
    if (line.startsWith('author ')) {
      author = line.slice('author '.length).trim();
      continue;
    }
    if (line.startsWith('author-time ')) {
      const t = Number.parseInt(line.slice('author-time '.length).trim(), 10);
      authorTime = Number.isNaN(t) ? null : t;
      continue;
    }
    if (line.startsWith('\t')) {
      out.push({
        id: `git:blame:${path}:${finalLine}`,
        path,
        line: finalLine,
        sha,
        author,
        authoredAt: authorTime != null ? new Date(authorTime * 1000).toISOString() : null,
        content: line.slice(1).trim(),
      });
      if (out.length >= MAX_BLAME_LINES) break;
    }
  }
  return out;
}

/** Parse `git log --pretty=<sha>SEP<author>SEP<iso-date>SEP<subject>`. */
function parseLog(stdout: string): GitLogEntry[] {
  const out: GitLogEntry[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(SEP);
    if (parts.length < 4) continue;
    const [sha, author, date, ...subjectParts] = parts;
    const subject = subjectParts.join(SEP);
    const ts = Date.parse(date);
    out.push({
      id: `git:commit:${sha}`,
      sha,
      author,
      authoredAt: Number.isNaN(ts) ? null : new Date(ts).toISOString(),
      subject,
    });
  }
  return out;
}

/**
 * Gather read-only git evidence for the current repo. Never throws — failures
 * (no git, not a repo, timeout) come back as `{ ok: false, error, ... }`. Each
 * sub-gather is independent and best-effort: a blame failure does not lose the diff.
 */
export async function gatherGitEvidence(options: GatherGitEvidenceOptions = {}): Promise<GitEvidence> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runner = options.runner ?? execGit;
  const logLimit = Math.min(Math.max(1, options.logLimit ?? DEFAULT_LOG_LIMIT), MAX_LOG_LIMIT);
  const started = Date.now();

  const empty = (error: string): GitEvidence => ({
    ok: false,
    changedFiles: [],
    hunks: [],
    blame: [],
    log: [],
    branch: null,
    gatheredAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    error,
  });

  const run = (args: readonly string[]) => runner(args, { cwd, timeoutMs });

  // 0) Establish we are in a repo and get its root. If this fails, nothing else can run.
  let workspaceRoot: string;
  try {
    const { stdout } = await run(['rev-parse', '--show-toplevel']);
    workspaceRoot = stdout.trim();
    if (!workspaceRoot) return empty('git rev-parse returned an empty workspace root');
  } catch (err) {
    return empty(`not a git repository or git unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }

  let changedFiles: GitChangedFile[] = [];
  let hunks: GitDiffHunk[] = [];
  let blame: GitBlameLine[] = [];
  let log: GitLogEntry[] = [];
  let branch: GitBranchState | null = null;

  // 1) Diff: working-tree + staged numstat, refined with name-status, plus hunk headers.
  if (!options.skipDiff) {
    try {
      const [wtNum, stagedNum, wtName, stagedName, wtDiff, stagedDiff] = await Promise.all([
        run(['diff', '--numstat']).catch(() => ({ stdout: '', stderr: '' })),
        run(['diff', '--cached', '--numstat']).catch(() => ({ stdout: '', stderr: '' })),
        run(['diff', '--name-status']).catch(() => ({ stdout: '', stderr: '' })),
        run(['diff', '--cached', '--name-status']).catch(() => ({ stdout: '', stderr: '' })),
        run(['diff', '--unified=0']).catch(() => ({ stdout: '', stderr: '' })),
        run(['diff', '--cached', '--unified=0']).catch(() => ({ stdout: '', stderr: '' })),
      ]);
      const wtFiles = applyNameStatus(parseNumstat(wtNum.stdout, false), wtName.stdout);
      const stagedFiles = applyNameStatus(parseNumstat(stagedNum.stdout, true), stagedName.stdout);
      // De-dupe by path, preferring the staged entry's status when a path is in both.
      const byPath = new Map<string, GitChangedFile>();
      for (const f of [...wtFiles, ...stagedFiles]) {
        const prev = byPath.get(f.path);
        byPath.set(f.path, prev ? { ...prev, staged: prev.staged || f.staged, status: f.staged ? f.status : prev.status } : f);
      }
      changedFiles = [...byPath.values()];
      hunks = [...parseHunks(wtDiff.stdout), ...parseHunks(stagedDiff.stdout)];
    } catch {
      // Diff entirely unavailable — leave empty; other gathers still run.
    }
  }

  // 2) Blame: only when a target path is given. An optional revision attributes
  //    committed authorship (working-tree blame reports "Not Committed Yet" for
  //    uncommitted lines — git's honest answer, surfaced as-is when no rev given).
  if (options.blamePath) {
    try {
      const blameArgs = ['blame', '--line-porcelain'];
      if (options.blameRev) blameArgs.push(options.blameRev);
      blameArgs.push('--', options.blamePath);
      const { stdout } = await run(blameArgs);
      blame = parseBlame(stdout, options.blamePath);
    } catch {
      // File missing / not tracked — no blame evidence, not a hard failure.
    }
  }

  // 3) Log: recent history.
  if (!options.skipLog) {
    try {
      const { stdout } = await run([
        'log',
        `-${logLimit}`,
        `--pretty=%h${SEP}%an${SEP}%aI${SEP}%s`,
      ]);
      log = parseLog(stdout);
    } catch {
      // Empty repo (no commits yet) — no log evidence.
    }
  }

  // 4) Branch state: current branch + ahead/behind vs upstream.
  if (!options.skipBranch) {
    try {
      const { stdout: cur } = await run(['branch', '--show-current']);
      const current = cur.trim();
      let upstream: string | null = null;
      let ahead: number | null = null;
      let behind: number | null = null;
      try {
        const { stdout: up } = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
        upstream = up.trim() || null;
        if (upstream) {
          const { stdout: counts } = await run(['rev-list', '--left-right', '--count', `${upstream}...HEAD`]);
          const m = counts.trim().split(/\s+/);
          if (m.length === 2) {
            behind = Number.parseInt(m[0], 10);
            ahead = Number.parseInt(m[1], 10);
            if (Number.isNaN(behind)) behind = null;
            if (Number.isNaN(ahead)) ahead = null;
          }
        }
      } catch {
        // No upstream configured — ahead/behind stay null, which is honest.
      }
      branch = { id: `git:branch:${current || 'HEAD'}`, current: current || 'HEAD', ahead, behind, upstream };
    } catch {
      // Detached HEAD with no name, etc. — leave branch null.
    }
  }

  return {
    ok: true,
    workspaceRoot,
    changedFiles,
    hunks,
    blame,
    log,
    branch,
    gatheredAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
}

/** Every stable evidence id present in a {@link GitEvidence} — the bindable set. */
export function gitEvidenceIds(evidence: GitEvidence): Set<string> {
  const ids = new Set<string>();
  for (const f of evidence.changedFiles) ids.add(f.id);
  for (const h of evidence.hunks) ids.add(h.id);
  for (const b of evidence.blame) ids.add(b.id);
  for (const c of evidence.log) ids.add(c.id);
  if (evidence.branch) ids.add(evidence.branch.id);
  return ids;
}

/** True when the evidence carries at least one bindable item. */
export function hasGitEvidence(evidence: GitEvidence | undefined | null): evidence is GitEvidence {
  if (!evidence || !evidence.ok) return false;
  return (
    evidence.changedFiles.length > 0 ||
    evidence.hunks.length > 0 ||
    evidence.blame.length > 0 ||
    evidence.log.length > 0 ||
    evidence.branch !== null
  );
}
