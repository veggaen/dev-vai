/**
 * VeggaAI Event Capture — Editor & Focus Watchers
 *
 * Tracks:
 * - Active editor changes (which file you're looking at)
 * - Visible editor changes (split views)
 * - Text selections (large selections → likely copy/paste or reading)
 * - Editor column/group changes
 */

import * as vscode from 'vscode';
import { pushEvent, getActiveSession } from './session.js';

/* ── State ─────────────────────────────────────────────────────── */

// Editor focus tracking DISABLED.
// Clicking files in VS Code is normal navigation — not something that belongs
// in dev logs. The chat-history watcher already captures file reads done by
// the AI agent via tool invocations (read_file, grep_search, etc.).
// Logging every editor tab switch floods the timeline with noise.

/* ── Register Watchers ─────────────────────────────────────────── */

export function registerEditorWatchers(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration('vai');
  if (!cfg.get('captureEditorFocus', true)) return;

  // ── Active editor change — DISABLED ──
  // This was logging "Read File" events every time you clicked a tab.
  // Those are user navigation, not AI activity. Removed to reduce noise.

  // ── Visible editors change (splits) ──
  // Debounced + deduped to avoid spamming 30+ identical notes per session
  let lastSplitKey = '';
  let splitDebounce: ReturnType<typeof setTimeout> | null = null;
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      if (!getActiveSession()) return;
      if (editors.length <= 1) return; // Normal single editor, skip

      const files = editors
        .filter((e) => e.document.uri.scheme === 'file')
        .map((e) => vscode.workspace.asRelativePath(e.document.uri))
        .sort();

      if (files.length <= 1) return;

      const key = files.join('|');
      if (key === lastSplitKey) return; // Same set of files, skip

      if (splitDebounce) clearTimeout(splitDebounce);
      splitDebounce = setTimeout(() => {
        lastSplitKey = key;
        pushEvent('note', `Split view: ${files.join(', ')}`, {
          files,
          editorCount: files.length,
        });
      }, 2000); // 2s debounce
    }),
  );
}
