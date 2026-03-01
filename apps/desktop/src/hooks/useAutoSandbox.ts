/**
 * useAutoSandbox — watches for completed AI responses in builder/agent modes
 * and automatically extracts file blocks, then writes them to the sandbox.
 *
 * Flow:
 * 1. Detects when streaming finishes (isStreaming transitions false → true → false)
 * 2. Checks if mode is builder or agent
 * 3. Parses the last assistant message for code blocks with title="path"
 * 4. If files found:
 *    a. If no sandbox project exists, creates one (using project name from package.json or fallback)
 *    b. Writes all extracted files to the sandbox
 *    c. If package.json changed, reinstalls deps
 *    d. Restarts dev server
 */

import { useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '../stores/chatStore.js';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { useLayoutStore, type ChatMode } from '../stores/layoutStore.js';
import {
  extractFilesFromMarkdown,
  hasFileBlocks,
  hasPackageJson,
  extractProjectName,
  type ExtractedFile,
} from '../lib/file-extractor.js';
import { toast } from 'sonner';

const BUILD_MODES: ChatMode[] = ['builder', 'agent'];

export function useAutoSandbox() {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const messages = useChatStore((s) => s.messages);
  const mode = useLayoutStore((s) => s.mode);
  const setBuildStatus = useLayoutStore((s) => s.setBuildStatus);

  const projectId = useSandboxStore((s) => s.projectId);
  const status = useSandboxStore((s) => s.status);
  const createProject = useSandboxStore((s) => s.createProject);
  const writeFiles = useSandboxStore((s) => s.writeFiles);
  const installDeps = useSandboxStore((s) => s.installDeps);
  const startDev = useSandboxStore((s) => s.startDev);
  const stopDev = useSandboxStore((s) => s.stopDev);

  const wasStreamingRef = useRef(false);
  const processingRef = useRef(false);

  const processFiles = useCallback(async (files: ExtractedFile[]) => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      const sandboxState = useSandboxStore.getState();
      let pid = sandboxState.projectId;

      // If no project exists yet, create one
      if (!pid) {
        const name = extractProjectName(files) || `vai-project-${Date.now()}`;
        setBuildStatus({ step: 'generating', message: 'Creating sandbox...' });
        pid = await createProject(name);
        toast.info(`Sandbox created: ${name}`);
      }

      // Write files
      setBuildStatus({ step: 'writing', message: `Writing ${files.length} file${files.length > 1 ? 's' : ''}...` });
      await writeFiles(files.map((f) => ({ path: f.path, content: f.content })));
      toast.success(`${files.length} file${files.length > 1 ? 's' : ''} written to sandbox`);

      // If package.json is among the files, reinstall + restart
      if (hasPackageJson(files)) {
        // Stop running dev server if any
        const currentState = useSandboxStore.getState();
        if (currentState.devPort) {
          await stopDev();
        }

        setBuildStatus({ step: 'installing', message: 'Installing dependencies...' });
        const ok = await installDeps();
        if (!ok) {
          setBuildStatus({ step: 'failed', message: 'Install failed' });
          toast.error('Dependency install failed');
          return;
        }

        setBuildStatus({ step: 'building', message: 'Starting dev server...' });
        const port = await startDev();
        if (port) {
          setBuildStatus({ step: 'ready', message: `Running on port ${port}` });
          toast.success(`Dev server running on port ${port}`);
        } else {
          setBuildStatus({ step: 'failed', message: 'Failed to start dev server' });
        }
      } else {
        // Files written without package.json change — if dev server already running, it
        // should hot-reload. If not running yet, start it.
        const currentState = useSandboxStore.getState();
        if (!currentState.devPort && currentState.projectId) {
          setBuildStatus({ step: 'building', message: 'Starting dev server...' });
          const port = await startDev();
          if (port) {
            setBuildStatus({ step: 'ready', message: `Running on port ${port}` });
          }
        } else {
          setBuildStatus({ step: 'ready', message: 'Files updated — hot reloading...' });
        }
      }
    } catch (err) {
      setBuildStatus({ step: 'failed', message: (err as Error).message });
      toast.error(`Sandbox error: ${(err as Error).message}`);
    } finally {
      processingRef.current = false;
    }
  }, [createProject, writeFiles, installDeps, startDev, stopDev, setBuildStatus]);

  useEffect(() => {
    // Detect streaming just finished
    if (wasStreamingRef.current && !isStreaming) {
      // Only process in build-oriented modes
      if (!BUILD_MODES.includes(mode)) {
        wasStreamingRef.current = false;
        return;
      }

      // Avoid processing when sandbox is already doing something
      if (processingRef.current) {
        wasStreamingRef.current = false;
        return;
      }

      // Get the last assistant message
      const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
      if (!lastMsg || lastMsg.role !== 'assistant') {
        wasStreamingRef.current = false;
        return;
      }

      // Check for file blocks
      if (hasFileBlocks(lastMsg.content)) {
        const files = extractFilesFromMarkdown(lastMsg.content);
        if (files.length > 0) {
          processFiles(files);
        }
      }
    }

    wasStreamingRef.current = isStreaming;
  }, [isStreaming, messages, mode, processFiles]);
}
