/**
 * VeggaAI Event Capture — Output Channel Monitor
 *
 * Monitors VS Code Output channels for Copilot activity.
 *
 * Strategy:
 * - VS Code doesn't have a public API to READ output channel content from other extensions.
 * - However, we CAN create a log output channel and use workspace.onDidChangeConfiguration
 *   to detect Copilot setting changes.
 * - We monitor relevant extension activity via:
 *   1. Copilot-related commands executed
 *   2. Extension host events
 *   3. Diagnostics changes (errors/warnings that Copilot might fix)
 */

import * as vscode from 'vscode';
import { pushEvent, getActiveSession } from './session.js';

/* ── State ─────────────────────────────────────────────────────── */

let lastDiagCount = 0;
let lastDiagContent = '';
const diagDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingDiagUris: vscode.Uri[] = [];

/* ── Copilot Command Tracking ──────────────────────────────────── */

const COPILOT_COMMANDS = [
  'github.copilot.chat.open',
  'github.copilot.interactiveEditor.explain',
  'github.copilot.interactiveEditor.fix',
  'github.copilot.interactiveEditor.generate',
  'github.copilot.interactiveEditor.test',
  'github.copilot.terminal.explain',
  'github.copilot.chat.attachFile',
  'github.copilot.chat.attachSelection',
  'inlineChat.start',
  'workbench.action.chat.open',
  'workbench.action.chat.newChat',
  'workbench.action.chat.clearHistory',
];

/* ── Debounced Diagnostics Processor ────────────────────────── */

function processDiagnostics(uris: vscode.Uri[]): void {
  if (!getActiveSession()) return;

  // Aggregate all current diagnostics across the changed URIs
  let totalErrors = 0;
  let totalWarnings = 0;
  for (const uri of uris) {
    const diags = vscode.languages.getDiagnostics(uri);
    for (const d of diags) {
      if (d.severity === vscode.DiagnosticSeverity.Error) totalErrors++;
      else if (d.severity === vscode.DiagnosticSeverity.Warning) totalWarnings++;
    }
  }

  const currentCount = totalErrors + totalWarnings;

  // Only log on significant change (avoids noise from language server churn)
  // Must change by at least 10 diagnostics to be worth logging
  if (Math.abs(currentCount - lastDiagCount) < 10) return;

  // Dedup: don't log identical diagnostics content repeatedly
  const contentKey = `${totalErrors}:${totalWarnings}:${uris.length}`;
  if (contentKey === lastDiagContent) return;
  lastDiagContent = contentKey;

  // Collect per-file detail — top 5 files with errors
  const fileDetails: Array<{ file: string; errors: number; warnings: number; messages: string[] }> = [];
  for (const uri of uris) {
    const diags = vscode.languages.getDiagnostics(uri);
    const errCount = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
    const warnCount = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;
    if (errCount > 0 || warnCount > 0) {
      const relativePath = vscode.workspace.asRelativePath(uri);
      const messages = diags
        .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
        .slice(0, 3)
        .map(d => `L${d.range.start.line + 1}: ${d.message.slice(0, 120)}`);
      fileDetails.push({ file: relativePath, errors: errCount, warnings: warnCount, messages });
    }
  }
  fileDetails.sort((a, b) => b.errors - a.errors);
  const top5 = fileDetails.slice(0, 5);

  const detailLines = top5.map(f => `  ${f.file}: ${f.errors}E/${f.warnings}W${f.messages.length > 0 ? ' — ' + f.messages[0] : ''}`);
  const content = `Diagnostics: ${totalErrors} errors, ${totalWarnings} warnings` +
    (detailLines.length > 0 ? '\n' + detailLines.join('\n') : '');

  pushEvent('state-change', content, {
    state: 'diagnostics',
    errors: totalErrors,
    warnings: totalWarnings,
    filesAffected: uris.length,
    fileDetails: top5,
  });
  lastDiagCount = currentCount;
}

/* ── Register Watchers ─────────────────────────────────────────── */

export function registerOutputWatchers(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration('vai');
  if (!cfg.get('captureOutputChannels', true)) return;

  // ── Track commands executed ──
  // We can't directly intercept Copilot commands, but we can monitor diagnostics
  // changes which often happen right after Copilot makes edits
  // Diagnostics capture DISABLED — generates 1800+ useless events per session.
  // Real errors are visible in the VS Code editor; logging them adds no value
  // and floods the dev logs timeline with noise.
  // If re-enabled in the future, use a much higher threshold (100+) and
  // only log when errors go from 0 → N or N → 0 (transitions, not churn).

  // ── Track task execution (build, test, lint) ──
  context.subscriptions.push(
    vscode.tasks.onDidStartTask((e) => {
      if (!getActiveSession()) return;
      const task = e.execution.task;
      pushEvent('terminal', `Task started: ${task.name}`, {
        command: task.name,
        taskType: task.definition.type,
        source: task.source,
      });
    }),
  );

  context.subscriptions.push(
    vscode.tasks.onDidEndTask((e) => {
      if (!getActiveSession()) return;
      const task = e.execution.task;
      pushEvent('note', `Task ended: ${task.name}`, {
        taskName: task.name,
      });
    }),
  );

  // ── Track debug sessions ──
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession((session) => {
      if (!getActiveSession()) return;
      pushEvent('state-change', `Debug started: ${session.name}`, {
        state: 'debugging',
        debugType: session.type,
        sessionName: session.name,
      });
    }),
  );

  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession((session) => {
      if (!getActiveSession()) return;
      pushEvent('note', `Debug ended: ${session.name}`, {
        sessionName: session.name,
      });
    }),
  );

  // ── Track SCM (git) changes ──
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!getActiveSession()) return;
      // Track Copilot configuration changes
      if (e.affectsConfiguration('github.copilot') || e.affectsConfiguration('vai')) {
        pushEvent('note', 'Configuration changed', {
          copilot: e.affectsConfiguration('github.copilot'),
          vai: e.affectsConfiguration('vai'),
        });
      }
    }),
  );
}
