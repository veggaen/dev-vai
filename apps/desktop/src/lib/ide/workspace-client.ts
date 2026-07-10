/**
 * Council-IDE — desktop client for the attached workspace (Layer 1 wiring).
 *
 * Thin bridge between the Rust file commands (`ide_list_dir` / `ide_read_file` /
 * `ide_write_file`) and the pure diff/approval model in `@vai/core`. All path safety is
 * enforced on BOTH sides: here (isSafeRelativePath) and again in Rust (ide_resolve), so a
 * bad path is rejected even if one layer is bypassed. Writes only happen for proposals the
 * user approved.
 */

import {
  changeStats,
  isSafeRelativePath,
  lineDiff,
  makeProposal,
  type FileEditProposal,
} from '@vai/core/browser';
import type { ReviewProposal, ReviewDiffLine } from '../../components/ide/DiffReview.js';
import { apiFetch } from '../api.js';

export interface WorkspaceEntry {
  readonly path: string;
  readonly dir: boolean;
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

/** Basename of an absolute folder path, for the chat's folder chip. */
export function folderName(absPath: string): string {
  const parts = absPath.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || absPath;
}

/** List the workspace tree (relative paths, vendored dirs already filtered in Rust). */
export async function listWorkspace(root: string): Promise<WorkspaceEntry[]> {
  const json = await invoke<string>('ide_list_dir', { root });
  const parsed = JSON.parse(json) as WorkspaceEntry[];
  return Array.isArray(parsed) ? parsed : [];
}

export async function readWorkspaceFile(root: string, rel: string): Promise<string> {
  if (!isSafeRelativePath(rel)) throw new Error(`unsafe path: ${rel}`);
  return invoke<string>('ide_read_file', { root, rel });
}

async function writeWorkspaceFile(root: string, rel: string, content: string): Promise<void> {
  if (!isSafeRelativePath(rel)) throw new Error(`unsafe path: ${rel}`);
  await invoke<void>('ide_write_file', { root, rel, content });
}

/**
 * Ask a LOCAL coder model (via the runtime) to apply `task` to one file, and return a
 * proposal (before = current content, after = the model's rewrite). Runs entirely on the
 * user's own models — no external tokens. `role` optionally selects a specialist prompt.
 */
export async function proposeEdit(
  root: string,
  rel: string,
  content: string,
  task: string,
  options?: { role?: string; memberId?: string },
): Promise<FileEditProposal | null> {
  const response = await apiFetch('/api/ide/propose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, path: rel, content, role: options?.role }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Coder model failed (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { after?: string; model?: string };
  const after = typeof body.after === 'string' ? after0(body.after) : '';
  return makeProposal(rel, content, after, {
    summary: task.length > 60 ? `${task.slice(0, 57)}…` : task,
    author: { memberId: options?.memberId ?? (body.model ?? 'coder'), role: options?.role },
  });
}

function after0(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

export interface CouncilResult {
  readonly proposals: FileEditProposal[];
  /** Role of the candidate the judge picked (for highlighting), or null. */
  readonly judgeRole: string | null;
  readonly rationale: string;
}

/**
 * Run the local council: several role-specialists each propose an edit, a judge picks the
 * best. Returns one proposal per candidate (labelled by role) so the review panel can show
 * them side by side, plus which role the judge favoured. All local — no external tokens.
 */
export async function proposeCouncil(
  root: string,
  rel: string,
  content: string,
  task: string,
  roles: string[],
): Promise<CouncilResult> {
  const response = await apiFetch('/api/ide/council', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, path: rel, content, roles }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Council failed (HTTP ${response.status})`);
  }
  const body = (await response.json()) as {
    candidates?: { role: string; after: string; model: string }[];
    judge?: { pick: number; rationale: string };
  };
  const candidates = body.candidates ?? [];
  const proposals = candidates
    .map((c) =>
      makeProposal(rel, content, after0(c.after), {
        summary: task.length > 60 ? `${task.slice(0, 57)}…` : task,
        author: { memberId: c.model, role: c.role },
      }),
    )
    .filter((p): p is FileEditProposal => p !== null);
  const pick = body.judge?.pick ?? 0;
  const judgeRole = candidates[pick]?.role ?? null;
  return { proposals, judgeRole, rationale: body.judge?.rationale ?? '' };
}

/** Turn a core FileEditProposal into the DiffReview panel's view-model. */
export function toReviewProposal(p: FileEditProposal): ReviewProposal {
  const before = p.before === null ? [] : p.before.split('\n');
  const after = p.after === null ? [] : p.after.split('\n');
  const stats = changeStats(p);
  const diff: ReviewDiffLine[] = lineDiff(before, after);
  const role = p.author.role ? ` · ${p.author.role}` : '';
  return {
    id: p.id,
    path: p.path,
    author: `${p.author.memberId}${role}`,
    status: p.status,
    isNew: stats.isNew,
    isDelete: stats.isDelete,
    added: stats.added,
    removed: stats.removed,
    diff,
  };
}

/**
 * Write every APPROVED proposal to disk (deletes when `after === null`). Returns the ids
 * that were written. Rejected/pending proposals are skipped — this is the commit step that
 * runs only after the user reviewed the diffs.
 */
/** Create a reversible checkpoint before applying approved diffs. */
export async function createWorkspaceCheckpoint(root: string): Promise<string> {
  return invoke<string>('ide_create_checkpoint', { root });
}

/** Run a shell command in the workspace root (terminal panel). */
export async function runWorkspaceCommand(root: string, command: string): Promise<string> {
  return invoke<string>('ide_run_command', { root, command });
}

export async function spawnDevServer(root: string, command: string): Promise<string> {
  return invoke<string>('ide_spawn_dev_server', { root, command });
}

export async function stopDevServerProcess(): Promise<void> {
  await invoke<void>('ide_stop_dev_server', {});
}

export async function probeLocalPort(port: number): Promise<boolean> {
  return invoke<boolean>('ide_probe_port', { port });
}

export async function tailDevLog(path: string, maxBytes = 32_000): Promise<string> {
  return invoke<string>('ide_tail_dev_log', { path, maxBytes });
}

/** Run typecheck gate if tsconfig exists — returns pass + output. */
export async function runTypecheckGate(root: string): Promise<{ pass: boolean; detail: string }> {
  try {
    await readWorkspaceFile(root, 'tsconfig.json');
  } catch {
    return { pass: true, detail: 'No tsconfig.json — skipped' };
  }
  try {
    const out = await runWorkspaceCommand(root, 'pnpm exec tsc --noEmit 2>&1');
    const pass = !/\berror TS\d+\b/i.test(out);
    return { pass, detail: out.slice(0, 4000) };
  } catch (e) {
    return { pass: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function applyApprovedProposals(
  root: string,
  proposals: readonly FileEditProposal[],
): Promise<string[]> {
  const written: string[] = [];
  for (const p of proposals) {
    if (p.status !== 'approved') continue;
    if (p.after === null) continue; // deletion handling comes in a later slice
    await writeWorkspaceFile(root, p.path, p.after);
    written.push(p.id);
  }
  return written;
}
