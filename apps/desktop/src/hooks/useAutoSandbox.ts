/**
 * useAutoSandbox — watches for completed AI responses
 * and automatically extracts file blocks or compact sandbox actions,
 * then writes them to the sandbox.
 *
 * Flow:
 * 1. Detects newly completed assistant messages
 * 2. Checks if the message contains auto-applicable sandbox output
 * 3. Parses the last assistant message for code blocks with title="path"
 * 4. If files found:
 *    a. If no sandbox project exists, creates one (using project name from package.json or fallback)
 *    b. Writes all extracted files to the sandbox
 *    c. If package.json changed, reinstalls deps + restarts dev server
 *    d. Verifies the dev server responds — if not, reports failure back to Vai for self-correction
 * 5. On verification failure, auto-sends a repair prompt with the error context
 *    so Vai can iterate without user intervention (up to MAX_REPAIR_ATTEMPTS)
 */

import { useEffect, useRef, useCallback } from 'react';
import { evidenceTierFromProof, type FailureClass, type ProofFlags } from '@vai/core/browser';
import { useChatStore } from '../stores/chatStore.js';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { useLayoutStore, type ChatMode } from '../stores/layoutStore.js';
import { API_BASE } from '../lib/api.js';
import { getActiveCapture, type SessionCapture } from '../lib/sessionCapture.js';
import {
  extractFilesFromMarkdown,
  hasPackageJson,
  extractProjectName,
  type ExtractedFile,
} from '../lib/file-extractor.js';
import { selectNextAutoSandboxMessage } from '../lib/auto-sandbox-message-selection.js';
import { extractDeployActions, extractTemplateActions } from '../lib/sandbox-actions.js';
import { resolveAutoSandboxIntent } from '../lib/auto-sandbox-intent.js';
import {
  buildGroundedExecutionRepairPlan,
  shouldTriggerGroundedExecutionRepair,
} from '../lib/grounded-build-execution.js';
import { extractBrowserRuntimeErrors } from '../lib/sandbox-runtime-validation.js';
import { serializeProjectUpdateArtifact, type ProjectUpdateArtifact } from '../lib/project-artifact.js';
import { toast } from 'sonner';

/** Max number of automatic repair attempts before giving up */
const MAX_REPAIR_ATTEMPTS = 2;

/** How long to wait for the dev server to respond (ms) */
const VERIFY_TIMEOUT_MS = 20_000;

function formatChangedFiles(files: ExtractedFile[], limit = 6): string[] {
  const visible = files.slice(0, limit).map((file) => `- ${file.path}`);
  const remaining = files.length - visible.length;
  if (remaining > 0) {
    visible.push(`- +${remaining} more file${remaining === 1 ? '' : 's'}`);
  }
  return visible;
}

function buildProjectUpdateMessage(summary: string, details: string[], files: ExtractedFile[] = [], artifact?: ProjectUpdateArtifact): string {
  const lines = [`Project update: ${summary}`];

  if (artifact) {
    lines.push('', serializeProjectUpdateArtifact(artifact));
  }

  if (details.length > 0) {
    lines.push('', ...details.map((detail) => `- ${detail}`));
  }

  if (files.length > 0) {
    lines.push('', 'Files changed:', ...formatChangedFiles(files));
  }

  return lines.join('\n');
}

function classifyFailure(buildError?: string, browserRuntimeErrors?: string[]): FailureClass | null {
  const browserText = browserRuntimeErrors?.join('\n').toLowerCase() ?? '';
  const buildText = buildError?.toLowerCase() ?? '';

  if (browserText.includes('hydration')) return 'hydration';
  if (browserRuntimeErrors && browserRuntimeErrors.length > 0) return 'browser_console';
  if (/\btype\b|\bts\d+\b|typescript/.test(buildText)) return 'typecheck';
  if (/install|pnpm|npm|module not found|cannot find package|dependency/.test(buildText)) return 'dependency_install';
  if (/env|environment variable|missing configuration/.test(buildText)) return 'config_env';
  if (/runtime|preview|server|respond/.test(buildText)) return 'runtime';
  if (/syntax|unexpected token|parse error/.test(buildText)) return 'syntax_build';
  return buildError ? 'unknown' : null;
}

function buildUpdateArtifact(input: {
  projectName?: string | null;
  fileCount: number;
  files: ExtractedFile[];
  port?: number | null;
  previewVerified?: boolean;
  previewReachable?: boolean;
  reinstalledDependencies?: boolean;
  verificationItems: string[];
  proofFlags: ProofFlags;
  recoveryLabel?: string;
  failureClass?: FailureClass | null;
}): ProjectUpdateArtifact {
  const evidenceTier = evidenceTierFromProof(input.proofFlags);
  const status = input.failureClass && !input.previewReachable
    ? 'failed'
    : input.previewVerified
      ? 'live'
      : 'updated';
  return {
    kind: 'update',
    title: input.projectName || 'Current project',
    status,
    tone: status === 'failed'
      ? 'amber'
      : evidenceTier === 'high'
        ? 'emerald'
        : evidenceTier === 'medium'
          ? 'blue'
          : 'violet',
    badge: status === 'failed'
      ? 'Preview failed'
      : input.previewVerified
        ? 'Verified update'
        : input.previewReachable
          ? 'Preview reachable'
          : 'Project update',
    port: input.port ?? undefined,
    liveUrl: input.port ? `http://localhost:${input.port}` : undefined,
    fileCount: input.fileCount,
    changedFiles: input.files.map((file) => file.path),
    evidenceTier,
    verificationItems: input.verificationItems,
    recoveryLabel: input.recoveryLabel,
    packageChanged: input.reinstalledDependencies,
    failureClass: input.failureClass ?? null,
    nextPrompts: status === 'failed'
      ? ['Fix the preview crash', 'Diagnose why the app did not load']
      : input.port
      ? ['Polish the UI and spacing', 'Review the main flow for edge cases']
      : ['Add the next feature slice', 'Tighten this implementation with targeted edits'],
  };
}

