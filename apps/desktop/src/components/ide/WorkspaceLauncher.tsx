/**
 * Council-IDE — Layer 1 launcher + working panel (proves the substrate end-to-end).
 *
 * Opens with Ctrl+Shift+O. Flow: paste a folder path → browse the tree → open a file →
 * edit it → "Propose change" builds a diff → review → Approve writes it to disk (via the
 * guarded Rust command). No model yet — this exists to verify attach/read/diff/approve/write
 * works before the council is wired to GENERATE the proposals.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, X, FileText, Loader2 } from 'lucide-react';
import { makeProposal, withStatus, type FileEditProposal } from '@vai/core/browser';
import { DiffReview } from './DiffReview.js';
import {
  applyApprovedProposals,
  folderName,
  listWorkspace,
  proposeCouncil,
  proposeEdit,
  readWorkspaceFile,
  toReviewProposal,
  type WorkspaceEntry,
} from '../../lib/ide/workspace-client.js';

const ROLES = ['coder', 'frontend', 'backend', 'animation', 'human-sim'] as const;

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function WorkspaceLauncher() {
  const [open, setOpen] = useState(false);
  const [rootInput, setRootInput] = useState('');
  const [root, setRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<WorkspaceEntry[]>([]);
  const [openRel, setOpenRel] = useState<string | null>(null);
  const [original, setOriginal] = useState('');
  const [draft, setDraft] = useState('');
  const [proposals, setProposals] = useState<FileEditProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState('');
  const [role, setRole] = useState<string>('coder');
  const [generating, setGenerating] = useState(false);
  const [judgeNote, setJudgeNote] = useState<string | null>(null);

  // Open/close with Ctrl+Shift+O.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const attach = useCallback(async () => {
    const path = rootInput.trim();
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      const entries = await listWorkspace(path);
      setRoot(path);
      setTree(entries);
      setOpenRel(null);
      setProposals([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [rootInput]);

  const openFile = useCallback(async (rel: string) => {
    if (!root) return;
    setBusy(true);
    setError(null);
    try {
      const content = await readWorkspaceFile(root, rel);
      setOpenRel(rel);
      setOriginal(content);
      setDraft(content);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [root]);

  const propose = useCallback(() => {
    if (!openRel) return;
    const p = makeProposal(openRel, original, draft, {
      summary: 'Manual edit',
      author: { memberId: 'you' },
    });
    if (!p) {
      setError('No changes to propose.');
      return;
    }
    setError(null);
    setProposals((ps) => [...ps, p]);
  }, [openRel, original, draft]);

  const approve = useCallback(async (id: string) => {
    if (!root) return;
    const target = proposals.find((p) => p.id === id);
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await applyApprovedProposals(root, [withStatus(target, 'approved')]);
      setProposals((ps) => ps.map((p) => (p.id === id ? withStatus(p, 'approved') : p)));
      setTree(await listWorkspace(root));
      if (openRel === target.path && target.after !== null) setOriginal(target.after);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [root, proposals, openRel]);

  const reject = useCallback((id: string) => {
    setProposals((ps) => ps.map((p) => (p.id === id ? withStatus(p, 'rejected') : p)));
  }, []);

  // Ask the local coder model to make the change — runs entirely on the user's models.
  const generate = useCallback(async () => {
    if (!root || !openRel || !task.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const p = await proposeEdit(root, openRel, original, task, {
        role: role === 'coder' ? undefined : role,
      });
      if (!p) { setError('The model returned no change.'); return; }
      setProposals((ps) => [...ps, p]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [root, openRel, original, task, role]);

  // Council: several local specialists propose, a judge picks — you review all + approve one.
  const council = useCallback(async () => {
    if (!root || !openRel || !task.trim()) return;
    setGenerating(true);
    setError(null);
    setJudgeNote(null);
    try {
      const res = await proposeCouncil(root, openRel, original, task, ['coder', 'backend', 'human-sim']);
      if (res.proposals.length === 0) { setError('No member produced a change.'); return; }
      setProposals((ps) => [...ps, ...res.proposals]);
      setJudgeNote(res.judgeRole ? `Judge favours “${res.judgeRole}”${res.rationale ? ` — ${res.rationale}` : ''}` : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [root, openRel, original, task]);

  const files = useMemo(() => tree.filter((e) => !e.dir), [tree]);
  const reviewProposals = useMemo(() => proposals.map(toReviewProposal), [proposals]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-6" onClick={() => setOpen(false)}>
      <div
        className="flex h-[80vh] w-[min(1100px,95vw)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[color:var(--chat-bg,#0b0b0f)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <FolderOpen size={16} className="text-[color:var(--accent-text,#a78bfa)]" />
          <span className="text-sm font-medium text-[color:var(--chat-body,#e5e5e5)]">
            Workspace{root ? ` · ${folderName(root)}` : ''}
          </span>
          {busy && <Loader2 size={14} className="animate-spin text-[color:var(--chat-muted,#888)]" />}
          <button type="button" onClick={() => setOpen(false)} className="ml-auto text-[color:var(--chat-muted,#888)] hover:text-white">
            <X size={16} />
          </button>
        </div>

        {!isTauri() && (
          <div className="px-4 py-2 text-xs text-amber-400">File access needs the desktop app (Tauri).</div>
        )}

        {!root ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
            <p className="text-sm text-[color:var(--chat-muted,#888)]">Paste a project folder path to attach it to this chat.</p>
            <div className="flex w-full max-w-xl gap-2">
              <input
                value={rootInput}
                onChange={(e) => setRootInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void attach(); }}
                placeholder="C:\\Users\\you\\my-project"
                className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-[color:var(--chat-body,#e5e5e5)] outline-none focus:border-[color:var(--accent-ring,#7c3aed)]"
              />
              <button type="button" onClick={() => void attach()} className="rounded-lg bg-[color:var(--accent-soft,#7c3aed33)] px-4 py-2 text-xs font-medium text-[color:var(--accent-text,#c4b5fd)] hover:brightness-110">
                Attach
              </button>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="w-64 shrink-0 overflow-auto border-r border-white/[0.06] p-2">
              {files.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => void openFile(f.path)}
                  className={`flex w-full items-center gap-1.5 truncate rounded px-2 py-1 text-left font-mono text-[11px] transition-colors hover:bg-white/[0.05] ${
                    openRel === f.path ? 'bg-white/[0.08] text-white' : 'text-[color:var(--chat-muted,#aaa)]'
                  }`}
                  title={f.path}
                >
                  <FileText size={12} className="shrink-0 opacity-60" />
                  <span className="truncate">{f.path}</span>
                </button>
              ))}
              {files.length === 0 && <p className="px-2 py-1 text-[11px] text-[color:var(--chat-muted,#888)]">No files.</p>}
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              {error && <div className="border-b border-white/[0.06] px-4 py-1.5 text-xs text-red-400">{error}</div>}
              {openRel ? (
                <>
                  <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2">
                    <span className="truncate font-mono text-[11px] text-[color:var(--chat-body,#ddd)]">{openRel}</span>
                    <button type="button" onClick={propose} disabled={draft === original} className="ml-auto rounded-md bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-[color:var(--chat-body,#ddd)] disabled:opacity-40" title="Turn your manual edit into a reviewable diff">
                      Propose my edit
                    </button>
                  </div>
                  <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2">
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="shrink-0 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-[color:var(--chat-body,#ddd)] outline-none"
                      title="Which specialist to ask"
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <input
                      value={task}
                      onChange={(e) => setTask(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void generate(); }}
                      placeholder="Ask the coder to change this file…"
                      className="flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-[color:var(--chat-body,#e5e5e5)] outline-none focus:border-[color:var(--accent-ring,#7c3aed)]"
                    />
                    <button
                      type="button"
                      onClick={() => void generate()}
                      disabled={generating || !task.trim()}
                      className="flex shrink-0 items-center gap-1 rounded-md bg-[color:var(--accent-soft,#7c3aed33)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--accent-text,#c4b5fd)] disabled:opacity-40"
                    >
                      {generating && <Loader2 size={12} className="animate-spin" />}
                      Generate
                    </button>
                    <button
                      type="button"
                      onClick={() => void council()}
                      disabled={generating || !task.trim()}
                      title="Several local specialists propose; a judge picks the best"
                      className="flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-[color:var(--chat-body,#ddd)] disabled:opacity-40"
                    >
                      Council
                    </button>
                  </div>
                  {judgeNote && (
                    <div className="border-b border-white/[0.06] bg-emerald-500/[0.06] px-4 py-1.5 text-[11px] text-emerald-300">
                      {judgeNote}
                    </div>
                  )}
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    className="min-h-0 flex-1 resize-none bg-black/20 p-4 font-mono text-[12px] leading-relaxed text-[color:var(--chat-body,#e5e5e5)] outline-none"
                  />
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-xs text-[color:var(--chat-muted,#888)]">Select a file to edit.</div>
              )}

              {reviewProposals.length > 0 && (
                <div className="max-h-[40%] overflow-auto border-t border-white/[0.06] p-3">
                  <DiffReview proposals={reviewProposals} onApprove={(id) => void approve(id)} onReject={reject} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkspaceLauncher;
