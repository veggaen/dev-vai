/**
 * VeggaAI Dev Logs — VS Code Extension v0.6.0
 *
 * Zero-discipline auto-capture of ALL VS Code activity into VeggaAI Dev Logs:
 * - File edits, creates, deletes (with diff stats)
 * - Terminal commands (via shell integration)
 * - Editor focus / tab switches
 * - Diagnostics changes
 * - Task execution (build, test, lint)
 * - Debug sessions
 * - @vai chat participant (proxied Copilot)
 * - Live webview panel with event-driven updates
 * - FULL conversation capture (user messages, AI responses, thinking, tool calls)
 *
 * v0.6.0 — FULL CONVERSATION CAPTURE:
 * - Captures user messages from `requests` patches (message.text)
 * - Captures assistant response text blocks
 * - Captures AI reasoning/thinking blocks
 * - Captures tool invocations (file edits, terminal commands, searches)
 * - Fallback: tracks inputState.inputText for user message recovery
 * - All content pushed to Dev Logs automatically
 *
 * NO polling. NO manual pushes. Events flow via EventEmitter → flush every 500ms.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { apiCall, isServerHealthy } from './api.js';
import {
  createSession,
  endSession,
  getActiveSession,
  pushEvent,
  dispose as disposeSession,
  initSessionManager,
  restoreSession,
  attachToSession,
} from './session.js';
import { registerFileWatchers } from './capture-files.js';
import { registerTerminalWatchers } from './capture-terminal.js';
import { registerEditorWatchers } from './capture-editor.js';
import { registerOutputWatchers } from './capture-output.js';
import { registerChatParticipant, enqueueBroadcast, triggerBroadcastInChat } from './capture-chat.js';
import { registerStatusBar } from './statusbar.js';
import { openLogsPanel } from './webview.js';
import { exportSessionMarkdown } from './export.js';
import { registerChatHistoryWatcher, getAvailableChatSessions } from './capture-chat-history.js';
import { registerClaudeCodeWatcher } from './capture-claude-code.js';
import {
  initPlatformAuth,
  restorePlatformAuth,
  signInToPlatform,
  signOutFromPlatform,
  getPlatformAuthState,
  onDidChangePlatformAuthState,
} from './platform-auth.js';

/* ── Runtime Server Auto-Start ─────────────────────────────────── */

let runtimeTerminal: vscode.Terminal | null = null;
let sessionFileWatcher: vscode.FileSystemWatcher | null = null;

interface SandboxListItem {
  id: string;
  name: string;
  status: string;
  devPort: number | null;
  owned: boolean;
}

interface SandboxHandoff {
  id: string;
  name: string;
  rootDir: string;
  devPort: number | null;
  devUrl: string | null;
  fileCount: number;
  owned: boolean;
}

interface AuditWorkItem {
  auditRequestId: string;
  projectId: string;
  sandboxProjectId: string;
  projectName: string;
  projectRootDir: string;
  prompt: string;
  scope: string;
  createdAt: string;
  peerKey: string;
  peerDisplayName: string;
  peerIde: string;
  peerModel: string;
  launchTarget: string;
  instructions: string | null;
  devPort: number | null;
  devUrl: string | null;
}

async function ensureRuntimeRunning(): Promise<boolean> {
  // Check if already healthy
  if (await isServerHealthy()) return true;

  // Try to start the runtime server
  console.log('[vai] Runtime not reachable — attempting auto-start...');

  // Find workspace folder
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return false;

  // Create or reuse terminal for runtime
  runtimeTerminal = vscode.window.createTerminal({
    name: 'VeggaAI Runtime',
    cwd: workspaceFolder.uri,
    hideFromUser: true, // Runs in background
  });
  runtimeTerminal.sendText('pnpm --filter @vai/runtime dev');

  // Wait for server to come up (check every 2s, max 15s)
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await isServerHealthy()) {
      console.log('[vai] Runtime server started successfully');
      return true;
    }
  }

  console.warn('[vai] Runtime server did not start within 15 seconds');
  return false;
}

