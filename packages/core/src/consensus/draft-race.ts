/**
 * First-draft race: Vai and every capable council member each write a candidate
 * answer, then every member scores all candidates; the highest weighted total
 * wins (ties break toward Vai). The winner becomes the BASE draft for the normal
 * approval-gate rounds — so the fact-quarantine is preserved end-to-end: a member
 * draft that wins still gets reviewed, verified, and owned by Vai before shipping.
 *
 * Members run sequentially (same single-GPU VRAM contract as the review council).
 * Every stage change is surfaced through `onProgress` so the process UI can render
 * the race 1:1 for humans and agents.
 */

import type { CouncilInput, CouncilMember } from './types.js';

export interface RaceCandidate {
  readonly authorId: string;
  readonly authorName: string;
  readonly modelId?: string;
  readonly text: string;
  readonly provisional?: boolean;
  readonly pending?: boolean;
  readonly failed?: boolean;
  readonly durationMs?: number;
}

export interface RaceVote {
  readonly voterId: string;
  readonly voterName: string;
  readonly scores: Record<string, number>;
  readonly pending?: boolean;
  readonly failed?: boolean;
}

export interface DraftRaceSnapshot {
  readonly status: 'drafting' | 'voting' | 'decided';
  readonly candidates: readonly RaceCandidate[];
  readonly votes: readonly RaceVote[];
  readonly winnerId?: string;
  readonly tieBrokenToVai?: boolean;
}

export interface DraftRaceResult {
  readonly winner: RaceCandidate;
  readonly snapshot: DraftRaceSnapshot;
}

export interface RunDraftRaceOptions {
  /** Vai's own draft — always a candidate and always the tie-break winner. */
  readonly vaiDraft: { readonly text: string; readonly modelId?: string };
  readonly members: readonly CouncilMember[];
  readonly input: CouncilInput;
  /** Per-member draft/vote timeout guard (the member's own timeout still applies). */
  readonly timeoutMs?: number;
  /** Overall wall-clock budget; when spent, remaining drafts/votes are skipped. */
  readonly overallDeadlineMs?: number;
  /** Vote weight per member id (topic-fit trust). Default 1. */
  readonly weightFor?: (memberId: string) => number;
  /** Fired on every state change with a fresh snapshot (for progress events). */
  readonly onProgress?: (snapshot: DraftRaceSnapshot) => void;
  /** Live reasoning preview per member while drafting. */
  readonly onMemberReasoning?: (memberId: string, textSoFar: string) => void;
  readonly now?: () => number;
}

export const VAI_AUTHOR_ID = 'vai';

/** Cap stored/streamed candidate text; the full winner text is returned intact. */
const SNAPSHOT_TEXT_CAP = 4_000;

export async function runDraftRace(options: RunDraftRaceOptions): Promise<DraftRaceResult> {
  const { vaiDraft, members, input, weightFor, onProgress, onMemberReasoning } = options;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const deadline = options.overallDeadlineMs ? startedAt + options.overallDeadlineMs : Infinity;

  const drafters = members.filter((m) => typeof m.draft === 'function');
  const candidates: RaceCandidate[] = [
    {
      authorId: VAI_AUTHOR_ID,
      authorName: 'Vai',
      modelId: vaiDraft.modelId,
      text: vaiDraft.text.slice(0, SNAPSHOT_TEXT_CAP),
      provisional: true,
    },
    ...drafters.map((m) => ({
      authorId: m.id,
      authorName: m.displayName,
      text: '',
      pending: true,
    })),
  ];
  const votes: RaceVote[] = [];
  const fullTexts = new Map<string, string>([[VAI_AUTHOR_ID, vaiDraft.text]]);

  const emit = (status: DraftRaceSnapshot['status'], extra?: Partial<DraftRaceSnapshot>) => {
    const snapshot: DraftRaceSnapshot = {
      status,
      candidates: [...candidates],
      votes: [...votes],
      ...extra,
    };
    try { onProgress?.(snapshot); } catch { /* observability must never break the race */ }
    return snapshot;
  };

  emit('drafting');

  // ── Draft stage: sequential, VRAM-safe ─────────────────────────────────────
  for (let i = 0; i < drafters.length; i++) {
    const member = drafters[i];
    const slot = candidates.findIndex((c) => c.authorId === member.id);
    if (now() >= deadline) {
      candidates[slot] = { ...candidates[slot], pending: false, failed: true };
      emit('drafting');
      continue;
    }
    const t0 = now();
    try {
      const text = await member.draft!(input, {
        onReasoningDelta: onMemberReasoning ? (txt) => onMemberReasoning(member.id, txt) : undefined,
      });
      const durationMs = Math.max(0, now() - t0);
      if (text) {
        fullTexts.set(member.id, text);
        candidates[slot] = {
          authorId: member.id,
          authorName: member.displayName,
          text: text.slice(0, SNAPSHOT_TEXT_CAP),
          durationMs,
        };
      } else {
        candidates[slot] = { ...candidates[slot], pending: false, failed: true, durationMs };
      }
    } catch {
      candidates[slot] = { ...candidates[slot], pending: false, failed: true, durationMs: Math.max(0, now() - t0) };
    }
    emit('drafting');
  }

  const fielded = candidates.filter((c) => !c.failed && !c.pending);

  // Nobody else fielded a draft → Vai wins by default, no vote stage.
  if (fielded.length <= 1) {
    const snapshot = emit('decided', { winnerId: VAI_AUTHOR_ID });
    return { winner: { ...candidates[0], text: vaiDraft.text }, snapshot };
  }

  // ── Vote stage: every member with scoreDrafts judges all fielded drafts ────
  emit('voting');
  const ballot = fielded.map((c) => ({ authorId: c.authorId, text: fullTexts.get(c.authorId) ?? c.text }));
  const scorers = members.filter((m) => typeof m.scoreDrafts === 'function');
  for (const member of scorers) {
    if (now() >= deadline) break;
    try {
      const scores = await member.scoreDrafts!(input, ballot);
      if (scores) {
        votes.push({ voterId: member.id, voterName: member.displayName, scores });
        emit('voting');
      }
    } catch { /* abstain */ }
  }

  // ── Decide: weighted totals; ties break toward Vai ─────────────────────────
  const totals = new Map<string, number>();
  for (const c of fielded) totals.set(c.authorId, 0);
  for (const vote of votes) {
    const weight = weightFor?.(vote.voterId) ?? 1;
    for (const [authorId, score] of Object.entries(vote.scores)) {
      if (totals.has(authorId)) totals.set(authorId, (totals.get(authorId) ?? 0) + score * weight);
    }
  }

  let winnerId = VAI_AUTHOR_ID;
  let best = totals.get(VAI_AUTHOR_ID) ?? 0;
  for (const [authorId, total] of totals) {
    if (total > best) { winnerId = authorId; best = total; }
  }
  const tieBrokenToVai = winnerId === VAI_AUTHOR_ID
    && [...totals.entries()].some(([id, t]) => id !== VAI_AUTHOR_ID && t === best);

  const winnerCandidate = fielded.find((c) => c.authorId === winnerId) ?? candidates[0];
  const snapshot = emit('decided', { winnerId, tieBrokenToVai: tieBrokenToVai || undefined });
  return {
    winner: { ...winnerCandidate, text: fullTexts.get(winnerId) ?? winnerCandidate.text },
    snapshot,
  };
}
