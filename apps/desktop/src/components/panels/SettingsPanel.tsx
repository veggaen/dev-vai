import { useEffect, useState, useMemo, useCallback } from 'react';
import { Bot, CheckCircle2, GitBranch, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/authStore.js';
import { useSettingsStore } from '../../stores/settingsStore.js';
import { useSandboxStore } from '../../stores/sandboxStore.js';
import { useCollabStore } from '../../stores/collabStore.js';
import { useEngineStore } from '../../stores/engineStore.js';
import { useLayoutStore } from '../../stores/layoutStore.js';
import { useChatStore } from '../../stores/chatStore.js';
import { useCursorStore } from '../../stores/cursorStore.js';
import { useVinextStore, type VinextState } from '../../stores/vinextStore.js';
import { BuildStatusBadge } from '../BuildStatusBadge.js';
import { StatusDot } from '../brand/StatusDot.js';
import { presentStatus, rosterHasTrouble } from '../brand/StatusDot.logic.js';
import { KnowledgeEngineMetrics } from './KnowledgeEngineMetrics.js';
import { apiFetch } from '../../lib/api.js';
import { isTimelineViewEnabled, setTimelineViewEnabled } from '../../lib/timeline-flag.js';
import { MODE_DESCRIPTIONS } from '../../stores/layoutStore.js';
import {
  applyThemeById,
  getActiveThemeId,
  withThemeTransition,
} from '../../lib/odysseus-theme.js';
import type { ProjectHandoffIntentResponse } from '@vai/api-types/project-responses';
import {
  SettingsShell,
  SettingsSection,
  SettingsCard,
  SettingsField,
  SettingsSelect,
  SettingsSwitch,
  type SettingsTabId,
} from './settings/SettingsShell.js';
import { ThemeManager } from './settings/ThemeManager.js';
import { ShortcutCustomizer } from './settings/ShortcutCustomizer.js';

const LAYOUT_MODES = [
  { id: 'compact' as const, label: 'Compact', hint: 'VS Code — edge-to-edge, minimal chrome' },
  { id: 'open' as const, label: 'Open', hint: 'Floating panels with soft shadows' },
  { id: 'odyssey' as const, label: 'Odyssey', hint: 'Odysseus-style — airy canvas, bubble panels' },
];

function loadActiveThemeId(): string {
  return getActiveThemeId();
}

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
  const layoutMode = useLayoutStore((state) => state.layoutMode);
  const setLayoutMode = useLayoutStore((state) => state.setLayoutMode);
  const setActivePanel = useLayoutStore((state) => state.setActivePanel);
  const overlayVisible = useCursorStore((state) => state.overlayVisible);
  const setOverlayVisible = useCursorStore((state) => state.setOverlayVisible);
  const broadcastMode = useChatStore((state) => state.broadcastMode);
  const broadcastTargetClientIds = useChatStore((state) => state.broadcastTargetClientIds);
  const syncState = useVinextStore((state: VinextState) => state.syncState);
  const latencyMs = useVinextStore((state: VinextState) => state.latencyMs);
  const motionBudget = useVinextStore((state: VinextState) => state.motionBudget);
  const trustLevel = useVinextStore((state: VinextState) => state.trustLevel);
  const [activeTab, setActiveTab] = useState<SettingsTabId>('appearance');
  const [activeThemeId, setActiveThemeId] = useState(loadActiveThemeId);
  const setThemeEditingBaseId = useLayoutStore((state) => state.setThemeEditingBaseId);
  const [editingThemePresetId, setEditingThemePresetIdLocal] = useState<string | null>(null);
  const setEditingThemePresetId = useCallback((id: string | null) => {
    setEditingThemePresetIdLocal(id);
    setThemeEditingBaseId(id);
  }, [setThemeEditingBaseId]);
  const [auditPrompt, setAuditPrompt] = useState('Audit this project for correctness, regressions, and architecture risks.');
  const [councilConfig, setCouncilConfig] = useState<{
    enabled: boolean;
    enableGrok: boolean;
    localLensCount: number;
    activeMembers: {
      id: string;
      name: string;
      topic?: string;
      status?: 'available' | 'cooldown' | 'down';
      reason?: string;
      detail?: string;
      fixHint?: string;
    }[];
    actionHints?: string[];
  } | null>(null);
  const [councilSaving, setCouncilSaving] = useState(false);
  const [timelineView, setTimelineViewState] = useState(isTimelineViewEnabled);
  const [_expandedResults, _setExpandedResults] = useState<Set<string>>(new Set());
  const [_launchingTargetId, setLaunchingTargetId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'appearance') {
      setActiveThemeId(getActiveThemeId());
    }
  }, [activeTab]);

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

  useEffect(() => {
    if (activeTab !== 'engine' || !showOwnerFeatures) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch('/api/council/config');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setCouncilConfig(data);
      } catch {
        // council config is best-effort; the card simply stays hidden if unreachable
      }
    };
    void load();
    // Member status is a by-product of the convene loop, so it only changes as turns run.
    // Poll while the card is visible so "green when active" stays truthful instead of a
    // stale first-load snapshot (the exact edge case the council flagged). Cheap read.
    const timer = window.setInterval(() => void load(), 8_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [activeTab, showOwnerFeatures]);

  const updateCouncilConfig = useCallback(async (patch: { enableGrok?: boolean; localLensCount?: number; enabled?: boolean }) => {
    setCouncilSaving(true);
    try {
      const res = await apiFetch('/api/council/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('save failed');
      const data = await res.json();
      setCouncilConfig(data);
      toast.success('Council updated');
    } catch {
      toast.error('Unable to update council');
    } finally {
      setCouncilSaving(false);
    }
  }, []);

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

  const applyThemeId = useCallback((themeId: string) => {
    withThemeTransition(() => {
      applyThemeById(themeId);
    });
    setActiveThemeId(themeId);
  }, []);

  return (
    <div className="h-full min-h-0">
    <SettingsShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      showOwnerSections={showOwnerFeatures}
    >
      {activeTab === 'appearance' && (
        <>
          <SettingsSection
            title="Theme"
            description="Presets cover the whole shell. Customize any preset, save your own themes, duplicate, or delete when you are done experimenting."
          >
            <ThemeManager
              activeId={activeThemeId}
              onActiveChange={applyThemeId}
              editingId={editingThemePresetId}
              onEditingChange={setEditingThemePresetId}
            />
          </SettingsSection>

          <SettingsSection
            title="Layout"
            description="Compact is VS Code-like. Open adds floating panels. Odyssey is an Odysseus-inspired airy layout with separated bubbles."
          >
            <SettingsCard>
              <div className="grid gap-2 sm:grid-cols-3">
                {LAYOUT_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setLayoutMode(mode.id)}
                    className={`vai-selection-surface rounded-xl px-3 py-3 text-left ${
                      layoutMode === mode.id ? 'is-selected' : ''
                    }`}
                  >
                    <div className="text-sm font-medium text-[color:var(--fg)]">{mode.label}</div>
                    <div className="mt-1 text-[11px] leading-4 text-[color:var(--color-muted)]">{mode.hint}</div>
                  </button>
                ))}
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title="Vai Actions overlay">
            <SettingsCard>
              <SettingsSwitch
                checked={overlayVisible}
                onChange={setOverlayVisible}
                label="Show Vai Actions UI"
                description="Hover focus ring, action log, and demo overlays. Toggle also from the sparkles button on the activity rail."
              />
            </SettingsCard>
          </SettingsSection>
        </>
      )}

      {activeTab === 'ai' && (
        <>
          <SettingsSection title="Defaults" description="Model and shell used for new conversations.">
            <SettingsCard className="space-y-3">
              <SettingsField label="Model">
                <SettingsSelect
                  value={selectedModelId ?? ''}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                >
                  {models.length === 0 && <option value="">No models available</option>}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.displayName} · {m.provider}</option>
                  ))}
                </SettingsSelect>
              </SettingsField>
              <SettingsField label="Frontend shell">
                <SettingsSelect
                  value={selectedFrontendId ?? ''}
                  onChange={(e) => setSelectedFrontendId(e.target.value)}
                >
                  {frontends.length === 0 && <option value="">No frontend shells available</option>}
                  {frontends.map((frontend) => (
                    <option key={frontend.id} value={frontend.id}>{frontend.framework} · {frontend.role}</option>
                  ))}
                </SettingsSelect>
              </SettingsField>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title="Memory workflow" description="How capture, indexing, and grounded answers work together.">
            <SettingsCard className="space-y-2 text-[11px] leading-5 text-[color:var(--color-muted)]">
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-3 py-2.5">
                <div className="font-medium text-[color:var(--fg)]">1. Runtime</div>
                <div className="mt-1">
                  {engineStatus === 'ready'
                    ? `Online with ${(stats?.documentsIndexed ?? 0).toLocaleString()} indexed documents.`
                    : 'Keep the runtime running so capture and memory questions work.'}
                </div>
              </div>
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-3 py-2.5">
                <div className="font-medium text-[color:var(--fg)]">2. Browser extension</div>
                <div className="mt-1">Capture articles, repos, or search results from the extension popup.</div>
              </div>
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-3 py-2.5">
                <div className="font-medium text-[color:var(--fg)]">3. Grounded question</div>
                <div className="mt-1">Ask what you read earlier — source-backed answers show citations above the reply.</div>
              </div>
              <button
                type="button"
                onClick={() => setActivePanel('chats')}
                className="mt-1 w-full rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent-soft)] px-3 py-2 text-[11px] font-medium text-[color:var(--fg)] transition-colors hover:opacity-90"
              >
                Go to chat
              </button>
            </SettingsCard>
          </SettingsSection>
        </>
      )}

      {activeTab === 'integrations' && (
        <>
          <SettingsSection
            title="IDE connections"
            description="Send messages to connected IDE extensions from the desktop app."
          >
            <SettingsCard>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-[color:var(--fg)]">
                  <Bot className="h-3.5 w-3.5" />
                  Companion extensions
                </div>
                <button
                  type="button"
                  onClick={() => void fetchGlobalClients()}
                  className="text-[10px] text-[color:var(--color-muted)] transition-colors hover:text-[color:var(--fg)]"
                >
                  Refresh
                </button>
              </div>

              <div className="space-y-1.5">
                {ideTargets.filter((t) => t.id !== 'desktop').map((target) => {
                  const status = ideClientStatus.get(target.id);
                  const isOnline = status?.online ?? false;
                  return (
                    <div
                      key={target.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-[color:var(--color-muted)]'}`} />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[color:var(--fg)]">{target.label}</div>
                          <div className="text-[10px] text-[color:var(--color-muted)]">
                            {isOnline ? `Active · ${status?.lastActivity}` : status?.lastActivity ?? 'Not connected'}
                          </div>
                        </div>
                      </div>
                      {(() => {
                        const isConnected = broadcastMode && status?.clientIds?.some((cid: string) => broadcastTargetClientIds.includes(cid));
                        if (isConnected) {
                          return (
                            <button
                              type="button"
                              onClick={disconnectBroadcast}
                              className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-medium text-emerald-200"
                            >
                              <Wifi className="h-3 w-3" />
                              Connected
                            </button>
                          );
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => void startCollabChat(target.label, status?.clientIds)}
                            disabled={!status?.clientIds?.length}
                            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-medium transition-colors ${
                              isOnline
                                ? 'border border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--fg)]'
                                : status?.clientIds?.length
                                  ? 'border border-amber-500/30 bg-amber-500/10 text-amber-200'
                                  : 'cursor-not-allowed border border-[color:var(--border)] text-[color:var(--color-muted)]'
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
                <div className="mt-3 rounded-lg border border-dashed border-[color:var(--border)] px-3 py-2.5 text-center text-[11px] text-[color:var(--color-muted)]">
                  Install the VeggaAI extension in VS Code, Cursor, or Antigravity and sign in.
                </div>
              )}
            </SettingsCard>
          </SettingsSection>

          {showOwnerFeatures && persistentProjectId && (
            <SettingsSection title="Project collaboration">
              <SettingsCard className="space-y-3">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[color:var(--fg)]">
                    <GitBranch className="h-3.5 w-3.5" />
                    Active peer roster
                  </div>
                  <div className="space-y-1.5">
                    {peers.length === 0 && (
                      <div className="text-[11px] text-[color:var(--color-muted)]">No peers invited yet.</div>
                    )}
                    {peers.map((peer) => (
                      <div key={peer.peerKey} className="rounded-lg border border-[color:var(--border)] px-2 py-2 text-[11px]">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[color:var(--fg)]">{peer.displayName}</div>
                            <div className="text-[10px] text-[color:var(--color-muted)]">{peer.ide} · {peer.model}</div>
                          </div>
                          <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[10px] text-[color:var(--color-muted)]">{peer.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[color:var(--fg)]">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Audit fanout
                  </div>
                  <textarea
                    value={auditPrompt}
                    onChange={(event) => setAuditPrompt(event.target.value)}
                    className="min-h-20 w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--input-bg,var(--panel))] px-2.5 py-2 text-[11px] text-[color:var(--fg)] outline-none focus:border-[color:var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAudit()}
                    disabled={collabLoading || peers.length === 0}
                    className="mt-2 w-full rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent-soft)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--fg)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Run audit with {peers.length} peer{peers.length === 1 ? '' : 's'}
                  </button>
                </div>
              </SettingsCard>
            </SettingsSection>
          )}
        </>
      )}

      {activeTab === 'engine' && showOwnerFeatures && (
        <>
          <SettingsSection title="Runtime">
            <SettingsCard>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-[color:var(--color-muted)]">Status</span>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${
                    engineStatus === 'ready' ? 'bg-emerald-500'
                      : engineStatus === 'offline' ? 'bg-red-500 animate-pulse'
                      : engineStatus === 'starting' ? 'bg-yellow-500 animate-pulse'
                      : 'bg-[color:var(--color-muted)]'
                  }`} />
                  <span className="text-xs text-[color:var(--fg)]">
                    {engineStatus === 'ready' ? 'Online' : engineStatus === 'offline' ? 'Offline' : engineStatus === 'starting' ? 'Starting…' : 'Idle'}
                  </span>
                </div>
              </div>
              {engineStatus === 'ready' && stats && (
                <div className="space-y-1 text-xs text-[color:var(--color-muted)]">
                  <div className="flex justify-between"><span>Vocabulary</span><span className="text-[color:var(--fg)]">{stats.vocabSize.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>Knowledge</span><span className="text-[color:var(--fg)]">{stats.knowledgeEntries.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>Documents</span><span className="text-[color:var(--fg)]">{stats.documentsIndexed.toLocaleString()}</span></div>
                </div>
              )}
              {engineStatus === 'offline' && (
                <p className="text-[10px] text-red-400/80">Run <code className="rounded bg-[color:var(--panel-bg-muted)] px-1">pnpm dev:web</code></p>
              )}
              <div className="mt-3 border-t border-[color:var(--border)] pt-3">
                <div className="mb-2 text-xs font-medium text-[color:var(--fg)]">Build</div>
                <BuildStatusBadge />
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title="Workflow">
            <SettingsCard>
              <div className="mb-2 text-[11px] text-[color:var(--color-muted)]">
                Runtime default: <span className="text-[color:var(--fg)]">{defaultConversationMode}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {workflowModes.map((workflowMode) => (
                  <span
                    key={workflowMode}
                    title={MODE_DESCRIPTIONS[workflowMode]}
                    className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-wide ${
                      workflowMode === activeMode
                        ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--fg)]'
                        : 'border-[color:var(--border)] text-[color:var(--color-muted)]'
                    }`}
                  >
                    {workflowMode}
                  </span>
                ))}
              </div>
              <div className="mt-3 border-t border-[color:var(--border)] pt-3">
                <div className="mb-2 text-xs font-medium text-[color:var(--fg)]">Vinext envelope</div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-[color:var(--color-muted)]">
                  <div>Sync<div className="mt-0.5 text-[color:var(--fg)]">{syncState}</div></div>
                  <div>Trust<div className="mt-0.5 text-[color:var(--fg)]">{trustLevel}</div></div>
                  <div>Motion<div className="mt-0.5 text-[color:var(--fg)]">{motionBudget}</div></div>
                  <div>Latency<div className="mt-0.5 text-[color:var(--fg)]">{latencyMs === null ? 'offline' : `${Math.round(latencyMs)}ms`}</div></div>
                </div>
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection
            title="Turn process view"
            description="How each turn's work is shown in chat. The reasoning flow lays every Vai and council process out on a zoomable spine — phases, deliberation rounds, approval gates, and a ledger of notes for improving Vai."
          >
            <SettingsCard>
              <SettingsSwitch
                checked={timelineView}
                onChange={(on) => {
                  setTimelineViewEnabled(on);
                  setTimelineViewState(on);
                  toast.success(on ? 'Reasoning flow on' : 'Classic process tree');
                }}
                label="Reasoning flow"
                description={timelineView
                  ? 'Showing the spatial reasoning constellation — drag to pan, ctrl+wheel to zoom, click a node for detail.'
                  : 'Showing the classic top-down process tree.'}
              />
            </SettingsCard>
          </SettingsSection>

          {councilConfig && (
            <SettingsSection
              title="Council members"
              description="Who deliberates on each substantive turn. Local lenses run the on-device model from several angles; Grok is an external paid voice (off by default)."
            >
              <SettingsCard className="space-y-3">
                <SettingsSwitch
                  checked={councilConfig.enableGrok}
                  onChange={(on) => void updateCouncilConfig({ enableGrok: on })}
                  label="Grok (external)"
                  description={councilConfig.enableGrok
                    ? 'Seated. Calls the Grok CLI / friend-channel — uses credits.'
                    : 'Off. Enable only when you have Grok credits and want its voice.'}
                />
                <SettingsField label={`Local lens passes · ${councilConfig.localLensCount}`}>
                  <div className="flex flex-wrap gap-1.5">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        disabled={councilSaving}
                        onClick={() => void updateCouncilConfig({ localLensCount: n })}
                        className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                          councilConfig.localLensCount === n
                            ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--fg)]'
                            : 'border-[color:var(--border)] text-[color:var(--color-muted)]'
                        }`}
                      >
                        {n === 1 ? '1 (single)' : `${n} angles`}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] leading-4 text-[color:var(--color-muted)]">
                    More angles = the local model reviews as skeptic, pragmatist, capability-gap hunter, and intent reader — independent voices mixed and re-judged. Higher = slower + more VRAM.
                  </p>
                </SettingsField>
                {councilConfig.activeMembers.length > 0 && (
                  <div className="border-t border-[color:var(--border)] pt-2.5">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--color-muted)]">
                        Seated voices ({councilConfig.activeMembers.length})
                      </div>
                      {(() => {
                        const statuses = councilConfig.activeMembers.map((m) => m.status);
                        const trouble = rosterHasTrouble(statuses);
                        const allActive = statuses.every((s) => (s ?? 'available') === 'available');
                        return (
                          <span
                            className="inline-flex items-center gap-1.5 text-[10px] font-medium"
                            style={{ color: trouble ? 'var(--tone-warn)' : allActive ? 'var(--tone-good)' : 'var(--color-muted)' }}
                          >
                            <StatusDot status={trouble ? 'cooldown' : 'available'} size={7} />
                            {trouble ? 'Some resting' : allActive ? 'All active' : 'Idle'}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex flex-col gap-1">
                      {councilConfig.activeMembers.map((m) => {
                        const p = presentStatus(m.status);
                        return (
                          <div
                            key={m.id}
                            className="group flex items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)] px-2.5 py-1.5 transition-colors hover:border-[color:var(--selection-border)]"
                            title={m.fixHint ?? p.title}
                          >
                            <StatusDot status={m.status} size={8} />
                            <span className="min-w-0 flex-1 truncate text-[11px] text-[color:var(--fg)]">{m.name}</span>
                            {m.topic && m.topic !== 'other' && (
                              <span className="rounded border border-[color:var(--border)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[color:var(--color-muted)]">
                                {m.topic}
                              </span>
                            )}
                            <span
                              className="text-[10px] font-medium tabular-nums"
                              style={{ color: `var(${p.toneVar})` }}
                            >
                              {p.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {councilConfig.actionHints && councilConfig.actionHints.length > 0 && (
                      <div
                        className="mt-2 space-y-1 rounded-lg px-2.5 py-1.5"
                        style={{
                          border: '1px solid color-mix(in srgb, var(--tone-warn) 30%, transparent)',
                          background: 'color-mix(in srgb, var(--tone-warn) 8%, transparent)',
                        }}
                      >
                        {councilConfig.actionHints.map((hint, i) => (
                          <p key={i} className="text-[10px] leading-4 text-[color:var(--fg)]">{hint}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </SettingsCard>
            </SettingsSection>
          )}

          <SettingsSection title="Memory health" description="Ingest and retrieval diagnostics for the knowledge engine.">
            <SettingsCard>
              <KnowledgeEngineMetrics />
            </SettingsCard>
          </SettingsSection>
        </>
      )}

      {activeTab === 'shortcuts' && <ShortcutCustomizer />}

      {activeTab === 'account' && showOwnerFeatures && isOwner && (
        <SettingsSection title="Owner view" description="Switch between owner tools and the standard user experience.">
          <SettingsCard>
            <SettingsSwitch
              checked={!ownerFeaturesHidden}
              onChange={(on) => setOwnerFeaturesHidden(!on)}
              label="Show owner tools"
              description={ownerFeaturesHidden ? 'Currently showing user experience' : 'Engine, workflow, and admin sections visible'}
            />
          </Se