/**
 * VeggaAI Event Capture — File Watchers
 *
 * Tracks:
 * - File saves (file-edit events)
 * - File creates/deletes via workspace file system watcher
 * - Document content changes (diff tracking)
 * - File renames
 */

import * as vscode from 'vscode';
import { pushEvent, getActiveSession } from './session.js';

/* ── State ─────────────────────────────────────────────────────── */

/** Track file versions to compute diff stats on save */
const fileVersions = new Map<string, { lineCount: number; version: number }>();

/* ── Exclude Patterns ──────────────────────────────────────────── */

function shouldExclude(uri: vscode.Uri): boolean {
  const p = uri.fsPath;
  const relativePath = vscode.workspace.asRelativePath(uri);

  // Fast-path: always exclude .git internals (fsmonitor-daemon, hooks, objects, etc.)
  // Check both relative and absolute paths on all platforms
  if (
    relativePath.startsWith('.git/') || relativePath.startsWith('.git\\') || relativePath === '.git' ||
    p.includes('/.git/') || p.includes('\\.git\\') || p.includes('\\.git/')
  ) {
    return true;
  }

  // Also exclude .vai-session, vai.db files, node_modules, build outputs
  const fastExcludes = ['.vai-session', 'vai.db', 'vai.db-wal', 'vai.db-shm'];
  const basename = relativePath.split(/[/\\]/).pop() ?? '';
  if (fastExcludes.includes(basename)) return true;

  const patterns: string[] = vscode.workspace.getConfiguration('vai').get('excludePatterns', [
    '**/node_modules/**',
    '**/.git/**',
    '**/out/**',
    '**/.vegai-dev-logs/**',
  ]);
  return patterns.some((p) => {
    const regex = p
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    const fullRegex = new RegExp(`(^|/)${regex.replace(/^\.\*\//, '')}`);
    return fullRegex.test(relativePath);
  });
}

/* ── Register Watchers ─────────────────────────────────────────── */

export function registerFileWatchers(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration('vai');
  if (!cfg.get('captureFileEdits', true)) return;

  // ── Track initial line counts for open documents ──
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === 'file' && !shouldExclude(doc.uri)) {
      fileVersions.set(doc.uri.fsPath, {
        lineCount: doc.lineCount,
        version: doc.version,
      });
    }
  }

  // ── Document open — track line count ──
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme !== 'file' || shouldExclude(doc.uri)) return;
      fileVersions.set(doc.uri.fsPath, {
        lineCount: doc.lineCount,
        version: doc.version,
      });
    }),
  );

  // ── Document save — emit file-edit with diff stats ──
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!getActiveSession()) return;
      if (doc.uri.scheme !== 'file' || shouldExclude(doc.uri)) return;

      const relativePath = vscode.workspace.asRelativePath(doc.uri);
      const prev = fileVersions.get(doc.uri.fsPath);
      const currentLines = doc.lineCount;

      let linesAdded = 0;
      let linesRemoved = 0;
      if (prev) {
        const diff = currentLines - prev.lineCount;
        if (diff > 0) linesAdded = diff;
        else linesRemoved = Math.abs(diff);
      }

      pushEvent('file-edit', `Saved ${relativePath} (+${linesAdded}/-${linesRemoved})`, {
        filePath: relativePath,
        linesAdded,
        linesRemoved,
        language: doc.languageId,
      });

      // Update tracked version
      fileVersions.set(doc.uri.fsPath, {
        lineCount: currentLines,
        version: doc.version,
      });
    }),
  );

  // ── File system watcher — creates and deletes ──
  const fsWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false);

  context.subscriptions.push(
    fsWatcher.onDidCreate((uri) => {
      if (!getActiveSession()) return;
      if (shouldExclude(uri)) return;
      const relativePath = vscode.workspace.asRelativePath(uri);
      pushEvent('file-create', `Created ${relativePath}`, {
        filePath: relativePath,
      });
    }),
  );

  context.subscriptions.push(
    fsWatcher.onDidDelete((uri) => {
      if (!getActiveSession()) return;
      if (shouldExclude(uri)) return;
      const relativePath = vscode.workspace.asRelativePath(uri);
      pushEvent('file-delete', `Deleted ${relativePath}`, {
        filePath: relativePath,
      });
      fileVersions.delete(uri.fsPath);
    }),
  );

  context.subscriptions.push(fsWatcher);
}
