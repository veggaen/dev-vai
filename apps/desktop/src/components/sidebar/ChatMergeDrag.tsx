/**
 * ChatMergeDrag — hold-to-combine gesture for the sidebar chat list.
 *
 * Press and HOLD a chat row (~250ms, left button) to lift it into "merge mode":
 * a glowing ghost with soft particles follows the cursor, candidate rows light
 * up as you pass over them, and a hint explains the gesture. Release over
 * another chat/project → a confirmation card asks whether to create a new
 * project from the combination. Confirm → Vai + the council take over through
 * the REAL user path (new agent conversation + a distilled merge brief), so
 * every quality gate the builder already enforces applies to the merged output.
 *
 * A quick drag (movement before the hold elapses) still does what it always
 * did — reorder. The two gestures never fight: movement cancels the hold.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { GitMerge, Sparkles, X } from 'lucide-react';
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
        // Armed but not lifted: real movement means the user wants the reorder drag.
        if (armedId.current !== null) {
          const dx = e.clientX - startPos.current.x;
          const dy = e.clientY - startPos.current.y;
          if (Math.hypot(dx, dy) > HOLD_SLOP_PX) clearHold();
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
      toast.success('Vai + the council are merging the two — watch the new chat.');
      setPending(null);
    } catch {
      toast.error('Merge kick-off failed — both chats are untouched.');
    } finally {
      setMerging(false);
    }
  }, [pending, merging]);

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
          onClick={() => !merging && setPending(null)}
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
              <button type="button" aria-label="Cancel merge" onClick={() => setPending(null)} disabled={merging} className="vai-merge-dialog__close">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="vai-merge-dialog__body">
              Vai + the council will read both conversations and seamlessly merge their
              ideas{' '}and any project code into one clean, new project.
            </p>
            <div className="vai-merge-dialog__pair">
              <span className="vai-merge-dialog__chip">{pending.source.title}</span>
              <GitMerge className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" />
              <span className="vai-merge-dialog__chip">{pending.target.title}</span>
            </div>
            <div className="vai-merge-dialog__actions">
              <button type="button" onClick={() => setPending(null)} disabled={merging} className="vai-merge-dialog__btn">
                Keep them separate
              </button>
              <button type="button" onClick={() => { void confirmMerge(); }} disabled={merging} className="vai-merge-dialog__btn vai-merge-dialog__btn--primary">
                {merging ? 'Starting…' : 'Merge with Vai + Council'}
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
