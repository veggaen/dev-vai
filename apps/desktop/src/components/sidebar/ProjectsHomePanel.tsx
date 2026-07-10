import { useCallback, useEffect, useState } from 'react';
import {
  Cloud, Copy, FolderGit2, FolderOpen, Link2, Loader2, LogIn, MessageSquare,
  Plus, RefreshCw, Share2, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../../lib/api.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useChatStore } from '../../stores/chatStore.js';
import { useLayoutStore } from '../../stores/layoutStore.js';
import { pickLatestProjectConversation } from '../../lib/project-conversation.js';
import type { ReactNode } from 'react';

function ProjectsSection({ action, children }: { action?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-white/[0.06] px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--chat-muted)]">
          <Cloud size={11} aria-hidden /> Cloud projects
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * ProjectsHomePanel — the platform "projects home" (base44-style): every project the
 * signed-in user owns or was invited into, with open-in-chat, share-link creation,
 * and share-token redemption. Renders above the workspace oversight card in the
 * sidebar 'projects' panel.
 *
 * Backend: GET /api/projects, POST /api/projects/:id/share-links,
 * DELETE /api/projects/:id/share-links/:linkId, POST /api/projects/share/:token/redeem.
 */

interface PlatformProject {
  id: string;
  sandboxProjectId: string;
  name: string;
  slug: string;
  status: string;
  visibility: string;
  role: string;
  updatedAt: string;
}

interface CreatedShareLink {
  id: string;
  role: string;
  token: string;
  expiresAt: string | null;
  maxUses: number | null;
}

function relative(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(date).toLocaleDateString();
}

const ROLE_TONE: Record<string, string> = {
  admin: 'text-blue-300',
  editor: 'text-emerald-300',
  viewer: 'text-zinc-400',
  tester: 'text-amber-300',
};

