import { useEffect, useState, useMemo } from 'react';
import { Bot, CheckCircle2, GitBranch, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/authStore.js';
import { useSettingsStore } from '../../stores/settingsStore.js';
import { useSandboxStore } from '../../stores/sandboxStore.js';
import { useCollabStore } from '../../stores/collabStore.js';
import { useEngineStore } from '../../stores/engineStore.js';
import { useLayoutStore } from '../../stores/layoutStore.js';
import { useChatStore } from '../../stores/chatStore.js';
import { useVinextStore, type VinextState } from '../../stores/vinextStore.js';
import { BuildStatusBadge } from '../BuildStatusBadge.js';
import { apiFetch } from '../../lib/api.js';
import { MODE_DESCRIPTIONS } from '../../stores/layoutStore.js';
import type { ProjectHandoffIntentResponse } from '@vai/api-types/project-responses';

function formatRelative(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(date).toLocaleDateString();
}

function isTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function openExternalTarget(target: string): Promise<void> {
  if (isTauriApp()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_external', { target });
    return;
  }
  window.location.assign(target);
}

export function SettingsPanel() {
  const isOwner = useAuthStore((state) => state.isOwner);
  const ownerFeaturesHidden = useAuthStore((state) => state.ownerFeaturesHidden);
  const setOwnerFeaturesHidden = useAuthStore((state) => state.setOwnerFeaturesHidden);
  const showOwnerFeatures = isOwner && !ownerFeaturesHidden;
  const {
    models,
    selectedModelId,
    setSelectedModelId,
    fetchBootstrap,
    frontends,
    ideTargets,
    selectedFrontendId,
    setSelectedFrontendId,
    workflowModes,
    defaultConversationMode,
  } = useSettingsStore();
  const projectId = useSandboxStore((state) => state.projectId);
  const persistentProjectId = useSandboxStore((state) => state.persistentProjectId);
  const attachProject = useSandboxStore((state) => state.attachProject);
  const peers = useCollabStore((state) => state.peers);
  const companionClients = useCollabStore((state) => state.companionClients);
  const globalClients = useCollabStore((state) => state.globalClients);
  const audits = useCollabStore((state) => state.audits);
  const collabLoading = useCollabStore((state) => state.loading);
  const fetchCompanionClients = useCollabStore((state) => state.fetchCompanionClients);
  const fetchGlobalClients = useCollabStore((state) => state.fetchGlobalClients);
  const fetchPeers = useCollabStore((state) => state.fetchPeers);
  const savePeers = useCollabStore((state) => state.savePeers);
  const fetchAudits = useCollabStore((state) => state.fetchAudits);
  const createAudit = useCollabStore((state) => state.createAudit);
  const { status: engineStatus, stats } = useEngineStore();
  const activeMode = useLayoutStore((state) => state.mode);
  const setActivePanel = useLayoutStore((state) => state.setActivePanel);
  const broadcastMode = useChatStore((state) => state.broadcastMode);
  const broadcastTargetClientIds = useChatStore((state) => state.broadcastTargetClientIds);
  const syncState = useVinextStore((state: VinextState) => state.syncState);
  const latencyMs = useVinextStore((state: VinextState) => state.latencyMs);
  const motionBudget = useVinextStore((state: VinextState) => state.motionBudget);
  const trustLevel = useVinextStore((state: VinextState) => state.trustLevel);
  const [auditPrompt, setAuditPrompt] = useState('Audit this project for correctness, regressions, and architecture risks.');
  const [_expandedResults, _setExpandedResults] = useState<Set<string>>(new Set());
  const [_launchingTargetId, setLaunchingTargetId] = useState<string | null>(null);

  useEffect(() => {
    fetchBootstrap();
    void fetchGlobalClients();
  }, [fetchBootstrap, fetchGlobalClients]);

  useEffect(() => {
    if (!persistentProjectId) return;
    void fetchCompanionClients(persistentProjectId);
    void fetchPeers(persistentProjectId);
    void fetchAudits(persistentProjectId);
  }, [persistentProjectId, fetchAudits, fetchCompanionClients, fetchPeers]);

  const ideClientStatus = useMemo(() => {
    const ONLINE_THRESHOLD = 30 * 60_000;
    const now = Date.now();
    const statusMap = new Map<string, { online: boolean; clientIds: string[]; lastActivity: string }>();

    for (const target of ideTargets) {
      const matchingClients = globalClients.filter((c) =>
        c.launchTarget === target.id || c.clientType === target.id,
      );
      const onlineClients = matchingClients.filter((c) => {
        const lastActivity = Math.max(
          c.lastPolledAt ? new Date(c.lastPolledAt).getTime() : 0,
          c.lastSeenAt ? new Date(c.lastSeenAt).getTime() : 0,
        );
        return now - lastActivity < ONLINE_THRESHOLD;
      });

      const latestActivity = matchingClients.reduce((latest, c) => {
        const t = Math.max(
          c.lastPolledAt ? new Date(c.lastPolledAt).getTime() : 0,
          c.lastSeenAt ? new Date(c.lastSeenAt).getTime() : 0,
        );
        return t > latest ? t : latest;
      }, 0);

      statusMap.set(target.id, {
        online: onlineClients.length > 0,
        clientIds: matchingClients.map((c) => c.id),
        lastActivity: latestActivity > 0 ? formatRelative(new Date(latestActivity).toISOString()) : 'Never connected',
      });
    }
    return statusMap;
  }, [ideTargets, globalClients]);

  const _compatibleClientsByPeerKey = useMemo(() => {
    return new Map(peers.map((peer) => [
      peer.peerKey,
      companionClients
        .filter((client) => client.launchTarget === peer.launchTarget)
        .sort((left, right) => {
          const leftBound = left.id === peer.preferredClientId ? 1 : 0;
          const rightBound = right.id === peer.preferredClientId ? 1 : 0;
          return rightBound - leftBound;
        }),
    ]));
  }, [companionClients, peers]);

  const _visibleAudits = useMemo(() => {
    return audits.slice(0, 3).map((audit) => {
      const submittedCount = audit.results.filter((result) => result.status === 'submitted').length;
      const claimedCount = audit.results.filter((result) => result.status === 'claimed' && !result.claimIsStale).length;
      const staleCount = audit.results.filter((result) => result.status === 'claimed' && result.claimIsStale).length;
      const pendingCount = audit.results.filter((result) => result.status === 'pending').length;
      const sortedResults = [...audit.results].sort((left, right) => {
        const leftWinner = left.peerKey === audit.winningPeerKey ? 1 : 0;
        const rightWinner = right.peerKey === audit.winningPeerKey ? 1 : 0;
        if (rightWinner !== leftWinner) return rightWinner - leftWinner;
        const leftSubmitted = left.status === 'submitted' ? 1 : 0;
        const rightSubmitted = right.status === 'submitted' ? 1 : 0;
        if (rightSubmitted !== leftSubmitted) return rightSubmitted - leftSubmitted;
        return (right.confidence ?? -1) - (left.confidence ?? -1);
      });
      return { ...audit, submittedCount, claimedCount, staleCount, pendingCount, sortedResults };
    });
  }, [audits]);

  const _invitePreset = async (targetId: string, preset: { peerKey: string; displayName: string; model: string }) => {
    if (!persistentProjectId) {
      toast.error('Open a project before inviting IDE peers');
      return;
    }
    const nextPeers = [
      ...peers.filter((peer) => peer.peerKey !== preset.peerKey),
      {
        peerKey: preset.peerKey,
        displayName: preset.displayName,
        ide: targetId,
        model: preset.model,
        status: 'invited' as const,
        launchTarget: targetId,
        preferredClientId: null,
        instructions: null,
      },
    ];
    try {
      await savePeers(persistentProjectId, nextPeers);
      toast.success(`${preset.displayName} joined the project roster`);
    } catch {
      toast.error('Unable to update the project roster');
    }
  };

  const handleAudit = async () => {
    if (!persistentProjectId) {
      toast.error('Open a project before requesting an audit');
      return;
    }
    const audit = await createAudit(persistentProjectId, auditPrompt, peers.map((peer) => peer.peerKey));
    if (audit) {
      toast.success(`Audit fanout started for ${audit.results.length} peer${audit.results.length === 1 ? '' : 's'}`);
    } else {
      toast.error('Unable to create audit request');
    }
  };

  const _handlePreferredClientChange = async (peerKey: string, preferredClientId: string) => {
    if (!persistentProjectId) return;
    const nextPeers = peers.map((peer) => ({
      peerKey: peer.peerKey,
      displayName: peer.displayName,
      ide: peer.ide,
      model: peer.model,
      status: peer.status,
      launchTarget: peer.launchTarget,
      preferredClientId: peer.peerKey === peerKey ? (preferredClientId || null) : peer.preferredClientId,
      instructions: peer.instructions,
    }));
    try {
      await savePeers(persistentProjectId, nextPeers);
      toast.success('Peer routing updated');
    } catch {
      toast.error('Unable to update peer routing');
    }
  };

  const createHandoffIntent = async (targetId: string) => {
    if (!persistentProjectId) {
      toast.error('Open a project before launching a companion IDE');
      return null;
    }
    const response = await apiFetch(`/api/projects/${persistentProjectId}/handoff-intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: targetId, clientInfo: 'VeggaAI desktop shell' }),
    });
    const payload = await response.json().catch(() => null) as (ProjectHandoffIntentResponse & { error?: string }) | null;
    if (!response.ok || !payload?.token) {
      throw new Error(payload?.error ?? 'Unable to create project handoff');
    }
    return payload;
  };

  const _handleLaunchTarget = async (targetId: string, targetLabel: string) => {
    setLaunchingTargetId(targetId);
    try {
      const handoff = await createHandoffIntent(targetId);
      if (!handoff?.launchUrl) throw new Error(`${targetLabel} does not provide a direct launch link yet`);
      await openExternalTarget(handoff.launchUrl);
      toast.success(`Opening ${targetLabel} for this project`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to open ${targetLabel}`);
    } finally {
      setLaunchingTargetId(null);
    }
  };

  const _handleCopyHandoffLink = async (targetId: string, targetLabel: string) => {
    setLaunchingTargetId(targetId);
    try {
      const handoff = await createHandoffIntent(targetId);
      if (!handoff?.launchUrl) throw new Error(`${targetLabel} does not provide a launch link yet`);
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is not available in this shell');
      await navigator.clipboard.writeText(handoff.launchUrl);
      toast.success(`${targetLabel} handoff link copied to clipboard`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to copy handoff link');
    } finally {
      setLaunchingTargetId(null);
    }
  };

  const _handleAttachCurrentSandbox = async () => {
    if (!projectId) {
      toast.error('Create or open a sandbox project first');
      return;
    }
    try {
      await attachProject(projectId);
      toast.success('Group chat attached to the current sandbox');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to attach the current sandbox');
    }
  };

  const startCollabChat = async (label: string, targetClientIds?: string[]) => {
    try {
      if (!useChatStore.getState().activeConversationId) {
        await useChatStore.getState().createConversation(
          selectedModelId ?? models[0]?.id ?? 'vai:v0',
          'chat',
          { sandboxProjectId: projectId ?? null },
        );
      }
      useChatStore.getState().setBroadcastMode(true, targetClientIds);
      setActivePanel('chats');
      toast.success(`Connected to ${label} — type your message`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to connect');
    }
  };

  const disconnectBroadcast = () => {
    useChatStore.getState().setBroadcastMode(false);
    toast.success('Disconnected from broadcast');
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* ── Section: Preferences ── */}
      {isOwner && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
          <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Preferences</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-zinc-200">Owner view</div>
              <div className="text-[10px] text-zinc-500">{ownerFeaturesHidden ? 'Showing user experience' : 'Showing owner tools'}</div>
            </div>
            <button
              role="switch"
              aria-checked={!ownerFeaturesHidden}
              onClick={() => setOwnerFeaturesHidden(!ownerFeaturesHidden)}
              className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${!ownerFeaturesHidden ? 'bg-amber-500' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${!ownerFeaturesHidden ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      )}

      {/* ── Section: Workspace ── */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
        <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Workspace</div>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">Model</label>
            <select
              value={selectedModelId ?? ''}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 transition-colors focus:border-violet-500/50 focus:outline-none"
            >
              {models.length === 0 && <option value="">No models available</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName} · {m.provider}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">Frontend shell</label>
            <select
              value={selectedFrontendId ?? ''}
              onChange={(e) => setSelectedFrontendId(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 transition-colors focus:border-violet-500/50 focus:outline-none"
            >
              {frontends.length === 0 && <option value="">No frontend shells available</option>}
              {frontends.map((frontend) => (
                <option key={frontend.id} value={frontend.id}>{frontend.framework} · {frontend.role}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
        <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Memory Workflow</div>
        <div className="space-y-2.5 text-[11px] leading-5 text-zinc-500">
          <div className="rounded-xl border border-zinc-800/50 bg-zinc-950/60 px-3 py-2.5">
            <div className="text-zinc-200">1. Runtime</div>
            <div className="mt-1">
              {engineStatus === 'ready'
                ? `Online and ready with ${(stats?.documentsIndexed ?? 0).toLocaleString()} indexed documents.`
                : 'Keep the runtime running so capture and memory questions work.'}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800/50 bg-zinc-950/60 px-3 py-2.5">
            <div className="text-zinc-200">2. Browser extension</div>
            <div className="mt-1">
              Capture one article, GitHub repo, or search result from the extension popup. The desktop shell will use that memory on the next chat turn.
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800/50 bg-zinc-950/60 px-3 py-2.5">
            <div className="text-zinc-200">3. Grounded question</div>
            <div className="mt-1">
              Ask what you read earlier, what it said, or why it matters. When the answer is source-backed, the chat view will show the grounding sources directly above the response.
            </div>
          </div>
        </div>
        <button
          onClick={() => setActivePanel('chats')}
          className="mt-3 w-full rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-[11px] font-medium text-blue-200 transition-colors hover:bg-blue-500/20"
        >
          Go to chat
        </button>
      </div>

      {/* ── Section: Engine (owner only) ── */}
      {showOwnerFeatures && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
          <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Engine</div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Status</span>
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${
                engineStatus === 'ready' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                  : engineStatus === 'offline' ? 'bg-red-500 animate-pulse'
                  : engineStatus === 'starting' ? 'bg-yellow-500 animate-pulse'
                  : 'bg-zinc-600'
              }`} />
              <span className={`text-xs ${
                engineStatus === 'ready' ? 'text-emerald-400'
                  : engineStatus === 'offline' ? 'text-red-400'
                  : 'text-zinc-500'
              }`}>
                {engineStatus === 'ready' ? 'Online' : engineStatus === 'offline' ? 'Offline' : engineStatus === 'starting' ? 'Starting...' : 'Idle'}
              </span>
            </div>
          </div>
          {engineStatus === 'ready' && stats && (
            <div className="space-y-1 text-xs text-zinc-600">
              <div className="flex justify-between"><span>Vocabulary</span><span className="text-zinc-400">{stats.vocabSize.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Knowledge</span><span className="text-zinc-400">{stats.knowledgeEntries.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Documents</span><span className="text-zinc-400">{stats.documentsIndexed.toLocaleString()}</span></div>
            </div>
          )}
          {engineStatus === 'offline' && (
            <p className="text-[10px] text-red-400/70">Run <code className="rounded bg-zinc-800 px-1 text-zinc-300">pnpm dev:web</code></p>
          )}
          <div className="mt-3 border-t border-zinc-800/40 pt-3">
            <div className="mb-2 text-xs font-medium text-zinc-400">Build</div>
            <BuildStatusBadge />
          </div>
        </div>
      )}

      {/* ── Section: Workflow (owner only) ── */}
      {showOwnerFeatures && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
          <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Workflow</div>
          <div className="mb-2 text-[11px] text-zinc-500">
            Runtime default: <span className="text-zinc-300">{defaultConversationMode}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {workflowModes.map((workflowMode) => (
              <span
                key={workflowMode}
                title={MODE_DESCRIPTIONS[workflowMode]}
                className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-wide ${
                  workflowMode === activeMode
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-300'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-500'
                }`}
              >
                {workflowMode}
              </span>
            ))}
          </div>
          <div className="mt-3 border-t border-zinc-800/40 pt-3">
            <div className="mb-2 text-xs font-medium text-zinc-400">Vinext Envelope</div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
              <div>Sync<div className="mt-0.5 text-zinc-300">{syncState}</div></div>
              <div>Trust<div className="mt-0.5 text-zinc-300">{trustLevel}</div></div>
              <div>Motion<div className="mt-0.5 text-zinc-300">{motionBudget}</div></div>
              <div>Latency<div className="mt-0.5 text-zinc-300">{latencyMs === null ? 'offline' : `${Math.round(latencyMs)}ms`}</div></div>
            </div>
          </div>
        </div>
      )}

      {/* ── Section: IDE Connections ── */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            <Bot className="h-3.5 w-3.5" />
            IDE Connections
          </div>
          <button
            onClick={() => void fetchGlobalClients()}
            className="text-[10px] text-zinc-600 transition-colors hover:text-zinc-400"
          >
            Refresh
          </button>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
          Send messages to your connected IDE extensions directly from the desktop app.
        </p>

        <div className="space-y-1.5">
          {ideTargets.filter((t) => t.id !== 'desktop').map((target) => {
            const status = ideClientStatus.get(target.id);
            const isOnline = status?.online ?? false;
            return (
              <div
                key={target.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/50 bg-zinc-950/60 px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${
                    isOnline
                      ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                      : 'bg-zinc-600'
                  }`} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-200">{target.label}</div>
                    <div className="text-[10px] text-zinc-500">
                      {isOnline ? `Active · ${status?.lastActivity}` : status?.lastActivity ?? 'Not connected'}
                    </div>
                  </div>
                </div>
                {(() => {
                  const isConnected = broadcastMode && status?.clientIds?.some((cid: string) => broadcastTargetClientIds.includes(cid));
                  if (isConnected) {
                    return (
                      <button
                        onClick={disconnectBroadcast}
                        className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-medium text-emerald-200 transition-colors hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-200"
                      >
                        <Wifi className="h-3 w-3" />
                        Connected
                      </button>
                    );
                  }
                  return (
                    <button
                      onClick={() => void startCollabChat(target.label, status?.clientIds)}
                      disabled={!status?.clientIds?.length}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-medium transition-colors ${
                        isOnline
                          ? 'border border-blue-500/30 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20'
                          : status?.clientIds?.length
                            ? 'border border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                            : 'border border-zinc-800 bg-zinc-900 text-zinc-600 cursor-not-allowed'
                      }`}
                    >
                      {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                      {status?.clientIds?.length ? 'Connect' : 'Setup'}
                    </button>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {globalClients.length === 0 && (
          <div className="mt-3 rounded-xl border border-zinc-800/40 bg-zinc-950/50 px-3 py-2.5 text-center">
            <div className="text-[11px] text-zinc-500">No IDE extensions connected yet</div>
            <div className="mt-1 text-[10px] text-zinc-600">
              Install the VeggaAI extension in VS Code, Cursor, or Antigravity and sign in
            </div>
          </div>
        )}
      </div>

      {/* ── Section: Project Collaboration (owner, project-attached) ── */}
      {showOwnerFeatures && persistentProjectId && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-3">
          <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Project Collaboration</div>

          <div className="rounded-md border border-zinc-800/50 bg-zinc-950/60 p-2">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-zinc-300">
              <GitBranch className="h-3.5 w-3.5" />
              Active Peer Roster
            </div>
            <div className="space-y-1.5">
              {peers.length === 0 && (
                <div className="text-[11px] text-zinc-500">No peers invited yet.</div>
              )}
              {peers.map((peer) => (
                <div key={peer.peerKey} className="rounded-md border border-zinc-800/40 px-2 py-2 text-[11px]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-zinc-200">{peer.displayName}</div>
                      <div className="text-[10px] text-zinc-500">{peer.ide} · {peer.model}</div>
                    </div>
                    <span className="rounded-full border border-zinc-700/50 px-2 py-0.5 text-[10px] text-zinc-400">{peer.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 rounded-md border border-zinc-800/50 bg-zinc-950/60 p-2">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-zinc-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Audit Fanout
            </div>
            <textarea
              value={auditPrompt}
              onChange={(event) => setAuditPrompt(event.target.value)}
              className="min-h-20 w-full rounded-md border border-zinc-800/50 bg-zinc-950 px-2.5 py-2 text-[11px] text-zinc-200 outline-none transition-colors focus:border-blue-500/50"
            />
            <button
              onClick={() => void handleAudit()}
              disabled={collabLoading || peers.length === 0}
              className="mt-2 w-full rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[11px] font-medium text-blue-200 transition-colors hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:border-zinc-800/50 disabled:bg-zinc-900 disabled:text-zinc-600"
            >
              Run audit with {peers.length} peer{peers.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