/** Poll dev server until it responds or times out */
async function waitForDevServer(port: number, timeoutMs = VERIFY_TIMEOUT_MS): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(`http://localhost:${port}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok || res.status < 500) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return false;
}

async function waitForBrowserRuntimeErrors(logStartIndex: number, timeoutMs = 4500): Promise<string[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const freshLogs = useSandboxStore.getState().logs.slice(logStartIndex);
    const browserErrors = extractBrowserRuntimeErrors(freshLogs);
    if (browserErrors.length > 0) {
      return browserErrors;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return [];
}

async function waitForPreviewIframeLoad(
  port: number,
  baselineLoadCount: number,
  timeoutMs = 6000,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = useSandboxStore.getState();
    if (
      state.devPort === port
      && state.lastPreviewPort === port
      && state.previewReady
      && state.previewLoadCount > baselineLoadCount
    ) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

interface SandboxStatusResponse {
  status?: string;
  devStderr?: string[];
}

/**
 * Ask the sandbox API for current project status + recent stderr.
 * Returns { alive, stderr } — alive=false if the process already died,
 * which lets the repair path skip the full HTTP poll timeout.
 */
async function fetchSandboxStatus(projectId: string, apiBase: string): Promise<{ alive: boolean; stderr: string[] }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${apiBase}/api/sandbox/${projectId}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { alive: true, stderr: [] };
    const data = await res.json() as SandboxStatusResponse;
    return {
      alive: data.status !== 'failed',
      stderr: data.devStderr ?? [],
    };
  } catch {
    return { alive: true, stderr: [] }; // network error → assume alive, let HTTP poll decide
  }
}

export function useAutoSandbox() {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const messages = useChatStore((s) => s.messages);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setConversationSandbox = useChatStore((s) => s.setConversationSandbox);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const injectProjectUpdate = useChatStore((s) => s.injectProjectUpdate);
  const mode = useLayoutStore((s) => s.mode);
  const setBuildStatus = useLayoutStore((s) => s.setBuildStatus);
  const expandBuilder = useLayoutStore((s) => s.expandBuilder);

  const _projectId = useSandboxStore((s) => s.projectId);
  const _status = useSandboxStore((s) => s.status);
  const createProject = useSandboxStore((s) => s.createProject);
  const attachProject = useSandboxStore((s) => s.attachProject);
  const writeFiles = useSandboxStore((s) => s.writeFiles);
  const installDeps = useSandboxStore((s) => s.installDeps);
  const scaffoldFromTemplate = useSandboxStore((s) => s.scaffoldFromTemplate);
  const deployStack = useSandboxStore((s) => s.deployStack);
  const startDev = useSandboxStore((s) => s.startDev);
  const stopDev = useSandboxStore((s) => s.stopDev);
  const destroyProject = useSandboxStore((s) => s.destroyProject);
  const activeConversation = activeConversationId
    ? conversations.find((conversation) => conversation.id === activeConversationId) ?? null
    : null;
  const effectiveMode = activeConversation?.mode ?? mode;

  /**
   * Serial work queue — ensures processFiles/processTemplate/processDeploy never overlap.
   * Each call enqueues a thunk; the queue drains one-at-a-time.
   */
  const queueRef = useRef<Array<() => Promise<void>>>([]);
  const queueRunningRef = useRef(false);

  const enqueue = useCallback((thunk: () => Promise<void>) => {
    queueRef.current.push(thunk);
    if (!queueRunningRef.current) {
      queueRunningRef.current = true;
      const drain = async () => {
        while (queueRef.current.length > 0) {
          const next = queueRef.current.shift()!;
          try { await next(); } catch { /* individual thunks handle their own errors */ }
        }
        queueRunningRef.current = false;
      };
      void drain();
    }
  }, []);

  const processedMessageIdsRef = useRef<Set<string>>(new Set());
  /** Count consecutive repair attempts for the current response chain */
  const repairAttemptsRef = useRef(0);

  const withCapture = useCallback((callback: (capture: SessionCapture) => void) => {
    const capture = getActiveCapture();
    if (capture) {
      callback(capture);
    }
  }, []);

  const recordProjectUpdateArtifact = useCallback((content: string) => {
    withCapture((capture) => {
      capture.artifact('Persisted project update in the conversation', {
        artifactType: 'project-update',
        label: 'Project update',
        value: content.slice(0, 2000),
      });
    });
  }, [withCapture]);

  const triggerMissingActionRepair = useCallback((input: {
    groundedBrief: NonNullable<typeof messages[number]['groundedBuildBrief']>;
    sandboxIntent: ReturnType<typeof resolveAutoSandboxIntent>;
    hasActiveProject: boolean;
    userPrompt: string;
  }): false => {
    const { groundedBrief, sandboxIntent, hasActiveProject, userPrompt } = input;

    if (repairAttemptsRef.current >= MAX_REPAIR_ATTEMPTS) {
      withCapture((capture) => {
        capture.recovery('Automatic execution recovery exhausted without runnable output', {
          strategy: 'grounded-brief-execution',
          status: 'failed',
          attempt: repairAttemptsRef.current,
          maxAttempts: MAX_REPAIR_ATTEMPTS,
          reason: groundedBrief.nextStep,
        });
        capture.artifact('Captured grounded build brief after execution recovery exhausted', {
          artifactType: 'grounded-brief',
          label: groundedBrief.focusLabel,
          value: JSON.stringify(groundedBrief).slice(0, 2000),
        });
      });
      setBuildStatus({ step: 'failed', message: 'Grounded plan exists, but Vai still did not emit runnable output.' });
      toast.error('Vai did not turn the grounded plan into runnable output');
      repairAttemptsRef.current = 0;
      return false;
    }

    repairAttemptsRef.current += 1;
    const attempt = repairAttemptsRef.current;
    const plan = buildGroundedExecutionRepairPlan({
      groundedBrief,
      sandboxIntent,
      hasActiveProject,
      attempt,
      maxAttempts: MAX_REPAIR_ATTEMPTS,
      userPrompt,
    });

    setBuildStatus({ step: 'fixing', message: plan.buildStatusMessage });
    toast.warning(plan.toastMessage);

    withCapture((capture) => {
      capture.recovery(`Triggered execution recovery ${attempt}/${MAX_REPAIR_ATTEMPTS}`, {
        strategy: 'grounded-brief-execution',
        status: 'triggered',
        attempt,
        maxAttempts: MAX_REPAIR_ATTEMPTS,
        reason: groundedBrief.nextStep,
      });
      capture.checkpoint('Queued a grounded execution repair prompt back into the builder loop', {
        checkpoint: 'execution-recovery-requested',
        status: 'completed',
        detail: groundedBrief.focusLabel,
      });
      capture.artifact('Captured grounded build brief for execution recovery', {
        artifactType: 'grounded-brief',
        label: groundedBrief.focusLabel,
        value: JSON.stringify(groundedBrief).slice(0, 2000),
      });
    });

    sendMessage(plan.repairPrompt, undefined, plan.systemPrompt, { isAutoRepair: true, repairAttempt: attempt });
    return false;
  }, [messages, sendMessage, setBuildStatus, withCapture]);

  /**
   * Inject a repair prompt into the chat. Returns false (the server is not healthy).
   * Shared by both the HTTP-timeout path and the process-died fast-path.
   */
  const triggerRepair = useCallback((
    port: number,
    filesApplied: ExtractedFile[],
    buildError?: string,
    reason?: string,
    devStderr?: string[],
    browserRuntimeErrors?: string[],
  ): false => {
    const filePaths = filesApplied.map((file) => file.path);

    if (repairAttemptsRef.current >= MAX_REPAIR_ATTEMPTS) {
      withCapture((capture) => {
        capture.recovery('Automatic recovery exhausted without a healthy preview', {
          strategy: 'self-repair prompt',
          status: 'failed',
          attempt: repairAttemptsRef.current,
          maxAttempts: MAX_REPAIR_ATTEMPTS,
          reason: reason ?? buildError ?? 'preview verification failed',
          port,
          files: filePaths,
        });
        if (devStderr && devStderr.length > 0) {
          capture.artifact('Captured dev server stderr from the failed recovery loop', {
            artifactType: 'stderr',
            label: 'Dev server stderr',
            value: devStderr.join('\n').slice(0, 2000),
            itemCount: devStderr.length,
          });
        }
        if (browserRuntimeErrors && browserRuntimeErrors.length > 0) {
          capture.artifact('Captured browser runtime errors from the failed recovery loop', {
            artifactType: 'runtime-errors',
            label: 'Browser runtime errors',
            value: browserRuntimeErrors.join('\n').slice(0, 2000),
            itemCount: browserRuntimeErrors.length,
          });
        }
      });
      setBuildStatus({ step: 'failed', message: `Dev server not responding after ${MAX_REPAIR_ATTEMPTS} repair attempts` });
      toast.error('Could not automatically fix the build — check the logs');
      repairAttemptsRef.current = 0;
      return false;
    }

    repairAttemptsRef.current++;
    const attempt = repairAttemptsRef.current;

    const fileList = filesApplied.map((f) => `- ${f.path}`).join('\n');
    const errorDetail = buildError ? `\n\nBuild/install error:\n\`\`\`\n${buildError.slice(0, 800)}\n\`\`\`` : '';
    const reasonLine = reason ? `\nFailure reason: ${reason}` : '';
    const stderrDetail = devStderr && devStderr.length > 0
      ? `\n\nDev server stderr (last ${devStderr.length} lines):\n\`\`\`\n${devStderr.join('\n').slice(0, 1200)}\n\`\`\``
      : '';
    const browserDetail = browserRuntimeErrors && browserRuntimeErrors.length > 0
      ? `\n\nBrowser runtime errors detected in the preview:\n\`\`\`\n${browserRuntimeErrors.join('\n').slice(0, 1200)}\n\`\`\``
      : '';
    const repairPrompt = `The dev server on port ${port} did not respond after applying your last changes (repair attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}).${reasonLine}

Files that were applied:
${fileList}${errorDetail}${stderrDetail}${browserDetail}

Please diagnose the issue and provide corrected file(s). Output only the files that need to change, using title="path/to/file" on each code block.`;

    const systemContext = `SYSTEM: This is an automatic repair request triggered by the build verification system. The previous response caused a sandbox failure. Respond with corrected files only — no preamble, no explanation beyond a one-line root cause. Use title="path" attributes on all file blocks.`;

    setBuildStatus({ step: 'fixing', message: `Repair ${attempt}/${MAX_REPAIR_ATTEMPTS}: Vai is self-correcting...` });
    toast.warning(`Repair ${attempt}/${MAX_REPAIR_ATTEMPTS}: Vai is self-correcting...`);

    withCapture((capture) => {
      capture.recovery(`Triggered automatic recovery ${attempt}/${MAX_REPAIR_ATTEMPTS}`, {
        strategy: 'self-repair prompt',
        status: 'triggered',
        attempt,
        maxAttempts: MAX_REPAIR_ATTEMPTS,
        reason: reason ?? buildError ?? 'preview verification failed',
        port,
        files: filePaths,
      });
      capture.checkpoint('Queued a repair prompt back into the builder loop', {
        checkpoint: 'recovery-requested',
        status: 'completed',
        detail: reason,
        files: filePaths,
        port,
      });
      if (buildError) {
        capture.artifact('Captured build or install error for automatic recovery', {
          artifactType: 'build-error',
          label: 'Build or install error',
          value: buildError.slice(0, 2000),
        });
      }
      if (devStderr && devStderr.length > 0) {
        capture.artifact('Captured dev server stderr for automatic recovery', {
          artifactType: 'stderr',
          label: 'Dev server stderr',
          value: devStderr.join('\n').slice(0, 2000),
          itemCount: devStderr.length,
        });
      }
      if (browserRuntimeErrors && browserRuntimeErrors.length > 0) {
        capture.artifact('Captured browser runtime errors for automatic recovery', {
          artifactType: 'runtime-errors',
          label: 'Browser runtime errors',
          value: browserRuntimeErrors.join('\n').slice(0, 2000),
          itemCount: browserRuntimeErrors.length,
        });
      }
    });

    sendMessage(repairPrompt, undefined, systemContext, { isAutoRepair: true, repairAttempt: attempt });
    return false;
  }, [setBuildStatus, sendMessage, withCapture]);

  /**
   * Verify the dev server is up and, if not, inject a repair prompt back into the chat.
   * Returns true if the server is healthy, false otherwise.
   */
  const verifyAndRepairIfNeeded = useCallback(async (
    port: number,
    filesApplied: ExtractedFile[],
    buildError?: string,
    logStartIndex = useSandboxStore.getState().logs.length,
    previewLoadBaseline = useSandboxStore.getState().previewLoadCount,
  ): Promise<boolean> => {
    const filePaths = filesApplied.map((file) => file.path);

    withCapture((capture) => {
      capture.checkpoint(`Starting preview verification on port ${port}`, {
        checkpoint: 'preview-verification',
        status: 'started',
        files: filePaths,
        port,
      });
    });

    setBuildStatus({ step: 'building', message: 'Verifying dev server...' });

    // Fast-path: if the sandbox process is already dead, skip the full HTTP poll.
    const projectId = useSandboxStore.getState().projectId;
    let capturedStderr: string[] = [];
    if (projectId) {
      const { alive, stderr } = await fetchSandboxStatus(projectId, API_BASE);
      capturedStderr = stderr;
      if (!alive) {
        withCapture((capture) => {
          capture.verification('Preview process exited before it could be verified', {
            target: 'dev-server',
            status: 'failed',
            port,
            timeoutMs: VERIFY_TIMEOUT_MS,
            evidence: capturedStderr.slice(-5),
          });
          if (capturedStderr.length > 0) {
            capture.artifact('Captured dev server stderr from the crashed preview process', {
              artifactType: 'stderr',
              label: 'Dev server stderr',
              value: capturedStderr.join('\n').slice(0, 2000),
              itemCount: capturedStderr.length,
            });
          }
        });
        setBuildStatus({ step: 'fixing', message: 'Dev process exited — initiating repair...' });
        return triggerRepair(port, filesApplied, buildError, 'dev process exited unexpectedly', capturedStderr);
      }
    }

    const healthy = await waitForDevServer(port);

    if (healthy) {
      const browserRuntimeErrors = await waitForBrowserRuntimeErrors(logStartIndex);
      if (browserRuntimeErrors.length > 0) {
        withCapture((capture) => {
          capture.verification('Preview loaded but browser runtime validation failed', {
            target: 'preview-runtime',
            status: 'failed',
            port,
            evidence: browserRuntimeErrors.slice(0, 5),
          });
          capture.artifact('Captured browser runtime errors from the preview', {
            artifactType: 'runtime-errors',
            label: 'Browser runtime errors',
            value: browserRuntimeErrors.join('\n').slice(0, 2000),
            itemCount: browserRuntimeErrors.length,
          });
        });
        setBuildStatus({ step: 'fixing', message: 'Preview hit a browser runtime error — initiating repair...' });
        return triggerRepair(port, filesApplied, buildError, 'preview runtime error after page load', capturedStderr, browserRuntimeErrors);
      }

      const previewLoaded = await waitForPreviewIframeLoad(port, previewLoadBaseline);
      if (!previewLoaded) {
        withCapture((capture) => {
          capture.verification('Preview server responded but the app shell never loaded the iframe', {
            target: 'preview-runtime',
            status: 'failed',
            port,
            timeoutMs: 6000,
          });
        });
        setBuildStatus({ step: 'fixing', message: 'Preview stayed blank in the app shell — initiating repair...' });
        return triggerRepair(port, filesApplied, buildError, 'preview never loaded in the app shell', capturedStderr);
      }

      withCapture((capture) => {
        capture.verification(`Preview verified on port ${port}`, {
          target: 'preview-runtime',
          status: 'passed',
          port,
          timeoutMs: VERIFY_TIMEOUT_MS,
        });
        capture.checkpoint(`Preview is ready on port ${port}`, {
          checkpoint: 'preview-ready',
          status: 'completed',
          files: filePaths,
          port,
        });
        capture.artifact(`Preview URL http://localhost:${port}`, {
          artifactType: 'preview-url',
          label: 'Preview URL',
          value: `http://localhost:${port}`,
        });
        if (repairAttemptsRef.current > 0) {
          capture.recovery(`Automatic recovery succeeded after ${repairAttemptsRef.current} attempt${repairAttemptsRef.current === 1 ? '' : 's'}`, {
            strategy: 'self-repair prompt',
            status: 'succeeded',
            attempt: repairAttemptsRef.current,
            maxAttempts: MAX_REPAIR_ATTEMPTS,
            port,
            files: filePaths,
          });
        }
      });

      repairAttemptsRef.current = 0;
      setBuildStatus({ step: 'ready', message: `Running on port ${port}` });
      toast.success(`Dev server verified on port ${port}`);
      return true;
    }

    // Server timed out — fetch stderr now in case it filled in during the poll
    if (projectId && capturedStderr.length === 0) {
      const { stderr } = await fetchSandboxStatus(projectId, API_BASE);
      capturedStderr = stderr;
    }

    withCapture((capture) => {
      capture.verification(`Preview did not respond on port ${port}`, {
        target: 'dev-server',
        status: 'failed',
        port,
        timeoutMs: VERIFY_TIMEOUT_MS,
        evidence: capturedStderr.slice(-5),
      });
      if (capturedStderr.length > 0) {
        capture.artifact('Captured dev server stderr after preview verification timed out', {
          artifactType: 'stderr',
          label: 'Dev server stderr',
          value: capturedStderr.join('\n').slice(0, 2000),
          itemCount: capturedStderr.length,
        });
      }
    });

    return triggerRepair(port, filesApplied, buildError, undefined, capturedStderr);
  }, [setBuildStatus, triggerRepair, withCapture]);

  const processFiles = useCallback(async (files: ExtractedFile[], forceFreshProject = false) => {
    let installError: string | undefined;
    let linkedSandboxUnavailable = false;
    let createdSandboxName: string | null = null;
    let reinstalledDependencies = false;
    let previewSummary: string | null = null;
    let previewVerified = false;
    let previewReachable = false;
    let recoveryLabel: string | undefined;
    let failureClass: FailureClass | null = null;
    const verificationItems: string[] = [];
    const proofFlags: { buildOk?: boolean; typecheckOk?: boolean; screenshotOk?: boolean; testsOk?: boolean; reasoningOnly?: boolean } = {};
    const filePaths = files.map((file) => file.path);
    const initialPreviewLoadCount = useSandboxStore.getState().previewLoadCount;

    try {
      expandBuilder();
      const conversationId = activeConversationId;
      const liveConversation = conversationId
        ? useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId) ?? null
        : null;
      const linkedSandboxId = liveConversation?.sandboxProjectId ?? activeConversation?.sandboxProjectId ?? null;

      withCapture((capture) => {
        capture.checkpoint(`Applying ${files.length} file${files.length === 1 ? '' : 's'} to the sandbox`, {
          checkpoint: forceFreshProject ? 'sandbox-apply-reset' : 'sandbox-apply',
          status: 'started',
          conversationId: conversationId ?? undefined,
          files: filePaths,
        });
      });

      if (forceFreshProject && useSandboxStore.getState().projectId) {
        await destroyProject();
        withCapture((capture) => {
          capture.checkpoint('Destroyed the existing sandbox before applying a fresh result', {
            checkpoint: 'sandbox-reset',
            status: 'completed',
            conversationId: conversationId ?? undefined,
          });
        });
      }

      const sandboxState = useSandboxStore.getState();
      let pid = conversationId
        ? linkedSandboxId
        : sandboxState.projectId;
      const shouldAttachLinkedSandbox = Boolean(linkedSandboxId)
        && sandboxState.projectId !== linkedSandboxId;

      if (shouldAttachLinkedSandbox && linkedSandboxId) {
        try {
          await attachProject(linkedSandboxId);
          pid = useSandboxStore.getState().projectId ?? linkedSandboxId;
        } catch (error) {
          linkedSandboxUnavailable = true;
          console.warn('[auto-sandbox] linked-sandbox-unavailable', {
            conversationId,
            linkedSandboxId,
            error: error instanceof Error ? error.message : String(error),
          });

          withCapture((capture) => {
            capture.verification('Linked sandbox could not be reattached', {
              target: 'sandbox-link',
              status: 'failed',
              evidence: [error instanceof Error ? error.message : String(error)],
            });
            capture.artifact('Cleared a stale sandbox link before creating a fresh sandbox', {
              artifactType: 'sandbox-link',
              label: 'Stale sandbox link',
              value: linkedSandboxId ?? undefined,
            });
          });

          if (conversationId) {
            try {
              await setConversationSandbox(conversationId, null);
            } catch (clearError) {
              console.warn('[auto-sandbox] failed-to-clear-stale-sandbox-link', {
                conversationId,
                linkedSandboxId,
                error: clearError instanceof Error ? clearError.message : String(clearError),
              });
            }
          }
        }
      }

      // If no project exists yet, create one
      if (!pid) {
        const name = extractProjectName(files) || `vai-project-${Date.now()}`;
        createdSandboxName = name;
        setBuildStatus({
          step: 'generating',
          message: linkedSandboxUnavailable
            ? 'Linked sandbox unavailable. Creating a fresh sandbox...'
            : 'Creating sandbox...',
        });
        pid = await createProject(name);
        toast.info(
          linkedSandboxUnavailable
            ? `Linked sandbox was unavailable. Created a fresh sandbox: ${name}`
            : `Sandbox created: ${name}`,
        );
        withCapture((capture) => {
          capture.checkpoint(`Created sandbox ${name}`, {
            checkpoint: 'sandbox-created',
            status: 'completed',
            sandboxProjectId: pid ?? undefined,
            conversationId: conversationId ?? undefined,
          });
          if (pid) {
            capture.artifact(`Linked sandbox project ${pid}`, {
              artifactType: 'sandbox-link',
              label: 'Sandbox project',
              value: pid,
            });
          }
        });
      }

      if (conversationId && pid) {
        await setConversationSandbox(conversationId, pid);
      }

      // Write files
      setBuildStatus({ step: 'writing', message: `Writing ${files.length} file${files.length > 1 ? 's' : ''}...` });
      await writeFiles(files.map((f) => ({ path: f.path, content: f.content })));
      toast.success(`${files.length} file${files.length > 1 ? 's' : ''} written to sandbox`);
      withCapture((capture) => {
        capture.checkpoint(`Applied ${files.length} file${files.length === 1 ? '' : 's'} to the sandbox`, {
          checkpoint: 'files-applied',
          status: 'completed',
          sandboxProjectId: pid ?? undefined,
          conversationId: conversationId ?? undefined,
          files: filePaths,
        });
      });

      // If package.json is among the files, reinstall + restart
      if (hasPackageJson(files)) {
        reinstalledDependencies = true;
        // Stop running dev server if any
        const currentState = useSandboxStore.getState();
        if (currentState.devPort) {
          await stopDev();
        }

        setBuildStatus({ step: 'installing', message: 'Installing dependencies...' });
        withCapture((capture) => {
          capture.checkpoint('Installing dependencies after package changes', {
            checkpoint: 'dependency-install',
            status: 'started',
            sandboxProjectId: pid ?? undefined,
            files: filePaths,
          });
        });
        const ok = await installDeps();
        if (!ok) {
          installError = useSandboxStore.getState().error ?? 'Install failed';
          const installFailure = installError;
          setBuildStatus({ step: 'failed', message: 'Install failed' });
          toast.error('Dependency install failed');
          withCapture((capture) => {
            capture.checkpoint('Dependency installation failed', {
              checkpoint: 'dependency-install',
              status: 'failed',
              detail: installFailure,
              sandboxProjectId: pid ?? undefined,
              files: filePaths,
            });
            capture.artifact('Captured dependency install error for automatic repair', {
              artifactType: 'build-error',
              label: 'Dependency install error',
              value: installFailure.slice(0, 2000),
            });
          });
          // Still try to verify + repair
        } else {
          withCapture((capture) => {
            capture.checkpoint('Dependencies installed successfully', {
              checkpoint: 'dependency-install',
              status: 'completed',
              sandboxProjectId: pid ?? undefined,
              files: filePaths,
            });
          });
        }

        setBuildStatus({ step: 'building', message: 'Starting dev server...' });
        withCapture((capture) => {
          capture.checkpoint('Starting the preview after applying package changes', {
            checkpoint: 'preview-start',
            status: 'started',
            sandboxProjectId: pid ?? undefined,
            files: filePaths,
          });
        });
        const logStartIndex = useSandboxStore.getState().logs.length;
        const port = await startDev();
        if (port) {
          const verified = await verifyAndRepairIfNeeded(port, files, installError, logStartIndex, initialPreviewLoadCount);
          if (verified) {
            previewVerified = true;
            previewReachable = true;
            previewSummary = `Restarted the preview and verified it on port ${port}.`;
          } else {
            return;
          }
        } else {
          setBuildStatus({ step: 'failed', message: 'Failed to start dev server' });
          // Fetch stderr to give Vai the crash output
          const pid = useSandboxStore.getState().projectId;
          const stderrLines = pid ? (await fetchSandboxStatus(pid, API_BASE)).stderr : [];
          withCapture((capture) => {
            capture.checkpoint('Failed to start the preview process', {
              checkpoint: 'preview-start',
              status: 'failed',
              sandboxProjectId: pid ?? undefined,
              files: filePaths,
            });
            if (stderrLines.length > 0) {
              capture.artifact('Captured preview startup stderr', {
                artifactType: 'stderr',
                label: 'Preview startup stderr',
                value: stderrLines.join('\n').slice(0, 2000),
                itemCount: stderrLines.length,
              });
            }
          });
          triggerRepair(0, files, installError, 'dev server failed to start', stderrLines);
          return;
        }
      } else {
        // Files written without package.json change — if dev server already running, it
        // should hot-reload. If not running yet, start it.
        const currentState = useSandboxStore.getState();
        if (!currentState.devPort && currentState.projectId) {
          setBuildStatus({ step: 'building', message: 'Starting dev server...' });
          withCapture((capture) => {
            capture.checkpoint('Starting the preview after file updates', {
              checkpoint: 'preview-start',
              status: 'started',
              sandboxProjectId: currentState.projectId ?? undefined,
              files: filePaths,
            });
          });
          const logStartIndex = useSandboxStore.getState().logs.length;
          const port = await startDev();
          if (port) {
            const verified = await verifyAndRepairIfNeeded(port, files, undefined, logStartIndex, initialPreviewLoadCount);
            if (verified) {
              previewVerified = true;
              previewReachable = true;
              previewSummary = `Started the preview and verified it on port ${port}.`;
            } else {
              return;
            }
          }
        } else if (currentState.devPort) {
          const activePort = currentState.devPort;
          setBuildStatus({ step: 'ready', message: 'Files updated — hot reloading...' });
          // Light verify: wait briefly and ping the server to confirm it's still up
          const logStartIndex = useSandboxStore.getState().logs.length;
          await new Promise((r) => setTimeout(r, 2000));
          const stillUp = await waitForDevServer(activePort, 5000);
          if (!stillUp) {
            // Hot reload broke something — trigger repair
            const verified = await verifyAndRepairIfNeeded(activePort, files, undefined, logStartIndex, initialPreviewLoadCount);
            if (!verified) {
              return;
            }
            previewVerified = true;
            previewReachable = true;
            previewSummary = `Recovered the preview and verified it on port ${activePort}.`;
          } else {
            previewReachable = true;
            const browserRuntimeErrors = await waitForBrowserRuntimeErrors(logStartIndex, 3500);
            if (browserRuntimeErrors.length > 0) {
              withCapture((capture) => {
                capture.verification('Hot reload introduced browser runtime errors', {
                  target: 'preview-runtime',
                  status: 'failed',
                  port: activePort,
                  evidence: browserRuntimeErrors.slice(0, 5),
                });
              });
              await triggerRepair(activePort, files, undefined, 'preview runtime error after hot reload', undefined, browserRuntimeErrors);
              return;
            }
            const previewReloaded = await waitForPreviewIframeLoad(activePort, initialPreviewLoadCount, 3500);
            withCapture((capture) => {
              capture.verification(
                previewReloaded
                  ? `Hot reload refreshed the preview on port ${activePort}`
                  : `Hot reload remained reachable on port ${activePort}, but no fresh preview load was observed`,
                {
                  target: 'preview-runtime',
                  status: 'passed',
                  port: activePort,
                },
              );
              capture.checkpoint('Hot reload completed successfully', {
                checkpoint: 'preview-hot-reload',
                status: 'completed',
                sandboxProjectId: currentState.projectId ?? undefined,
                files: filePaths,
                port: activePort,
              });
            });
            if (previewReloaded) {
              previewVerified = true;
              previewSummary = `Hot-reloaded the running preview and observed it refresh on port ${activePort}.`;
            } else {
              previewSummary = `Applied the update while the preview stayed reachable on port ${activePort}, but a fresh preview load was not observed yet.`;
            }
          }
        }
      }

      const currentState = useSandboxStore.getState();
      const details: string[] = [];

      if (linkedSandboxUnavailable) {
        details.push('Recovered from a stale sandbox link by creating a fresh sandbox.');
        recoveryLabel = 'Recovered from a stale sandbox link.';
      } else if (createdSandboxName) {
        details.push(`Created a fresh sandbox for ${createdSandboxName}.`);
      }

      if (reinstalledDependencies) {
        details.push('Reinstalled dependencies after package changes.');
        verificationItems.push('Reinstalled dependencies after package changes.');
      }

      if (previewSummary) {
        details.push(previewSummary);
        verificationItems.push(previewSummary);
        if (previewVerified) {
          proofFlags.buildOk = true;
        }
      } else if (previewReachable && currentState.devPort) {
        details.push(`Preview is reachable on port ${currentState.devPort}, but this update was not freshly verified in the app shell.`);
        verificationItems.push(`Preview is reachable on port ${currentState.devPort}, but fresh load proof was not captured yet.`);
      } else if (currentState.devPort) {
        details.push(`Preview remains live on port ${currentState.devPort}, but no fresh load proof was captured for this update.`);
        verificationItems.push(`Preview remains live on port ${currentState.devPort}, but fresh load proof was not captured yet.`);
      } else {
        verificationItems.push('Applied the file changes, but no live preview proof was captured yet.');
      }

      if (previewReachable && !previewVerified && !proofFlags.buildOk) {
        details.push('Holding the artifact below verified status until the preview visibly reloads.');
      }

      if (installError) {
        failureClass = classifyFailure(installError);
        recoveryLabel = recoveryLabel ?? 'Recovered after dependency or preview trouble.';
      }

      const artifact = buildUpdateArtifact({
        projectName: currentState.projectName,
        fileCount: files.length,
        files,
        port: currentState.devPort,
        previewVerified,
        previewReachable,
        reinstalledDependencies,
        verificationItems,
        proofFlags,
        recoveryLabel,
        failureClass,
      });

      const projectLabel = currentState.projectName ? ` for ${currentState.projectName}` : '';
      const projectUpdate = buildProjectUpdateMessage(
        `Applied ${files.length} file${files.length === 1 ? '' : 's'}${projectLabel}.`,
        details,
        files,
        artifact,
      );
      await injectProjectUpdate(projectUpdate, conversationId);
      recordProjectUpdateArtifact(projectUpdate);
    } catch (err) {
      withCapture((capture) => {
        capture.checkpoint('Applying files to the sandbox failed', {
          checkpoint: 'sandbox-apply',
          status: 'failed',
          detail: (err as Error).message,
          files: filePaths,
        });
        capture.error(`Auto-sandbox failed: ${(err as Error).message}`, { errorType: 'sandbox' });
      });
      setBuildStatus({ step: 'failed', message: (err as Error).message });
      toast.error(`Sandbox error: ${(err as Error).message}`);
    }
  }, [activeConversation, activeConversationId, attachProject, createProject, destroyProject, writeFiles, installDeps, startDev, stopDev, setBuildStatus, expandBuilder, setConversationSandbox, verifyAndRepairIfNeeded, triggerRepair, injectProjectUpdate, recordProjectUpdateArtifact, withCapture]);

  const processTemplate = useCallback(async (templateId: string, name: string, forceFreshProject = false) => {
    try {
      expandBuilder();
      const conversationId = activeConversationId;
      const initialPreviewLoadCount = useSandboxStore.getState().previewLoadCount;

      withCapture((capture) => {
        capture.checkpoint(`Scaffolding ${name} from a starter template`, {
          checkpoint: 'template-scaffold',
          status: 'started',
          conversationId: conversationId ?? undefined,
        });
      });

      if (forceFreshProject && useSandboxStore.getState().projectId) {
        await destroyProject();
        withCapture((capture) => {
          capture.checkpoint('Destroyed the existing sandbox before scaffolding a template', {
            checkpoint: 'sandbox-reset',
            status: 'completed',
            conversationId: conversationId ?? undefined,
          });
        });
      }

      setBuildStatus({ step: 'generating', message: `Creating ${name}...` });
      await scaffoldFromTemplate(templateId, name);

      const currentState = useSandboxStore.getState();
      if (conversationId && currentState.projectId) {
        await setConversationSandbox(conversationId, currentState.projectId);
      }
      if (currentState.devPort) {
        const activePort = currentState.devPort;
        const previewLoaded = await waitForPreviewIframeLoad(activePort, initialPreviewLoadCount);
        if (!previewLoaded) {
          withCapture((capture) => {
            capture.verification(`Template preview stayed blank for ${name}`, {
              target: 'template-preview',
              status: 'failed',
              port: activePort,
              timeoutMs: 6000,
            });
          });
          setBuildStatus({ step: 'failed', message: 'Template preview never loaded in the app shell' });
          return;
        }
        setBuildStatus({ step: 'ready', message: `Running on port ${currentState.devPort}` });
        toast.success(`${name} is running on port ${currentState.devPort}`);
        withCapture((capture) => {
          capture.checkpoint(`Finished scaffolding ${name}`, {
            checkpoint: 'template-scaffold',
            status: 'completed',
            sandboxProjectId: currentState.projectId ?? undefined,
            conversationId: conversationId ?? undefined,
            port: activePort,
          });
          capture.verification(`Template preview verified on port ${activePort}`, {
            target: 'template-preview',
            status: 'passed',
            port: activePort,
          });
          capture.artifact(`Preview URL http://localhost:${activePort}`, {
            artifactType: 'preview-url',
            label: 'Preview URL',
            value: `http://localhost:${activePort}`,
          });
        });
        const baselineLabel = /^fresh\b/i.test(name) ? name : `fresh ${name}`;
        repairAttemptsRef.current = 0;
        const artifact: ProjectUpdateArtifact = {
          kind: 'starter',
          title: name,
          status: 'live',
          tone: 'violet',
          badge: 'Starter baseline',
          port: activePort,
          liveUrl: `http://localhost:${activePort}`,
          fileCount: currentState.files.length,
          evidenceTier: evidenceTierFromProof({ buildOk: true }),
          verificationItems: [`Verified the preview on port ${activePort}.`],
          changedFiles: currentState.files.slice(0, 8),
          nextPrompts: [
            'Turn this starter into a premium landing page',
            'Add auth and a dashboard shell to this app',
          ],
        };
        const projectUpdate = buildProjectUpdateMessage(
          `Created ${baselineLabel} baseline.`,
          [`Verified the preview on port ${activePort}.`],
          [],
          artifact,
        );
        await injectProjectUpdate(projectUpdate, conversationId);
        recordProjectUpdateArtifact(projectUpdate);
      } else if (currentState.status === 'failed') {
        withCapture((capture) => {
          capture.checkpoint(`Template scaffolding failed for ${name}`, {
            checkpoint: 'template-scaffold',
            status: 'failed',
            detail: currentState.error || `${name} failed to start`,
            sandboxProjectId: currentState.projectId ?? undefined,
            conversationId: conversationId ?? undefined,
          });
        });
        setBuildStatus({ step: 'failed', message: currentState.error || `${name} failed to start` });
      }
    } catch (err) {
      withCapture((capture) => {
        capture.checkpoint(`Template scaffolding failed for ${name}`, {
          checkpoint: 'template-scaffold',
          status: 'failed',
          detail: (err as Error).message,
        });
        capture.error(`Template scaffold failed: ${(err as Error).message}`, { errorType: 'sandbox' });
      });
      setBuildStatus({ step: 'failed', message: (err as Error).message });
      toast.error(`Sandbox error: ${(err as Error).message}`);
    }
  }, [activeConversationId, destroyProject, scaffoldFromTemplate, setBuildStatus, expandBuilder, setConversationSandbox, injectProjectUpdate, recordProjectUpdateArtifact, withCapture]);

  const processDeploy = useCallback(async (action: { stackId: string; tier: string; name: string }) => {
    try {
      expandBuilder();
      const conversationId = activeConversationId;
      const initialPreviewLoadCount = useSandboxStore.getState().previewLoadCount;
      withCapture((capture) => {
        capture.checkpoint(`Starting deploy preview for ${action.name}`, {
          checkpoint: 'deploy-preview',
          status: 'started',
          conversationId: conversationId ?? undefined,
        });
      });
      setBuildStatus({ step: 'generating', message: `Starting ${action.name} preview...` });
      await deployStack(action.stackId, action.tier, action.name, action.tier);

      const currentState = useSandboxStore.getState();
      if (conversationId && currentState.projectId) {
        await setConversationSandbox(conversationId, currentState.projectId);
      }
      if (currentState.devPort) {
        const activePort = currentState.devPort;
        const previewLoaded = await waitForPreviewIframeLoad(activePort, initialPreviewLoadCount);
        if (!previewLoaded) {
          withCapture((capture) => {
            capture.verification(`Deploy preview stayed blank for ${action.name}`, {
              target: 'deploy-preview',
              status: 'failed',
              port: activePort,
              timeoutMs: 6000,
            });
          });
          setBuildStatus({ step: 'failed', message: 'Deploy preview never loaded in the app shell' });
          return;
        }
        setBuildStatus({ step: 'ready', message: `Preview running on port ${currentState.devPort}` });
        toast.success(`${action.name} is running on port ${currentState.devPort}`);
        withCapture((capture) => {
          capture.checkpoint(`Deploy preview is ready for ${action.name}`, {
            checkpoint: 'deploy-preview',
            status: 'completed',
            sandboxProjectId: currentState.projectId ?? undefined,
            conversationId: conversationId ?? undefined,
            port: activePort,
          });
          capture.verification(`Deploy preview verified on port ${activePort}`, {
            target: 'deploy-preview',
            status: 'passed',
            port: activePort,
          });
          capture.artifact(`Preview URL http://localhost:${activePort}`, {
            artifactType: 'preview-url',
            label: 'Preview URL',
            value: `http://localhost:${activePort}`,
          });
        });
        const projectUpdate = buildProjectUpdateMessage(
          `Opened ${action.name} in a sandbox preview.`,
          [`Verified the preview on port ${activePort}.`],
          [],
          {
            kind: 'preview',
            title: action.name,
            status: 'live',
            tone: 'blue',
            badge: action.tier === 'basic' ? 'Live preview' : action.tier,
            port: activePort,
            liveUrl: `http://localhost:${activePort}`,
            fileCount: currentState.files.length,
            evidenceTier: evidenceTierFromProof({ buildOk: true }),
            verificationItems: [`Verified the preview on port ${activePort}.`],
            changedFiles: currentState.files.slice(0, 8),
            nextPrompts: [
              `Polish the onboarding for ${action.name}`,
              'Tighten the first-run experience and navigation',
            ],
          },
        );
        repairAttemptsRef.current = 0;
        await injectProjectUpdate(projectUpdate, conversationId);
        recordProjectUpdateArtifact(projectUpdate);
      } else if (currentState.deployPhase === 'failed' || currentState.status === 'failed') {
        withCapture((capture) => {
          capture.checkpoint(`Deploy preview failed for ${action.name}`, {
            checkpoint: 'deploy-preview',
            status: 'failed',
            detail: currentState.error || `${action.name} failed to start`,
            sandboxProjectId: currentState.projectId ?? undefined,
            conversationId: conversationId ?? undefined,
          });
        });
        setBuildStatus({ step: 'failed', message: currentState.error || `${action.name} failed to start` });
      }
    } catch (err) {
      withCapture((capture) => {
        capture.checkpoint(`Deploy preview failed for ${action.name}`, {
          checkpoint: 'deploy-preview',
          status: 'failed',
          detail: (err as Error).message,
        });
        capture.error(`Deploy preview failed: ${(err as Error).message}`, { errorType: 'sandbox' });
      });
      setBuildStatus({ step: 'failed', message: (err as Error).message });
      toast.error(`Sandbox error: ${(err as Error).message}`);
    }
  }, [activeConversationId, deployStack, expandBuilder, setBuildStatus, setConversationSandbox, injectProjectUpdate, recordProjectUpdateArtifact, withCapture]);

  useEffect(() => {
    if (isStreaming) {
      return;
    }

    const selection = selectNextAutoSandboxMessage(messages, processedMessageIdsRef.current);
    selection.skippedIds.forEach((id) => processedMessageIdsRef.current.add(id));

    const lastMsg = selection.candidate;
    if (!lastMsg) {
      return;
    }

    processedMessageIdsRef.current.add(lastMsg.id);

    const lastUserMsg = [...messages].reverse().find((message) => message.role === 'user');
    const userPrompt = lastUserMsg?.content ?? '';
    const normalizedPrompt = userPrompt.toLowerCase();
    const templateActions = extractTemplateActions(lastMsg.content);
    const deployActions = extractDeployActions(lastMsg.content);
    const files = extractFilesFromMarkdown(lastMsg.content);
    const hasActiveProject = Boolean(activeConversation?.sandboxProjectId ?? useSandboxStore.getState().projectId);
    const sandboxIntent = resolveAutoSandboxIntent({
      userPrompt,
      mode: effectiveMode,
      hasActiveProject,
      hasPackageJsonOutput: hasPackageJson(files),
    });

    console.info('[auto-sandbox] assistant-complete', {
      messageId: lastMsg.id,
      effectiveMode,
      layoutMode: mode,
      activeConversationId,
      sandboxProjectId: activeConversation?.sandboxProjectId ?? null,
      attachedProjectId: useSandboxStore.getState().projectId,
      hasActiveProject,
      fileCount: files.length,
      templateCount: templateActions.length,
      deployCount: deployActions.length,
      explicitChatBuildRequest: sandboxIntent.explicitChatBuildRequest,
      explicitChatEditRequest: sandboxIntent.explicitChatEditRequest,
    });

    // ── Files: primary path in builder/agent mode ──
    // Vai writes files directly from scratch in builder/agent mode,
    // and chat can now apply files too when the user explicitly asked to build
    // or update the current app.
    if (files.length > 0 && sandboxIntent.canAutoApplyFiles) {
      console.info('[auto-sandbox] enqueue-files', {
        messageId: lastMsg.id,
        fileCount: files.length,
        forceFreshProject: sandboxIntent.forceFreshProject,
      });
      enqueue(() => processFiles(files, sandboxIntent.forceFreshProject));
      return;
    }

    // ── Deploy actions: auto-execute in builder/agent mode, OR on explicit chat build request ──
    if (deployActions.length > 0 && sandboxIntent.canAutoApplyDeploy) {
      enqueue(() => processDeploy(deployActions[0]));
      return;
    }

    // ── Template actions: only execute when explicitly requested by user ──
    // (e.g. user clicks Quick Start in gallery, or explicitly asks for a template)
    if (templateActions.length > 0 && sandboxIntent.explicitStarterRequest) {
      const forceFreshProject = sandboxIntent.explicitStarterRequest;
      enqueue(() => processTemplate(templateActions[0].templateId, templateActions[0].name, forceFreshProject));
      return;
    }

    if (!sandboxIntent.isBuildMode) {
      if (sandboxIntent.shouldReportMissingAction) {
        const looksIncomplete = /(?:\.\.\.|…)\s*$/.test(lastMsg.content.trim());
        const groundedBriefMessage = lastMsg.groundedBuildBrief
          ? `${lastMsg.groundedBuildBrief.nextStep} No runnable preview action was emitted yet.`
          : null;
        const noPreviewMessage = looksIncomplete
          ? 'Reply ended early. Preview is unchanged until a runnable update lands.'
          : groundedBriefMessage
            ? `Grounded direction ready. ${groundedBriefMessage}`
          : hasActiveProject
            ? 'Preview unchanged. Vai answered in chat only and did not apply code changes.'
            : 'Vai replied in chat only. No preview action was created.';
        setBuildStatus({
          step: hasActiveProject ? 'ready' : 'failed',
          message: noPreviewMessage,
        });
        if (!hasActiveProject) {
          toast.info('No runnable preview action was generated from the last chat build request');
        }
        return;
      }

      console.info('[auto-sandbox] skipping-non-build-mode', { effectiveMode, messageId: lastMsg.id });
      return;
    }

    // ── Builder mode with no actionable output ──
    const looksIncomplete = /(?:\.\.\.|…)\s*$/.test(lastMsg.content.trim());
    if (shouldTriggerGroundedExecutionRepair({
      groundedBrief: lastMsg.groundedBuildBrief,
      looksIncomplete,
      sandboxIntent,
    }) && lastMsg.groundedBuildBrief) {
      console.info('[auto-sandbox] enqueue-grounded-execution-repair', {
        messageId: lastMsg.id,
        focusLabel: lastMsg.groundedBuildBrief.focusLabel,
        intent: lastMsg.groundedBuildBrief.intent,
        hasActiveProject,
      });
      triggerMissingActionRepair({
        groundedBrief: lastMsg.groundedBuildBrief,
        sandboxIntent,
        hasActiveProject,
        userPrompt,
      });
      return;
    }

    const groundedBriefMessage = lastMsg.groundedBuildBrief
      ? `${lastMsg.groundedBuildBrief.nextStep} No runnable preview was emitted yet.`
      : null;
    const noFileMessage = looksIncomplete
      ? 'Reply ended early. Preview is unchanged until files land.'
      : groundedBriefMessage
        ? `Grounded direction ready. ${groundedBriefMessage}`
      : hasActiveProject
        ? 'Preview unchanged. The last Builder reply did not apply code changes yet.'
        : 'Vai answered in chat, but no files were generated for preview yet.';
    setBuildStatus({
      step: hasActiveProject ? 'ready' : 'failed',
      message: noFileMessage,
    });
    if (!hasActiveProject) {
      toast.info('No runnable update was generated from the last Builder reply');
    }
  }, [effectiveMode, enqueue, isStreaming, messages, processDeploy, processFiles, processTemplate, setBuildStatus, triggerMissingActionRepair]);
}
