/**
 * ChatMergeDrag — hold-to-combine gesture for the sidebar chat list.
 *
 * Drag a chat row (left button) to lift it into "merge mode": the moment the
 * pointer moves, a glowing ghost with soft particles follows the cursor,
 * candidate rows light up as you pass over them, and a hint explains the
 * gesture. (Pressing and holding still for ~250ms lifts it too, for users who
 * don't move first.) Release over another chat/project → a confirmation card
 * asks whether to combine them into a new project. Confirm → Vai + the council
 * take over through the REAL user path (new agent conversation + a distilled
 * merge brief), so every quality gate the builder already enforces applies to
 * the merged output.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { GitMerge, Layers, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useChatStore } from '../../stores/chatStore.js';
import { apiFetch } from '../../lib/api.js';

const HOLD_MS = 250;
/** Movement beyond this (px) before the hold elapses = the user wants a reorder drag. */
const HOLD_SLOP_PX = 8;
/** Cap per-source transcript in the merge brief so the prompt stays lean. */
const MAX_SOURCE_CHARS = 4_000;

export interface MergeConversation {
  readonly id: string;
  readonly title: string;
  readonly projectName?: string | null;
  readonly mode?: string;
}

interface ActiveDrag {
  readonly sourceId: string;
  x: number;
  y: number;
  targetId: string | null;
}

interface PendingPair {
  readonly source: MergeConversation;
  readonly target: MergeConversation;
}

/** Distill one conversation's transcript into a compact, quotable brief section. */
async function distillConversation(id: string): Promise<string> {
  try {
    const res = await apiFetch(`/api/conversations/${id}/messages`);
    if (!res.ok) return '(transcript unavailable)';
    const raw = (await res.json()) as Array<{ role: string; content: string }>;
    const lines = raw
      .filter((m) => m.content?.trim())
      .map((m) => `${m.role === 'user' ? 'V3gga' : 'Vai'}: ${m.content.trim()}`);
    let text = lines.join('\n');
    if (text.length > MAX_SOURCE_CHARS) {
      // Keep the END of the conversation — that's where decisions live.
      text = `…(earlier context trimmed)…\n${text.slice(-MAX_SOURCE_CHARS)}`;
    }
    return text || '(empty conversation)';
  } catch {
    return '(transcript unavailable)';
  }
}

function buildMergeBrief(source: MergeConversation, target: MergeConversation, sourceText: string, targetText: string): string {
  const describe = (c: MergeConversation) =>
    `"${c.title}"${c.projectName ? ` (project: ${c.projectName})` : ''}${c.mode && c.mode !== 'chat' ? ` [${c.mode}]` : ''}`;
  return [
    `Merge these two chats/projects into ONE new, coherent project. Combine their ideas and any code seamlessly — clean architecture, no duplication, no leftovers. Consult the council and verify quality before finalizing.`,
    ``,
    `── Source A — ${describe(source)} ──`,
    sourceText,
    ``,
    `── Source B — ${describe(target)} ──`,
    targetText,
    ``,
    `Deliver: (1) a short unified plan naming what each source contributes, (2) the merged implementation, (3) a council-reviewed quality pass.`,
  ].join('\n');
}

