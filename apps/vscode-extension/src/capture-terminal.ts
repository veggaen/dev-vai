/**
 * VeggaAI Event Capture — Terminal Watchers
 *
 * Tracks:
 * - Terminal open/close events
 * - Shell integration: command start, command end, output
 * - Terminal data (command text) via shell integration API
 */

import * as vscode from 'vscode';
import { pushEvent, getActiveSession } from './session.js';

/* ── State ─────────────────────────────────────────────────────── */

/** Map terminal name → last known command for dedup */
const terminalCommands = new Map<string, string>();

/* ── Register Watchers ─────────────────────────────────────────── */

export function registerTerminalWatchers(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration('vai');
  if (!cfg.get('captureTerminal', true)) return;

  // ── Terminal open ──
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal((terminal) => {
      if (!getActiveSession()) return;
      pushEvent('note', `Terminal opened: ${terminal.name}`, {
        terminalName: terminal.name,
      });
    }),
  );

  // ── Terminal close ──
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      if (!getActiveSession()) return;
      pushEvent('note', `Terminal closed: ${terminal.name}`, {
        terminalName: terminal.name,
      });
      terminalCommands.delete(terminal.name);
    }),
  );

  // ── Shell Integration: Command Start ──
  // This fires when VS Code detects a command has started executing in a terminal
  context.subscriptions.push(
    vscode.window.onDidStartTerminalShellExecution((e) => {
      if (!getActiveSession()) return;

      const commandLine = e.execution.commandLine;
      if (!commandLine) return;

      // Get the command text
      const cmd = typeof commandLine === 'string' ? commandLine : commandLine.value;
      if (!cmd || cmd.trim().length === 0) return;

      // Skip duplicate commands (same terminal, same command)
      const key = e.terminal.name;
      if (terminalCommands.get(key) === cmd) return;
      terminalCommands.set(key, cmd);

      pushEvent('terminal', `$ ${cmd}`, {
        command: cmd,
        terminalName: e.terminal.name,
      });
    }),
  );

  // ── Shell Integration: Command End ──
  context.subscriptions.push(
    vscode.window.onDidEndTerminalShellExecution((e) => {
      if (!getActiveSession()) return;

      const commandLine = e.execution.commandLine;
      if (!commandLine) return;
      const cmd = typeof commandLine === 'string' ? commandLine : commandLine.value;
      if (!cmd) return;

      const exitCode = e.exitCode;
      if (exitCode !== undefined && exitCode !== 0) {
        pushEvent('terminal', `Command failed (exit ${exitCode}): ${cmd}`, {
          command: cmd,
          exitCode,
          terminalName: e.terminal.name,
        });
      }
    }),
  );

  // ── Terminal active change (track which terminal is focused) ──
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (!getActiveSession() || !terminal) return;
      // Don't push this as it's too noisy — just track internally
    }),
  );
}