async function openSandboxProject(): Promise<void> {
  const healthy = await ensureRuntimeRunning();
  if (!healthy) {
    vscode.window.showErrorMessage('VeggaAI runtime is not running. Start it manually with: pnpm --filter @vai/runtime dev');
    return;
  }

  const projects = await apiCall('/api/sandbox') as SandboxListItem[];
  if (!projects.length) {
    vscode.window.showInformationMessage('No sandbox projects are available from the VeggaAI runtime');
    return;
  }

  const selection = await vscode.window.showQuickPick(
    projects.map((project) => ({
      label: project.name,
      description: project.id,
      detail: `${project.status}${project.devPort ? ` | preview :${project.devPort}` : ''}${project.owned ? ' | owned' : ''}`,
      project,
    })),
    {
      placeHolder: 'Choose a VeggaAI sandbox project to open in VS Code',
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );

  if (!selection) {
    return;
  }

  const handoff = await apiCall(`/api/sandbox/${selection.project.id}/handoff`) as SandboxHandoff;
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(handoff.rootDir), false);
}

async function openSandboxProjectFromIntent(intentToken: string): Promise<void> {
  const healthy = await ensureRuntimeRunning();
  if (!healthy) {
    throw new Error('VeggaAI runtime is not running. Start it manually with: pnpm --filter @vai/runtime dev');
  }

  const handoff = await apiCall('/api/projects/handoff/consume', 'POST', {
    intentToken,
    target: 'vscode',
  }) as SandboxHandoff & { sandboxProjectId: string };

  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(handoff.rootDir), false);
}

function formatAuditWorkPacket(workItem: AuditWorkItem): string {
  const lines = [
    `# VeggaAI Audit Work`,
    '',
    `Project: ${workItem.projectName}`,
    `Project ID: ${workItem.projectId}`,
    `Peer: ${workItem.peerDisplayName}`,
    `Peer Key: ${workItem.peerKey}`,
    `IDE: ${workItem.peerIde}`,
    `Model: ${workItem.peerModel}`,
    `Scope: ${workItem.scope}`,
    `Launch Target: ${workItem.launchTarget}`,
    `Root Dir: ${workItem.projectRootDir}`,
  ];

  if (workItem.devUrl) {
    lines.push(`Preview: ${workItem.devUrl}`);
  }

  if (workItem.instructions) {
    lines.push('', '## Peer Instructions', '', workItem.instructions);
  }

  lines.push('', '## Audit Prompt', '', workItem.prompt, '');
  return lines.join('\n');
}

async function collectAuditVerdict(workItem: AuditWorkItem): Promise<{ verdict: string; confidence: number | null; rationale: string | null } | null> {
  const verdictPick = await vscode.window.showQuickPick([
    { label: 'Approve', value: 'approve', detail: 'The change looks correct as-is.' },
    { label: 'Request Changes', value: 'request-changes', detail: 'There are concrete issues that should be fixed.' },
    { label: 'Needs Investigation', value: 'needs-investigation', detail: 'The available evidence is not strong enough yet.' },
    { label: 'Custom Verdict', value: 'custom', detail: 'Write a custom audit verdict.' },
  ], {
    placeHolder: `Submit verdict for ${workItem.peerDisplayName}`,
    matchOnDetail: true,
  });

  if (!verdictPick) return null;

  const verdict = verdictPick.value === 'custom'
    ? await vscode.window.showInputBox({
      title: 'Custom audit verdict',
      prompt: 'Enter the verdict to submit for this audit',
      validateInput: (value) => value.trim().length > 0 ? null : 'Verdict is required',
    })
    : verdictPick.label;

  if (!verdict?.trim()) return null;

  const confidenceRaw = await vscode.window.showInputBox({
    title: 'Audit confidence',
    prompt: 'Confidence from 0 to 100. Leave empty if you do not want to score it.',
    validateInput: (value) => {
      if (!value.trim()) return null;
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100
        ? null
        : 'Enter an integer from 0 to 100';
    },
  });

  if (confidenceRaw === undefined) return null;

  const rationale = await vscode.window.showInputBox({
    title: 'Audit rationale',
    prompt: 'Optional summary of why this verdict is correct',
    value: '',
  });

  if (rationale === undefined) return null;

  return {
    verdict: verdict.trim(),
    confidence: confidenceRaw.trim() ? Number.parseInt(confidenceRaw, 10) : null,
    rationale: rationale.trim() || null,
  };
}