export function useChatMergeDrag(conversations: readonly MergeConversation[]) {
  const [drag, setDrag] = useState<ActiveDrag | null>(null);
  const [pending, setPending] = useState<PendingPair | null>(null);
  const [merging, setMerging] = useState(false);
  /** What happens to the two source chats after a successful merge. Default: keep both. */
  const [purgeOriginals, setPurgeOriginals] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const armedId = useRef<string | null>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  dragRef.current = drag;
  /** Rows consult this to swallow the click that follows a completed gesture. */
  const blockClicksUntil = useRef(0);

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) { window.clearTimeout(holdTimer.current); holdTimer.current = null; }
    armedId.current = null;
  }, []);

  const endDrag = useCallback(() => {
    document.body.classList.remove('vai-merge-dragging');
    setDrag(null);
  }, []);

  /** Attach to each chat row. Only arms the hold; global listeners do the rest. */
  const onRowPointerDown = useCallback((convId: string, e: React.PointerEvent) => {
    if (e.button !== 0 || drag || pending) return;
    startPos.current = { x: e.clientX, y: e.clientY };
    armedId.current = convId;
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      if (armedId.current !== convId) return;
      document.body.classList.add('vai-merge-dragging');
      setDrag({ sourceId: convId, x: startPos.current.x, y: startPos.current.y, targetId: null });
    }, HOLD_MS);
  }, [drag, pending]);

  // Global gesture tracking while armed or dragging.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const active = dragRef.current;
      if (!active) {
        // Armed but not lifted: the moment the pointer actually moves, LIFT the
        // merge follower and let it track the cursor — a plain drag is the whole
        // gesture, no press-and-hold wait. (Press-and-hold-still still lifts too,
        // via the timer, for users who don't move first.)
        if (armedId.current !== null) {
          const dx = e.clientX - startPos.current.x;
          const dy = e.clientY - startPos.current.y;
          if (Math.hypot(dx, dy) > HOLD_SLOP_PX) {
            const id = armedId.current;
            if (holdTimer.current !== null) { window.clearTimeout(holdTimer.current); holdTimer.current = null; }
            document.body.classList.add('vai-merge-dragging');
            setDrag({ sourceId: id, x: e.clientX, y: e.clientY, targetId: null });
          }
        }
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el?.closest<HTMLElement>('[data-conv-id]');
      const overId = row?.dataset.convId ?? null;
      setDrag({ ...active, x: e.clientX, y: e.clientY, targetId: overId !== active.sourceId ? overId : null });
    };
    const onUp = () => {
      clearHold();
      const active = dragRef.current;
      if (!active) return;
      blockClicksUntil.current = Date.now() + 300;
      if (active.targetId) {
        const source = conversations.find((c) => c.id === active.sourceId);
        const target = conversations.find((c) => c.id === active.targetId);
        if (source && target) setPending({ source, target });
      }
      endDrag();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) { clearHold(); endDrag(); }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [conversations, clearHold, endDrag]);

  const confirmMerge = useCallback(async () => {
    if (!pending || merging) return;
    setMerging(true);
    const { source, target } = pending;
    try {
      toast.info('Reading both conversations…');
      const [sourceText, targetText] = await Promise.all([
        distillConversation(source.id),
        distillConversation(target.id),
      ]);
      const store = useChatStore.getState();
      await store.createConversation('vai:v0', 'agent', { sandboxProjectId: null });
      store.sendMessage(buildMergeBrief(source, target, sourceText, targetText));
      // Only now that both transcripts are safely captured in the brief and the new
      // chat is under way do we (optionally) remove the originals — never before.
      if (purgeOriginals) {
        try {
          await store.deleteConversation(source.id);
          await store.deleteConversation(target.id);
          toast.success('Merged into a new chat — the two originals were removed.');
        } catch {
          toast.success('Merged into a new chat. (Couldn’t remove the originals — remove them manually.)');
        }
      } else {
        toast.success('Vai + the council are merging the two — watch the new chat.');
      }
      setPending(null);
      setPurgeOriginals(false);
    } catch {
      toast.error('Merge kick-off failed — both chats are untouched.');
    } finally {
      setMerging(false);
    }
  }, [pending, merging, purgeOriginals]);

  const sourceConv = drag ? conversations.find((c) => c.id === drag.sourceId) : null;

  const overlay = typeof document === 'undefined' ? null : createPortal(
    <AnimatePresence>
      {drag && sourceConv && (
        <motion.div
          key="merge-ghost"
          className="vai-merge-ghost"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.16 }}
          style={{ left: drag.x, top: drag.y }}
          aria-hidden
        >
          <span className="vai-merge-ghost__particles" aria-hidden>
            {Array.from({ length: 7 }, (_, i) => <i key={i} />)}
          </span>
          <span className="vai-merge-ghost__card">
            <GitMerge className="h-3 w-3 shrink-0" />
            <span className="vai-merge-ghost__title">{sourceConv.title}</span>
          </span>
          <span className={`vai-merge-ghost__hint ${drag.targetId ? 'vai-merge-ghost__hint--ready' : ''}`}>
            {drag.targetId
              ? 'Release to combine these two into a new project'
              : 'Drag onto another chat or project to combine them'}
          </span>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );

  const dialog = typeof document === 'undefined' ? null : createPortal(
    <AnimatePresence>
      {pending && (
        <motion.div
          key="merge-dialog-backdrop"
          className="vai-merge-dialog__backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => { if (!merging) { setPending(null); setPurgeOriginals(false); } }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Combine chats into a new project"
            className="vai-merge-dialog"
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="vai-merge-dialog__head">
              <Sparkles className="h-4 w-4 text-[color:var(--accent)]" />
              <span>Combine into a new project?</span>
              <button type="button" aria-label="Cancel merge" onClick={() => { setPending(null); setPurgeOriginals(false); }} disabled={merging} className="vai-merge-dialog__close">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="vai-merge-dialog__body">
              Vai + the council read both conversations and build one clean, new
              project from their ideas and any code. This creates a brand-new chat —
              nothing here is overwritten.
            </p>
            <div className="vai-merge-dialog__pair">
              <span className="vai-merge-dialog__chip">{pending.source.title}</span>
              <GitMerge className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" />
              <span className="vai-merge-dialog__chip">{pending.target.title}</span>
            </div>

            {/* What happens to the two originals — an explicit, non-scary choice. */}
            <div className="mt-1">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-subheader)]">
                The two originals
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPurgeOriginals(false)}
                  disabled={merging}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
                    !purgeOriginals
                      ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--fg)]'
                      : 'border-[color:var(--border)] text-[color:var(--color-muted)] hover:text-[color:var(--fg)]'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5 shrink-0" />
                  Keep both
                </button>
                <button
                  type="button"
                  onClick={() => setPurgeOriginals(true)}
                  disabled={merging}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
                    purgeOriginals
                      ? 'border-red-500/40 bg-red-500/10 text-red-200'
                      : 'border-[color:var(--border)] text-[color:var(--color-muted)] hover:text-[color:var(--fg)]'
                  }`}
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  Delete after merge
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-[color:var(--color-muted)]">
                {purgeOriginals
                  ? 'Both source chats are removed once the new project is created.'
                  : 'Both source chats stay in your sidebar — nothing is deleted.'}
              </p>
            </div>

            <div className="vai-merge-dialog__actions">
              <button type="button" onClick={() => { setPending(null); setPurgeOriginals(false); }} disabled={merging} className="vai-merge-dialog__btn">
                Cancel
              </button>
              <button type="button" onClick={() => { void confirmMerge(); }} disabled={merging} className="vai-merge-dialog__btn vai-merge-dialog__btn--primary">
                {merging ? 'Starting…' : 'Create merged project'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );

  return {
    /** True while the glowing ghost is out — rows should refuse HTML5 dragstart. */
    isMergeDragging: drag !== null,
    /** Row currently highlighted as the drop target. */
    mergeTargetId: drag?.targetId ?? null,
    /** Row being carried. */
    mergeSourceId: drag?.sourceId ?? null,
    blockClicksUntil,
    onRowPointerDown,
    overlay,
    dialog,
  };
}
