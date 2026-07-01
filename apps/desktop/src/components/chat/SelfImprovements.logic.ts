/**
 * SelfImprovements.logic — pure shaping for the "Council improved Vai" panel. The panel reads the
 * council changelog (/api/council/changelog) and surfaces recent self-improvements under a collapsed
 * menu; when opened, each entry (step) is expanded by default so V3gga reads the process, not a teaser.
 *
 * Pure + framework-free so it's unit-tested without React (the .tsx stays thin, per the UI-defer rule).
 */

export interface CouncilChangeEntry {
  readonly schema?: string;
  readonly at?: string | null;
  readonly kind?: string | null;
  readonly title?: string | null;
  readonly why?: string | null;
  readonly area?: string | null;
  readonly files?: readonly string[];
  readonly verification?: string | null;
  readonly commit?: string | null;
  readonly peers?: {
    readonly accept?: boolean;
    readonly ratio?: number;
    readonly modernScale?: number;
    readonly dissent?: readonly string[];
  } | null;
}

export type ChangeKind = 'integrated' | 'shelved' | 'reverted' | 'proposed' | 'held' | 'unknown';

export interface ShapedChange {
  readonly title: string;
  readonly why: string | null;
  readonly area: string | null;
  readonly files: readonly string[];
  readonly verification: string | null;
  readonly commit: string | null;
  readonly kind: ChangeKind;
  /** A plain-language kind label — NO uppercase/pill styling (that mapping is banned). */
  readonly kindLabel: string;
  readonly when: string | null;
  readonly peers: ShapedPeers | null;
}

export interface ShapedPeers {
  readonly accepted: boolean;
  readonly acceptPct: number;
  readonly modernScale: number;
  readonly dissent: readonly string[];
}

const KIND_LABEL: Record<ChangeKind, string> = {
  integrated: 'integrated',
  shelved: 'shelved',
  reverted: 'reverted',
  proposed: 'proposed',
  held: 'held for review',
  unknown: 'changed',
};

function toKind(raw: string | null | undefined): ChangeKind {
  const k = String(raw ?? '').toLowerCase();
  if (k === 'integrated' || k === 'shelved' || k === 'reverted' || k === 'proposed' || k === 'held') return k;
  return 'unknown';
}

/** Relative "2h ago" / "3d ago" from an ISO timestamp; absolute date past a week. Pure (now injected). */
export function relativeWhen(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d <= 7) return `${d}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

/** Shape one raw changelog entry into what the panel renders. */
export function shapeChange(entry: CouncilChangeEntry, now = Date.now()): ShapedChange {
  const kind = toKind(entry.kind);
  const peers: ShapedPeers | null = entry.peers
    ? {
        accepted: !!entry.peers.accept,
        acceptPct: Math.round((entry.peers.ratio ?? 0) * 100),
        modernScale: Number((entry.peers.modernScale ?? 0).toFixed(2)),
        dissent: (entry.peers.dissent ?? []).slice(0, 4),
      }
    : null;
  return {
    title: (entry.title ?? '').trim() || 'Vai self-improvement',
    why: cleanOrNull(entry.why),
    area: cleanOrNull(entry.area),
    files: Array.isArray(entry.files) ? entry.files.slice(0, 12) : [],
    verification: cleanOrNull(entry.verification),
    commit: cleanOrNull(entry.commit),
    kind,
    kindLabel: KIND_LABEL[kind],
    when: relativeWhen(entry.at, now),
    peers,
  };
}

/** Shape a list, keeping only well-formed entries (a valid schema id), newest-first as delivered. */
export function shapeChanges(entries: readonly CouncilChangeEntry[] | null | undefined, now = Date.now()): ShapedChange[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => typeof e?.schema === 'string' && e.schema.startsWith('council-change/'))
    .map((e) => shapeChange(e, now));
}

/** The collapsed-menu summary line. Empty state included so the caller never renders a bare label. */
export function summaryLabel(count: number): string {
  if (count <= 0) return 'No self-improvements yet';
  if (count === 1) return '1 recent self-improvement';
  return `${count} recent self-improvements`;
}

/** Build a copyable plain-text digest of the shaped changes (for the debugging-copy affordance). */
export function changesToText(changes: readonly ShapedChange[]): string {
  if (changes.length === 0) return 'No self-improvements yet.';
  return changes
    .map((c) => {
      const lines = [`- ${c.title}${c.when ? ` (${c.when})` : ''} [${c.kindLabel}]`];
      if (c.why) lines.push(`  why: ${c.why}`);
      if (c.area) lines.push(`  area: ${c.area}`);
      if (c.files.length) lines.push(`  files: ${c.files.join(', ')}`);
      if (c.verification) lines.push(`  verify: ${c.verification}`);
      if (c.peers) lines.push(`  peers: ${c.peers.accepted ? 'accepted' : 'not accepted'} ${c.peers.acceptPct}% · modern/scale ${c.peers.modernScale}`);
      if (c.commit) lines.push(`  commit: ${c.commit}`);
      return lines.join('\n');
    })
    .join('\n');
}

function cleanOrNull(s: string | null | undefined): string | null {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim();
  return v.length ? v : null;
}
