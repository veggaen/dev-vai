/**
 * VeggaAI Dev Logs — Status Bar
 *
 * Shows session status with live event counter in the VS Code status bar.
 * Recording indicator with animated dot when session is active.
 */

import * as vscode from 'vscode';
import { getActiveSession, onSessionChange, onEventPushed } from './session.js';

/* ── State ─────────────────────────────────────────────────────── */

let statusBarItem: vscode.StatusBarItem;

/* ── Initialize ────────────────────────────────────────────────── */

export function registerStatusBar(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);

  // Update on session changes
  context.subscriptions.push(
    onSessionChange(() => updateStatusBar()),
    onEventPushed(() => updateStatusBar()),
  );

  updateStatusBar();
}

/* ── Update ────────────────────────────────────────────────────── */

function updateStatusBar(): void {
  const session = getActiveSession();

  if (session) {
    const count = session.eventCount;
    const title = session.title.length > 25 ? session.title.slice(0, 25) + '…' : session.title;
    statusBarItem.text = `$(radio-tower) Vai: ${title} (${count})`;
    statusBarItem.tooltip = [
      `Session: ${session.title}`,
      `ID: ${session.id}`,
      `Events: ${count}`,
      `Buffered: ${session.eventBuffer.length}`,
      '',
      'Click to end session',
    ].join('\n');
    statusBarItem.command = 'vai.endSession';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.show();
  } else {
    statusBarItem.text = '$(circle-outline) Vai: No session';
    statusBarItem.tooltip = 'Click to start a dev log session';
    statusBarItem.command = 'vai.startSession';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.show();
  }
}
