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
import { apiFetch } from '../../lib/api.js';
import { MODE_DESCRIPTIONS } from '../../stores/layoutStore.js';
import {
  applyThemeById,
  getActiveThemeId,
  listCustomThemeEntries,
} from '../../lib/odysseus-theme.js';
import type { ProjectHandoffIntentResponse } from '@vai/api-types/project-responses';
import {
  SettingsShell,
  SettingsSection,
  SettingsCard,
  SettingsField,
  SettingsSelect,
  SettingsSwitch,
  SettingsShortcutRow,
  ThemePresetGrid,
  type SettingsTabId,
} from './settings/SettingsShell.js';

const LAYOUT_MODES = [
  { id: 'compact' as const, label: 'Compact', hint: 'VS Code — edge-to-edge, minimal chrome' },
  { id: 'open' as const, label: 'Open', hint: 'Floating panels with soft shadows' },
  { id: 'odyssey' as const, label: 'Odyssey', hint: 'Odysseus-style — airy canvas, bubble panels' },
];

const KEYBOARD_SHORTCUTS: { keys: string; description: string }[] = [
  { keys: 'Ctrl+K', description: 'Quick switch — fuzzy search conversations' },
  { keys: 'Ctrl+,', description: 'Open settings' },
  { keys: 'Ctrl+S', description: 'Cycle sidebar: expanded → rail → hidden' },
  { keys: 'Ctrl+0', description: 'Focus mode — chat only' },
  { keys: 'Ctrl+1 … Ctrl+5', description: 'Switch mode (chat, agent, builder, plan, debate)' },
  { keys: 'Ctrl+B', description: 'Toggle builder / preview panel' },
  { keys: 'Ctrl+E', description: 'Toggle file explorer' },
  { keys: 'Ctrl+J', description: 'Toggle debug console' },
  { keys: 'Ctrl+Shift+F', description: 'Focus chat search in sidebar' },
  { keys: 'Ctrl+Shift+L', description: 'Open dev logs' },
  { keys: 'Ctrl+Shift+K', description: 'Open knowledge base' },
  { keys: 'Ctrl+Shift+M', description: 'Cycle layout: Compact → Open → Odyssey' },
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
  const [customThemes, setCustomThemes] = useState(() => listCustomThemeEntries());
  const setThemeEditingBaseId = useLayoutStore((state) => state.setThemeEditingBaseId);
  const [editingThemePresetId, setEditingThemePresetIdLocal] = useState<string | null>(null);
  const setEditingThemePresetId = useCallback((id: string | null) => {
    setEditingThemePresetIdLocal(id);
    setThemeEditingBaseId(id);
  }, [setThemeEditingBaseId]);
  const [auditPrompt, setAuditPrompt] = useState('Audit this project for correctness, regressions, and architecture risks.');
  const [_expandedResults, _setExpandedResults] = useState<Set<string>>(new Set());
  const [_launchingTargetId, setLaunchingTargetId] = useState<string | null>(null);

  const refreshCustomThemes = useCallback(() => {
    setCustomThemes(listCustomThemeEntries());
  }, []);

  useEffect(() => {
    if (activeTab === 'appearance') {
      setActiveThemeId(getActiveThemeId());
      refreshCustomThemes();
    }
  }, [activeTab, refreshCustomThemes]);

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

  const applyThemeId = useCallback((themeId: string) => {
    applyThemeById(themeId);
    setActiveThemeId(themeId);
  }, []);

  const handleThemeSelect = useCallback((themeId: string) => {
    setEditingThemePresetId(null);
    applyThemeId(themeId);
  }, [applyThemeId, setEditingThemePresetId]);

  const customThemeCards = useMemo(() => {
    return customThemes.map((theme) => ({
      id: theme.id,
      label: theme.label,
      basePresetId: theme.basePresetId,
      swatch: [theme.bg, theme.fg, theme.panel, theme.red],
    }));
  }, [customThemes]);

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
            description="Five core colors drive the whole UI — same model as Odysseus. Pick a preset or use Light/Dark in the chat header."
          >
            <ThemePresetGrid
              activeId={activeThemeId}
              onSelect={handleThemeSelect}
              editingPresetId={editingThemePresetId}
              onStartEdit={setEditingThemePresetId}
              onEndEdit={() => {
                applyThemeId(activeThemeId);
                setEditingThemePresetId(null);
              }}
              onThemeSaved={(themeId) => {
                refreshCustomThemes();
                applyThemeId(themeId);
                toast.success('Custom theme saved');
              }}
              customThemes={customThemeCards}
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
                    className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                      layoutMode === mode.id
                        ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)]'
                        : 'border-[color:var(--border)] hover:border-[color:var(--accent)]'
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
        </>
      )}

      {activeTab === 'shortcuts' && (
        <SettingsSection title="Keyboard shortcuts" description="Global shortcuts work outside text fields unless noted.">
          <SettingsCard className="overflow-hidden p-0">
            {KEYBOARD_SHORTCUTS.map((row) => (
              <SettingsShortcutRow key={row.keys} keys={row.keys} description={row.description} />
            ))}
          </SettingsCard>
        </SettingsSection>
      )}

      {activeTab === 'account' && showOwnerFeatures && isOwner && (
        <SettingsSection title="Owner view" description="Switch between owner tools and the standard user experience.">
          <SettingsCard>
            <SettingsSwitch
              checked={!ownerFeaturesHidden}
              onChange={(on) => setOwnerFeaturesHidden(!on)}
              label="Show owner tools"
              description={ownerFeaturesHidden ? 'Currently showing user experience' : 'Engine, workflow, and admin sections visible'}
            />
          </SettingsCard>
        </SettingsSection>
      )}
    </SettingsShell>
    </div>
  );
}
