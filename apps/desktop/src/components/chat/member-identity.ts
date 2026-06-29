import { Brain, Code2, Scale, Search, Sparkles, type LucideIcon } from 'lucide-react';
import { cleanModelName } from './process-humanize.js';

/**
 * member-identity — give every council model a stable, recognizable PRESENCE in the
 * Process UI: a role label, a role glyph, and an accent token. The user's complaint was
 * that a working member read as a bare "qwen is working"; with identity each model reads
 * as a named collaborator on a team.
 *
 * Pure + DOM-free so it unit-tests in node (desktop tests run headless). Colors map ONLY to
 * existing CSS-variable tokens (never hardcoded hex / tailwind palette) so theming holds.
 */

export interface MemberIdentity {
  /** Clean spoken model name, e.g. "deepseek-r1:8b". */
  readonly label: string;
  /** The lens/role this model plays on the panel. */
  readonly role: string;
  /** A short chip label for the role ("reasoning", "code", "skeptic"…). */
  readonly roleChip: string;
  /** Role glyph (lucide icon component). */
  readonly Icon: LucideIcon;
  /** Accent color as an existing CSS var token (e.g. "var(--phase-route)"). */
  readonly accentVar: string;
}

/**
 * Resolve identity from the model name and (optionally) the council topic/role the backend
 * assigned. Topic wins when present (it's the seat the member actually filled this turn);
 * otherwise we infer from the model family. Unknown models get a clean, neutral identity —
 * never a crash, never an empty row.
 */
export function memberIdentity(name: string, roleOrTopic?: string): MemberIdentity {
  const label = cleanModelName(name);
  const lower = `${name} ${roleOrTopic ?? ''}`.toLowerCase();

  // Topic/role-driven lens (the seat) takes priority — that's the voice it spoke as.
  if (/reason|first.?principle|skeptic/.test(lower)) {
    return { label, role: 'reasoning', roleChip: 'reasoning', Icon: Brain, accentVar: 'var(--phase-route)' };
  }
  if (/\bcode\b|coder|engineer|pragmat/.test(lower)) {
    return { label, role: 'code', roleChip: 'code', Icon: Code2, accentVar: 'var(--phase-compose)' };
  }
  if (/fact|local|knowledge|evidence/.test(lower)) {
    return { label, role: 'evidence', roleChip: 'evidence', Icon: Search, accentVar: 'var(--phase-evidence)' };
  }
  if (/review|verify|judge|critic/.test(lower)) {
    return { label, role: 'review', roleChip: 'review', Icon: Scale, accentVar: 'var(--phase-verify)' };
  }

  // Model-family fallback when no seat is named — keeps each model visually distinct.
  if (lower.includes('deepseek')) {
    return { label, role: 'reasoning', roleChip: 'deep reasoning', Icon: Brain, accentVar: 'var(--phase-route)' };
  }
  if (lower.includes('grok')) {
    return { label, role: 'wide-context', roleChip: 'wide context', Icon: Sparkles, accentVar: 'var(--accent)' };
  }
  if (lower.includes('qwen')) {
    return { label, role: 'generalist', roleChip: 'generalist', Icon: Scale, accentVar: 'var(--phase-verify)' };
  }
  return { label, role: 'member', roleChip: 'member', Icon: Sparkles, accentVar: 'var(--accent)' };
}