async function runAuditWork(): Promise<void> {
  const healthy = await ensureRuntimeRunning();
  if (!healthy) {
    vscode.window.showErrorMessage('VeggaAI runtime is not running. Start it manually with: pnpm --filter @vai/runtime dev');
    return;
  }

  const auth = getPlatformAuthState();
  if (!auth.user) {
    vscode.window.showInformationMessage('Sign in to the VeggaAI platform before claiming audit work.');
    return;
  }

  const workItem = await apiCall('/api/projects/audits/poll-consume', 'POST', {
    target: 'vscode',
  }) as AuditWorkItem | null;

  if (!workItem) {
    vscode.window.showInformationMessage('No pending VeggaAI audit work is queued for VS Code.');
    return;
  }

  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: formatAuditWorkPacket(workItem),
  });
  await vscode.window.showTextDocument(document, { preview: false });

  const verdict = await collectAuditVerdict(workItem);
  if (!verdict) {
    vscode.window.showInformationMessage(`Audit work claimed for ${workItem.peerDisplayName}. Re-run the command after the claim timeout if you want to pick it up again.`);
    return;
  }

  await apiCall(`/api/projects/${workItem.projectId}/audits/${workItem.auditRequestId}/results`, 'POST', {
    peerKey: workItem.peerKey,
    verdict: verdict.verdict,
    confidence: verdict.confidence,
    rationale: verdict.rationale,
  });

  vscode.window.showInformationMessage(`Submitted VeggaAI audit verdict for ${workItem.peerDisplayName}.`);
}

/* ── Broadcast Polling (IDE Orchestra) ─────────────────────────── */

interface BroadcastWorkItem {
  deliveryId: string;
  broadcastId: string;
  projectId: string | null;
  content: string;
  meta: { preferredModel?: string; targetChatApp?: string; targetSessionId?: string } | null;
  senderUserId: string;
  createdAt: string;
  expiresAt: string;
}

let broadcastPollTimer: ReturnType<typeof setInterval> | null = null;
let broadcastOutputChannel: vscode.OutputChannel;
let broadcastStatusItem: vscode.StatusBarItem;

let pollTickCount = 0;

async function pollBroadcast(silent = false): Promise<void> {
  pollTickCount++;
  const tick = pollTickCount;
  console.log(`[vai-broadcast] pollBroadcast tick=${tick} silent=${silent}`);

  // Skip health gate — just try the API call directly.
  // If the server is down, apiCall will throw and we handle it below.

  let workItem: BroadcastWorkItem | null;
  try {
    workItem = await apiCall('/api/broadcasts/poll-consume', 'POST') as BroadcastWorkItem | null;
    console.log(`[vai-broadcast] tick=${tick} poll result: ${workItem ? 'WORK ITEM' : 'no work'}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[vai-broadcast] tick=${tick} poll-consume error: ${msg}`);
    if (!silent) vscode.window.showErrorMessage(`VeggaAI runtime is not reachable: ${msg}`);
    broadcastOutputChannel.appendLine(`  [tick ${tick}] ✗ poll-consume error: ${msg}`);
    return;
  }

  // Update status bar on successful poll
  updateBroadcastStatus(true);

  if (!workItem) {
    // Log every 4th idle tick (once per minute) to prove the timer is alive
    if (tick % 4 === 0) {
      broadcastOutputChannel.appendLine(`  [tick ${tick}] ♻ Poll OK — no pending messages`);
    }
    if (!silent) vscode.window.showInformationMessage('No pending VeggaAI broadcast messages.');
    return;
  }

  broadcastOutputChannel.appendLine(`  [tick ${tick}] 📩 Work item received! deliveryId=${workItem.deliveryId}`);
  // Handle the broadcast notification in the background (don't block the poller)
  void handleBroadcastWorkItem(workItem);
}