function ShareControls({ project, onClose }: { project: PlatformProject; onClose: () => void }) {
  const [role, setRole] = useState<'viewer' | 'editor' | 'tester'>('viewer');
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<CreatedShareLink | null>(null);

  const createLink = async () => {
    setCreating(true);
    try {
      const res = await apiFetch(`/api/projects/${project.id}/share-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, expiresInHours: 168 }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'share link failed');
      setLink(data as CreatedShareLink);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to create share link');
    } finally {
      setCreating(false);
    }
  };

  const copyToken = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.token);
      toast.success('Share token copied — paste it in another account\u2019s Redeem box');
    } catch {
      toast.error('Clipboard unavailable');
    }
  };

  const revoke = async () => {
    if (!link) return;
    try {
      const res = await apiFetch(`/api/projects/${project.id}/share-links/${link.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('revoke failed');
      setLink(null);
      toast.success('Share link revoked');
    } catch {
      toast.error('Unable to revoke share link');
    }
  };

  return (
    <div className="mt-1 rounded-lg border border-white/[0.06] bg-black/20 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--chat-muted)]">
          Share “{project.name}”
        </span>
        <button
          type="button"
          aria-label="Close share controls"
          onClick={onClose}
          className="rounded p-0.5 text-[color:var(--chat-muted)] hover:bg-white/10 hover:text-white"
        >
          <X size={11} />
        </button>
      </div>

      {!link ? (
        <div className="mt-2 flex items-center gap-1.5">
          <select
            aria-label="Invite role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'viewer' | 'editor' | 'tester')}
            className="flex-1 rounded-md border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-[color:var(--chat-body)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
          >
            <option value="viewer">Viewer — read only</option>
            <option value="editor">Editor — can change code</option>
            <option value="tester">Tester — can run + report</option>
          </select>
          <button
            type="button"
            onClick={() => void createLink()}
            disabled={creating}
            className="inline-flex items-center gap-1 rounded-md border border-[color:var(--accent-ring)] bg-[color:var(--accent-soft)] px-2 py-1 text-[11px] font-medium text-[color:var(--accent-text)] transition-colors hover:bg-[color:var(--accent-softer)] disabled:opacity-50"
          >
            {creating ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
            Create link
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          <div className="truncate rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-[10px] text-[color:var(--chat-body)]" title={link.token}>
            {link.token}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--chat-muted)]">
            <span className={`font-medium uppercase tracking-wider ${ROLE_TONE[link.role] ?? ROLE_TONE.viewer}`}>{link.role}</span>
            <span>expires in 7 days</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => void copyToken()}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-[color:var(--chat-body)] hover:bg-white/[0.08]"
            >
              <Copy size={10} /> Copy
            </button>
            <button
              type="button"
              onClick={() => void revoke()}
              className="inline-flex items-center gap-1 rounded-md border border-red-400/25 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/15"
            >
              <Trash2 size={10} /> Revoke
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProjectsHomePanel() {
  const authStatus = useAuthStore((s) => s.status);
  const authenticated = authStatus === 'authenticated';
  const conversations = useChatStore((s) => s.conversations);
  const [projects, setProjects] = useState<PlatformProject[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [redeemToken, setRedeemToken] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    try {
      const res = await apiFetch('/api/projects');
      const data = await res.json();
      if (!res.ok || !Array.isArray(data)) throw new Error('projects unavailable');
      setProjects(data as PlatformProject[]);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => { void load(); }, [load]);

  const openProject = async (project: PlatformProject) => {
    setOpeningId(project.id);
    try {
      const chat = useChatStore.getState();
      const existing = pickLatestProjectConversation(conversations, project.sandboxProjectId);
      if (existing) {
        await chat.selectConversation(existing.id);
      } else {
        const modelId = conversations.find((c) => c.id === chat.activeConversationId)?.modelId ?? 'vai:v0';
        await chat.createConversation(modelId, 'builder', { sandboxProjectId: project.sandboxProjectId });
      }
      useLayoutStore.getState().setActivePanel('chats');
      toast.success(`Opened ${project.name}`);
    } catch {
      toast.error(`Unable to open ${project.name}`);
    } finally {
      setOpeningId(null);
    }
  };

  const redeem = async () => {
    const token = redeemToken.trim();
    if (!token) return;
    setRedeeming(true);
    try {
      const res = await apiFetch(`/api/projects/share/${encodeURIComponent(token)}/redeem`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'redeem failed');
      setRedeemToken('');
      toast.success('Project joined — it\u2019s now in your list');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to redeem share token');
    } finally {
      setRedeeming(false);
    }
  };

  const startNewProject = async () => {
    const chat = useChatStore.getState();
    const modelId = conversations.find((c) => c.id === chat.activeConversationId)?.modelId ?? 'vai:v0';
    try {
      await chat.createConversation(modelId, 'builder');
      useLayoutStore.getState().setActivePanel('chats');
      toast.success('New builder chat — describe what to build');
    } catch {
      toast.error('Unable to start a builder chat');
    }
  };

  if (!authenticated) {
    return (
      <ProjectsSection>
        <div className="px-2 py-1 text-[11px] leading-relaxed text-[color:var(--chat-muted)]">
          <div className="mb-0.5 flex items-center gap-1.5 text-[color:var(--chat-body)]">
            <LogIn size={12} aria-hidden />
            Sign in to sync projects
          </div>
          Projects, sharing, and collaboration follow your account. Local folders and sandboxes keep working without sign-in.
        </div>
      </ProjectsSection>
    );
  }

  return (
    <ProjectsSection
      action={(
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Refresh projects"
            onClick={() => void load()}
            className="rounded p-1 text-[color:var(--chat-muted)] hover:bg-white/10 hover:text-white"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            aria-label="Open local folder"
            title="Open a project folder from your computer (Ctrl+Shift+O)"
            onClick={() => window.dispatchEvent(new CustomEvent('vai:open-workspace'))}
            className="rounded p-1 text-[color:var(--chat-muted)] hover:bg-white/10 hover:text-white"
          >
            <FolderOpen size={11} />
          </button>
          <button
            type="button"
            aria-label="New project from chat"
            title="Start a builder chat — the project is created when Vai ships the first build"
            onClick={() => void startNewProject()}
            className="rounded p-1 text-[color:var(--chat-muted)] hover:bg-white/10 hover:text-white"
          >
            <Plus size={11} />
          </button>
        </div>
      )}
    >
      {projects === null && (
        <div className="px-1 py-2 text-[11px] text-[color:var(--chat-muted)]">Loading projects…</div>
      )}

      {projects?.length === 0 && (
        <div className="px-2 py-3 text-center text-[11px] leading-relaxed text-[color:var(--chat-muted)]">
          <FolderGit2 size={15} className="mx-auto mb-1.5 opacity-50" aria-hidden />
          No projects yet — start a builder chat and Vai creates one as it ships the first build.
          <button
            type="button"
            onClick={() => void startNewProject()}
            className="mx-auto mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[color:var(--accent-text)] transition-colors hover:bg-[color:var(--accent-soft)]"
          >
            <Plus size={11} aria-hidden /> New builder chat
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('vai:open-workspace'))}
            className="mx-auto mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[color:var(--accent-text)] transition-colors hover:bg-[color:var(--accent-soft)]"
          >
            <FolderOpen size={11} aria-hidden /> Open a folder from your computer
          </button>
        </div>
      )}

      <div role="list" aria-label="Your projects" className="-mx-1 max-h-72 overflow-y-auto overscroll-contain">
        {projects?.map((project) => {
          const canShare = project.role === 'owner' || project.role === 'admin';
          const sharing = sharingId === project.id;
          return (
            <div key={project.id} role="listitem">
              <div
                className={`group relative flex items-center gap-2 rounded-md px-2 py-[7px] transition-colors ${
                  sharing ? 'bg-white/[0.05]' : 'hover:bg-white/[0.05]'
                }`}
              >
                {/* The row itself opens the project — one obvious primary action. */}
                <button
                  type="button"
                  onClick={() => void openProject(project)}
                  disabled={openingId === project.id}
                  title={`Open ${project.name} in a builder chat`}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] disabled:opacity-60"
                >
                  {openingId === project.id
                    ? <Loader2 size={13} className="shrink-0 animate-spin text-[color:var(--chat-muted)]" aria-hidden />
                    : <FolderGit2 size={13} className="shrink-0 text-[color:var(--chat-muted)] transition-colors group-hover:text-violet-300" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[color:var(--chat-body)]" title={project.name}>
                    {project.name}
                  </span>
                  {project.role !== 'owner' && (
                    <span className={`shrink-0 text-[9px] font-medium uppercase tracking-wider ${ROLE_TONE[project.role] ?? ROLE_TONE.viewer}`}>
                      {project.role}
                    </span>
                  )}
                  <span className="shrink-0 text-[10px] tabular-nums text-[color:var(--chat-muted)] transition-opacity group-hover:opacity-0">
                    {relative(project.updatedAt)}
                  </span>
                </button>
                {/* Hover-revealed actions sit over the timestamp — zero standing clutter. */}
                <div className="absolute right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label={`Open ${project.name} in chat`}
                    title="Open in chat"
                    onClick={() => void openProject(project)}
                    className="rounded p-1 text-[color:var(--chat-muted)] hover:bg-white/10 hover:text-white"
                  >
                    <MessageSquare size={12} aria-hidden />
                  </button>
                  {canShare && (
                    <button
                      type="button"
                      aria-label={`Share ${project.name}`}
                      aria-expanded={sharing}
                      title="Share — invite by link"
                      onClick={() => setSharingId(sharing ? null : project.id)}
                      className={`rounded p-1 transition-colors ${
                        sharing
                          ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-text)] opacity-100'
                          : 'text-[color:var(--chat-muted)] hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <Share2 size={12} aria-hidden />
                    </button>
                  )}
                </div>
              </div>
              {sharing && (
                <div className="px-2 pb-1.5">
                  <ShareControls project={project} onClose={() => setSharingId(null)} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Join-by-token lives behind a quiet toggle — it's a rare action and a
          permanently visible input begs attention it hasn't earned. */}
      <div className="mt-1.5">
        {!redeemOpen ? (
          <button
            type="button"
            onClick={() => setRedeemOpen(true)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] text-[color:var(--chat-muted)] transition-colors hover:bg-white/[0.05] hover:text-[color:var(--chat-body)]"
            title="Someone shared a project token with you? Redeem it here."
          >
            <Link2 size={10} aria-hidden /> Join via share token
          </button>
        ) : (
          <div className="flex items-center gap-1.5 px-1">
            <input
              value={redeemToken}
              onChange={(e) => setRedeemToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void redeem();
                if (e.key === 'Escape') { setRedeemOpen(false); setRedeemToken(''); }
              }}
              placeholder="Paste share token…"
              aria-label="Redeem share token"
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-[color:var(--chat-body)] placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
            />
            <button
              type="button"
              onClick={() => void redeem()}
              disabled={redeeming || !redeemToken.trim()}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-[color:var(--accent-text)] transition-colors hover:bg-[color:var(--accent-soft)] disabled:opacity-40"
            >
              {redeeming ? <Loader2 size={11} className="animate-spin" aria-hidden /> : 'Join'}
            </button>
            <button
              type="button"
              aria-label="Close token input"
              onClick={() => { setRedeemOpen(false); setRedeemToken(''); }}
              className="rounded p-1 text-[color:var(--chat-muted)] hover:bg-white/10 hover:text-white"
            >
              <X size={11} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </ProjectsSection>
  );
}

export default ProjectsHomePanel;
