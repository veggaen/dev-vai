import * as vscode from 'vscode';
import { apiCall } from './api.js';

type CompanionContextField = 'openFile' | 'selection' | 'terminalOutput';

interface CompanionContextWorkItem {
  requestId: string;
  requestedFields: CompanionContextField[];
}

interface CompanionContextEvidence {
  source: 'vscode-capture-adapter';
  capturedAt: string;
  openFile?: string;
  selection?: string;
  terminalOutput?: string;
  note?: string;
}

const POLL_INTERVAL_MS = 500;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;

function captureContext(workItem: CompanionContextWorkItem): CompanionContextEvidence {
  const editor = vscode.window.activeTextEditor;
  const notes: string[] = [];
  const evidence: CompanionContextEvidence = {
    source: 'vscode-capture-adapter',
    capturedAt: new Date().toISOString(),
  };

  if (workItem.requestedFields.includes('openFile')) {
    if (editor?.document.uri.scheme === 'file') {
      evidence.openFile = vscode.workspace.asRelativePath(editor.document.uri);
    } else {
      notes.push('No file-backed active editor is available.');
    }
  }

  if (workItem.requestedFields.includes('selection')) {
    if (editor) {
      evidence.selection = editor.document.getText(editor.selection);
    } else {
      notes.push('No active editor selection is available.');
    }
  }

  if (workItem.requestedFields.includes('terminalOutput')) {
    notes.push('VS Code does not expose terminal buffer output through its extension API.');
  }

  if (notes.length > 0) {
    evidence.note = notes.join(' ');
  }

  return evidence;
}

async function pollCompanionContext(): Promise<void> {
  if (pollInFlight) return;
  pollInFlight = true;

  try {
    const workItem = await apiCall('/api/companion-context/poll-consume', 'POST') as CompanionContextWorkItem | null;
    if (!workItem) return;

    await apiCall(
      `/api/companion-context/requests/${workItem.requestId}/respond`,
      'POST',
      captureContext(workItem),
    );
  } catch {
    // The runtime may be offline during startup or reloads. The next poll retries.
  } finally {
    pollInFlight = false;
  }
}

export function startCompanionContextPoller(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => void pollCompanionContext(), POLL_INTERVAL_MS);
  void pollCompanionContext();
}

export function stopCompanionContextPoller(): void {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}