/** Process a claimed broadcast — auto-ack, then generate LLM response and send it back. */
async function handleBroadcastWorkItem(workItem: BroadcastWorkItem): Promise<void> {
  const timestamp = new Date().toLocaleTimeString();

  // Log to output channel
  broadcastOutputChannel.appendLine(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  broadcastOutputChannel.appendLine(`[${timestamp}] 📩 Message from VeggaAI Desktop:`);
  broadcastOutputChannel.appendLine(workItem.content);
  if (workItem.meta?.targetChatApp) {
    broadcastOutputChannel.appendLine(`  🎯 Target chat app: ${workItem.meta.targetChatApp}`);
  }
  if (workItem.meta?.targetSessionId) {
    broadcastOutputChannel.appendLine(`  🎯 Target session: ${workItem.meta.targetSessionId}`);
  }
  broadcastOutputChannel.appendLine(``);

  // If targeting a specific chat app, try to route via its participant
  if (workItem.meta?.targetChatApp && workItem.meta.targetChatApp !== 'chat') {
    const participant = `@${workItem.meta.targetChatApp.replace(/^@/, '')}`;
    broadcastOutputChannel.appendLine(`  📤 Routing to chat participant: ${participant}`);
  }
  // Auto-respond immediately so the desktop knows we received it
  try {
    await apiCall(`/api/broadcasts/deliveries/${workItem.deliveryId}/respond`, 'POST', {
      responseContent: `[VS Code connected] Received your message.`,
      meta: { model: 'vscode-copilot', autoAck: true },
    });
    broadcastOutputChannel.appendLine(`  ✓ Auto-acknowledged to desktop`);
  } catch {
    broadcastOutputChannel.appendLine(`  ✗ Failed to acknowledge`);
  }

  // Update status bar
  updateBroadcastStatus(true, workItem.content.slice(0, 40));

  // Generate LLM response directly (no chat participant needed)
  try {
    // Use preferred model from broadcast meta, fall back to gpt-4o
    const preferredFamily = workItem.meta?.preferredModel || 'gpt-4o';
    broadcastOutputChannel.appendLine(`  🎯 Requested model family: "${preferredFamily}"`);

    // Try exact family match first
    let models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: preferredFamily });
    
    // If no exact match, try finding a model whose family or name contains the requested string
    if (!models.length) {
      broadcastOutputChannel.appendLine(`  ⚠ No exact match for family "${preferredFamily}", searching all models...`);
      const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      const needle = preferredFamily.toLowerCase();
      const match = allModels.find((m) => 
        m.family.toLowerCase().includes(needle) || 
        m.name.toLowerCase().includes(needle) ||
        m.id.toLowerCase().includes(needle)
      );
      if (match) {
        models = [match];
        broadcastOutputChannel.appendLine(`  ✓ Fuzzy matched: ${match.name} (family: ${match.family})`);
      }
    }
    
    // Fallback to gpt-4o
    if (!models.length && preferredFamily !== 'gpt-4o') {
      broadcastOutputChannel.appendLine(`  ⚠ No model found for "${preferredFamily}", falling back to gpt-4o`);
      models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    }
    
    // Last resort: any available copilot model
    if (!models.length) {
      models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    }
    const model = models[0];
    if (!model) {
      broadcastOutputChannel.appendLine(`  ✗ No Copilot model available for auto-response`);
      return;
    }

    broadcastOutputChannel.appendLine(`  ⏳ Generating response via ${model.name}...`);
    const messages = [vscode.LanguageModelChatMessage.User(workItem.content)];
    const chatResponse = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

    let responseText = '';
    for await (const fragment of chatResponse.text) {
      responseText += fragment;
    }

    if (responseText.trim()) {
      // Send the real LLM response back (overwrites auto-ack)
      await apiCall(`/api/broadcasts/deliveries/${workItem.deliveryId}/respond`, 'POST', {
        responseContent: responseText.trim(),
        meta: { model: model.name, family: model.family, id: model.id },
      });
      broadcastOutputChannel.appendLine(`  ✓ LLM response sent (${responseText.length} chars)`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    broadcastOutputChannel.appendLine(`  ✗ LLM error: ${errMsg}`);
  }
}

let reportingTimer: ReturnType<typeof setInterval> | null = null;

function startBroadcastPoller(): void {
  console.log(`[vai-broadcast] startBroadcastPoller called, existing timer=${broadcastPollTimer}`);
  if (broadcastPollTimer) {
    console.log('[vai-broadcast] Timer already exists, skipping');
    return;
  }
  broadcastPollTimer = setInterval(() => {
    try {
      console.log('[vai-broadcast] setInterval tick fired');
      void pollBroadcast(true);
    } catch (err) {
      console.error(`[vai-broadcast] Poller tick threw synchronously: ${err}`);
      broadcastOutputChannel.appendLine(`  ✗ Poller tick threw synchronously: ${err}`);
    }
  }, 15_000); // Poll every 15 seconds
  console.log(`[vai-broadcast] Timer created: ${broadcastPollTimer}`);
  // Also fire immediately so the first poll doesn't wait 15s
  void pollBroadcast(true);
  updateBroadcastStatus(true);
  broadcastOutputChannel.appendLine(`[${new Date().toLocaleTimeString()}] Broadcast poller started (interval=${broadcastPollTimer}) — listening for desktop messages`);

  // Report models after a short delay (VS Code may still be loading models at startup)
  startReporting();
}

/** Start reporting models and chat sessions to the runtime, even without auth. */
function startReporting(): void {
  if (reportingTimer) return;
  setTimeout(() => void reportAvailableModels(), 5_000);
  // Re-report periodically (models can change if user upgrades Copilot tier)
  reportingTimer = setInterval(() => void reportAvailableModels(), 120_000);
}

/** Enumerate all Copilot models available in this VS Code instance and report to server. */
async function reportAvailableModels(): Promise<void> {
  try {
    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    const modelList = allModels.map((m) => ({
      id: m.id,
      family: m.family,
      name: m.name,
      vendor: m.vendor,
    }));
    broadcastOutputChannel.appendLine(`[${new Date().toLocaleTimeString()}] Available Copilot models (${modelList.length}):`);
    for (const m of modelList) {
      broadcastOutputChannel.appendLine(`  • ${m.name} (family: ${m.family}, id: ${m.id})`);
    }
    if (modelList.length > 0) {
      await apiCall('/api/companion-clients/models', 'PATCH', { models: modelList });
      broadcastOutputChannel.appendLine(`  ✓ Reported ${modelList.length} models to server`);
    }

    // Also report available chat sessions
    await reportAvailableChatSessions();
  } catch (err) {
    broadcastOutputChannel.appendLine(`  ⚠ Failed to report models: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Report available chat sessions to the runtime so the desktop can list them. */
async function reportAvailableChatSessions(): Promise<void> {
  try {
    const sessions = getAvailableChatSessions();
    // Also enumerate chat participants (apps) available: default chat + any known extensions
    const chatApps: Array<{ id: string; label: string }> = [
      { id: 'chat', label: 'Chat (Copilot)' },
    ];

    // Check if @vai participant is available (it's always registered by us)
    chatApps.push({ id: '@vai', label: '@vai (VeggaAI)' });

    // Try detecting other chat extensions
    const extensions = vscode.extensions.all;
    for (const ext of extensions) {
      const id = ext.id.toLowerCase();
      if (id.includes('claude') || id.includes('anthropic')) {
        chatApps.push({ id: 'claude', label: 'Claude' });
      }
      if (id.includes('augment') && !id.includes('vai')) {
        chatApps.push({ id: 'augment', label: 'Augment' });
      }
      if (id.includes('continue') && !id.includes('vai')) {
        chatApps.push({ id: 'continue', label: 'Continue' });
      }
    }

    const chatInfo = { chatApps, sessions };
    await apiCall('/api/companion-clients/chat-info', 'PATCH', chatInfo);
    broadcastOutputChannel.appendLine(`  ✓ Reported ${chatApps.length} chat apps, ${sessions.length} sessions to server`);
  } catch (err) {
    broadcastOutputChannel.appendLine(`  ⚠ Failed to report chat info: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function stopBroadcastPoller(): void {
  if (broadcastPollTimer) {
    clearInterval(broadcastPollTimer);
    broadcastPollTimer = null;
  }
  if (reportingTimer) {
    clearInterval(reportingTimer);
    reportingTimer = null;
  }
  updateBroadcastStatus(false);
}

function updateBroadcastStatus(connected: boolean, lastMessage?: string): void {
  if (!broadcastStatusItem) return;
  if (connected) {
    broadcastStatusItem.text = lastMessage
      ? `$(broadcast) Vai Chat: "${lastMessage}…"`
      : '$(broadcast) Vai Chat: Connected';
    broadcastStatusItem.tooltip = 'VeggaAI Desktop broadcast channel — connected and polling.\nClick to view messages.';
    broadcastStatusItem.backgroundColor = undefined;
  } else if (reportingTimer) {
    broadcastStatusItem.text = '$(sync~spin) Vai Chat: Reporting';
    broadcastStatusItem.tooltip = 'VeggaAI — reporting models & sessions to runtime.\nSign in to enable full broadcast.';
    broadcastStatusItem.backgroundColor = undefined;
  } else {
    broadcastStatusItem.text = '$(circle-slash) Vai Chat: Offline';
    broadcastStatusItem.tooltip = 'VeggaAI Desktop broadcast channel — not connected.\nSign in to enable.';
    broadcastStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  broadcastStatusItem.show();
}

const uriHandler: vscode.UriHandler = {
  handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
    const params = new URLSearchParams(uri.query);
    const intent = params.get('intent');

    if (uri.path !== '/openSandbox' || !intent) {
      void vscode.window.showErrorMessage('Invalid VeggaAI handoff link');
      return;
    }

    void openSandboxProjectFromIntent(intent).catch((error) => {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Unable to open VeggaAI handoff');
    });
  },
};

/* ── .vai-session File Watcher ─────────────────────────────────── */

interface VaiSessionFile {
  id: string;
  title: string;
  agentName: string;
  modelId: string;
  createdAt: number;
}

/**
 * Read and parse the .vai-session file from workspace root.
 * Returns null if file doesn't exist or is invalid.
 */
function readSessionFile(): VaiSessionFile | null {
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (!wsFolder) return null;

  const filePath = path.join(wsFolder.uri.fsPath, '.vai-session');
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as VaiSessionFile;
    if (!data.id || !data.title) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Try to attach to a session defined in .vai-session.
 * Called on activation and whenever the file changes.
 */
async function tryAttachFromSessionFile(): Promise<boolean> {
  const sessionData = readSessionFile();
  if (!sessionData) return false;

  // Don't re-attach if already on this session
  const current = getActiveSession();
  if (current?.id === sessionData.id) return true;

  const ok = await attachToSession(sessionData.id, sessionData.title);
  if (ok) {
    pushEvent('state-change', `Attached to agent session: ${sessionData.title}`, {
      state: 'attached',
      agentName: sessionData.agentName,
      modelId: sessionData.modelId,
      source: '.vai-session',
    });
    console.log(`[vai] Attached to agent session via .vai-session: ${sessionData.title}`);
  }
  return ok;
}

/**
 * Set up a file system watcher for .vai-session.
 * When an agent creates/updates this file, we auto-attach to their session.
 * When the file is deleted (session ended), we can optionally create a fallback session.
 */
function watchSessionFile(context: vscode.ExtensionContext): void {
  // Watch for .vai-session in ANY workspace folder root
  sessionFileWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.workspace.workspaceFolders![0],
      '.vai-session',
    ),
  );

  sessionFileWatcher.onDidCreate(async () => {
    console.log('[vai] .vai-session created — attaching to agent session');
    await tryAttachFromSessionFile();
  });

  sessionFileWatcher.onDidChange(async () => {
    console.log('[vai] .vai-session updated — re-attaching to agent session');
    await tryAttachFromSessionFile();
  });

  sessionFileWatcher.onDidDelete(() => {
    console.log('[vai] .vai-session deleted — agent session ended');
    // Don't auto-create fallback. The agent ended their session.
    // User can manually start a new one if needed.
  });

  context.subscriptions.push(sessionFileWatcher);
}

/* ── Extension Activate ────────────────────────────────────────── */

export function activate(context: vscode.ExtensionContext) {
  console.log('[vai] VeggaAI Dev Logs v0.6.0 activating...');

  initPlatformAuth(context);
  void restorePlatformAuth();

  // ── Init Session Manager (for persistence) ──
  initSessionManager(context);

  // ── .vai-session watcher (unified sessions) ──
  if (vscode.workspace.workspaceFolders?.length) {
    watchSessionFile(context);
  }

  // ── Status Bar ──
  registerStatusBar(context);
  context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

  // ── Broadcast Channel ──
  console.log('[vai-broadcast] Creating broadcast output channel and status bar');
  broadcastOutputChannel = vscode.window.createOutputChannel('VeggaAI Broadcasts');
  context.subscriptions.push(broadcastOutputChannel);

  broadcastStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  broadcastStatusItem.command = 'vai.showBroadcasts';
  context.subscriptions.push(broadcastStatusItem);
  updateBroadcastStatus(false);

  // ── Chat Participant (@vai) ──
  registerChatParticipant(context);

  // ── Passive Capture Layers ──
  registerFileWatchers(context);
  registerTerminalWatchers(context);
  registerEditorWatchers(context);
  registerOutputWatchers(context);

  // ── Chat History Auto-Capture (VS Code Copilot chat) ──
  registerChatHistoryWatcher(context);

  // ── Claude Code Session Capture (this conversation) ──
  registerClaudeCodeWatcher(context);

  // ── Commands ──
  context.subscriptions.push(
    vscode.commands.registerCommand('vai.startSession', async () => {
      const title = await vscode.window.showInputBox({
        prompt: 'Session title',
        placeHolder: 'What are you working on?',
      });
      if (!title) return;

      try {
        const healthy = await ensureRuntimeRunning();
        if (!healthy) {
          vscode.window.showErrorMessage('VeggaAI runtime is not running. Start it manually with: pnpm --filter @vai/runtime dev');
          return;
        }
        await createSession(title);
        vscode.window.showInformationMessage(`Dev Logs session started: ${title}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to start session: ${err}`);
      }
    }),

    vscode.commands.registerCommand('vai.endSession', async () => {
      const session = getActiveSession();
      if (!session) {
        vscode.window.showInformationMessage('No active session');
        return;
      }
      // endSession() now shows confirmation dialog internally
      await endSession();
    }),

    vscode.commands.registerCommand('vai.sessionStatus', () => {
      const session = getActiveSession();
      if (!session) {
        vscode.window.showInformationMessage('No active session');
        return;
      }
      vscode.window.showInformationMessage(
        `Session: ${session.title}\nID: ${session.id}\nEvents: ${session.eventCount}\nBuffered: ${session.eventBuffer.length}`,
      );
    }),

    vscode.commands.registerCommand('vai.viewLogs', () => {
      openLogsPanel(context);
    }),

    vscode.commands.registerCommand('vai.exportMarkdown', () => {
      void exportSessionMarkdown();
    }),

    vscode.commands.registerCommand('vai.signIn', async () => {
      try {
        const healthy = await ensureRuntimeRunning();
        if (!healthy) {
          vscode.window.showErrorMessage('VeggaAI runtime is not running. Start it manually with: pnpm --filter @vai/runtime dev');
          return;
        }

        await signInToPlatform();
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'VeggaAI sign-in failed');
      }
    }),

    vscode.commands.registerCommand('vai.signOut', async () => {
      await signOutFromPlatform();
      vscode.window.showInformationMessage('VeggaAI platform session cleared from VS Code');
    }),

    vscode.commands.registerCommand('vai.authStatus', () => {
      const auth = getPlatformAuthState();
      if (auth.user) {
        vscode.window.showInformationMessage(`VeggaAI platform: ${auth.user.email}`);
        return;
      }

      vscode.window.showInformationMessage(auth.error ?? 'VeggaAI platform: signed out');
    }),

    vscode.commands.registerCommand('vai.openSandboxProject', async () => {
      try {
        await openSandboxProject();
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Unable to open VeggaAI sandbox project');
      }
    }),

    vscode.commands.registerCommand('vai.consumeAuditWork', async () => {
      try {
        await runAuditWork();
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Unable to process VeggaAI audit work');
      }
    }),

    vscode.commands.registerCommand('vai.pollBroadcast', async () => {
      try {
        await pollBroadcast(false);
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Unable to poll VeggaAI broadcasts');
      }
    }),

    vscode.commands.registerCommand('vai.showBroadcasts', () => {
      broadcastOutputChannel.show();
    }),
  );

  // ── Broadcast poller: keep running regardless of auth state ──
  // Auth state changes may trigger re-reporting but should not stop polling,
  // since the runtime supports anonymous poll-consume via installation key.
  context.subscriptions.push(
    onDidChangePlatformAuthState((authState) => {
      if (authState.status === 'authenticated') {
        // Ensure poller is running (may have been stopped by previous logic)
        startBroadcastPoller();
      }
      // Never stop the poller on sign-out — anonymous polling still works
    }),
  );

  // ── Re-report models whenever VS Code discovers new ones ──
  context.subscriptions.push(
    vscode.lm.onDidChangeChatModels(() => {
      if (broadcastPollTimer || reportingTimer) {
        broadcastOutputChannel.appendLine(`[${new Date().toLocaleTimeString()}] Chat models changed — re-reporting...`);
        void reportAvailableModels();
      }
    }),
  );

  // ── Auto-start: Attach to agent session → Restore → Create new ──
  const autoStart = vscode.workspace.getConfiguration('vai').get('autoStartSession', true);
  if (autoStart) {
    setTimeout(async () => {
      // First try to ensure runtime is running
      const healthy = await ensureRuntimeRunning();
      if (!healthy) {
        console.log('[vai] Runtime server not reachable — auto-session skipped');
        return;
      }

      // 1) Priority: Attach to an agent session via .vai-session
      const attached = await tryAttachFromSessionFile();
      if (attached) {
        console.log('[vai] Attached to agent session from .vai-session');
        return;
      }

      // 2) Try to restore a persisted session from previous VS Code window
      const restoredId = await restoreSession();
      if (restoredId) {
        pushEvent('state-change', 'Session restored after VS Code reload', {
          state: 'restored',
          version: '0.6.0',
        });
        console.log(`[vai] Restored session: ${restoredId}`);
        return;
      }

      // 3) No agent session, no restore — create a fresh workspace session
      try {
        const workspaceName = vscode.workspace.name || 'VS Code Session';
        await createSession(workspaceName);
        pushEvent('state-change', 'Extension activated — auto-capture started', {
          state: 'activated',
          version: '0.6.0',
        });
        console.log('[vai] Auto-session started');
      } catch (err) {
        console.error('[vai] Auto-session failed:', err);
      }
    }, 2000);
  }

  // Start broadcast poller if already authenticated, otherwise just start reporting
  // Always start the broadcast poller — the runtime supports anonymous poll-consume
  // via x-vai-installation-key header, so auth is not required for message delivery.
  startBroadcastPoller();

  console.log('[vai] VeggaAI Dev Logs v0.6.0 activated');
}

export function deactivate() {
  stopBroadcastPoller();
  const session = getActiveSession();
  if (session) {
    // DON'T end the session — just flush and disconnect.
    // Session persists in workspaceState and will be restored on next activation.
    pushEvent('state-change', 'Extension deactivating — session preserved for next reload', {
      state: 'deactivating',
    });

    // Synchronous-ish: flush what we can
    // Note: deactivate should be fast, so we just stop the timer.
    if (session.flushTimer) {
      clearInterval(session.flushTimer);
    }
  }
  disposeSession();
}
