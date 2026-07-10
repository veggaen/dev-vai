/**
 * Council-IDE substrate — workspace + edit-proposal model (Layer 1).
 *
 * Pure and dependency-free on purpose: this is the shared vocabulary the Tauri file layer,
 * the React diff UI, and the council routing all build on. Nothing here touches the disk or
 * the network — writes only ever happen elsewhere, AFTER a proposal is approved.
 *
 * Design invariant (matches the user's "review every diff" choice): an agent produces a
 * {@link FileEditProposal}; a human approves it; only then does a caller write `after` to
 * `path`. Proposals are inert data until approved.
 */

/** A folder the user attached to a chat. */
export interface WorkspaceRef {
  readonly id: string;
  /** Absolute path on the user's machine (never shown raw in UI). */
  readonly path: string;
  /** Display name — usually the folder's basename. */
  readonly name: string;
  readonly attachedAt: string;
}

/** Which agent/role authored a proposal (for attribution in the diff UI). */
export interface EditAuthor {
  /** Council member id, or 'vai' for the primary. */
  readonly memberId: string;
  /** Role hat worn for this edit, e.g. 'frontend' | 'backend' | 'animation' | 'human-sim'. */
  readonly role?: string;
}

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

/** A proposed change to a single file. `before === null` = new file; `after === null` = delete. */
export interface FileEditProposal {
  readonly id: string;
  /** Path RELATIVE to the workspace root — never absolute, never escaping the root. */
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
  /** One-line human summary of the change. */
  readonly summary: string;
  readonly author: EditAuthor;
  readonly status: ReviewStatus;
}

export interface DiffLine {
  readonly kind: 'context' | 'add' | 'remove';
  readonly text: string;
}

export interface ChangeStats {
  readonly added: number;
  readonly removed: number;
  readonly isNew: boolean;
  readonly isDelete: boolean;
}

/** Files we should never open as text for a diff (binary/oversized). */
const MAX_DIFF_BYTES = 512 * 1024;
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip', 'gz', 'tar', 'exe', 'dll',
  'wasm', 'woff', 'woff2', 'ttf', 'otf', 'mp3', 'mp4', 'mov', 'wav', 'bin', 'node',
]);

export function isProbablyBinaryPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXT.has(ext);
}

/** A NUL byte in "text" means it's really binary — scanned via char code so no control
 *  character is ever embedded in this source file. */
function hasNulByte(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 0) return true;
  }
  return false;
}

/** True when the content is safe to diff as text (not binary, not oversized). */
export function isDiffable(path: string, content: string | null): boolean {
  if (content === null) return true; // new file / deletion is fine to represent
  if (isProbablyBinaryPath(path)) return false;
  if (content.length > MAX_DIFF_BYTES) return false;
  return !hasNulByte(content);
}

/** A relative path is safe iff it stays inside the workspace root (no `..`, no absolute/drive). */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false; // Windows drive letter
  const parts = path.replace(/\\/g, '/').split('/');
  return !parts.includes('..') && !parts.includes('');
}

let proposalSeq = 0;
function nextId(): string {
  proposalSeq += 1;
  return `edit_${Date.now().toString(36)}_${proposalSeq}`;
}

/**
 * Build a proposal from before/after. Returns null when nothing actually changed — a no-op
 * must never reach the review UI (avoids the "0 changes" cards that plague agent tools).
 */
export function makeProposal(
  path: string,
  before: string | null,
  after: string | null,
  meta: { summary: string; author: EditAuthor },
): FileEditProposal | null {
  if (before === after) return null;
  return {
    id: nextId(),
    path,
    before,
    after,
    summary: meta.summary,
    author: meta.author,
    status: 'pending',
  };
}

export function withStatus(proposal: FileEditProposal, status: ReviewStatus): FileEditProposal {
  return { ...proposal, status };
}

function splitLines(text: string): string[] {
  return text.split('\n');
}

/** Summary counts for the diff header ("+12 -3", new file, deletion). */
export function changeStats(proposal: FileEditProposal): ChangeStats {
  const isNew = proposal.before === null;
  const isDelete = proposal.after === null;
  const beforeLines = proposal.before === null ? [] : splitLines(proposal.before);
  const afterLines = proposal.after === null ? [] : splitLines(proposal.after);
  const diff = lineDiff(beforeLines, afterLines);
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.kind === 'add') added += 1;
    else if (line.kind === 'remove') removed += 1;
  }
  return { added, removed, isNew, isDelete };
}

/**
 * Minimal LCS-based line diff — enough to render a readable review, zero deps. Not a
 * production Myers diff; correctness over optimality (files here are human-sized).
 */
export function lineDiff(before: readonly string[], after: readonly string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: 'context', text: before[i] });
      i += 1; j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'remove', text: before[i] });
      i += 1;
    } else {
      out.push({ kind: 'add', text: after[j] });
      j += 1;
    }
  }
  while (i < n) { out.push({ kind: 'remove', text: before[i] }); i += 1; }
  while (j < m) { out.push({ kind: 'add', text: after[j] }); j += 1; }
  return out;
}
