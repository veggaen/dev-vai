/**
 * VeggaAI Dev Logs — Markdown Export
 *
 * Exports the current session as a human-readable Markdown file.
 */

import * as vscode from 'vscode';
import { getActiveSession } from './session.js';
import { apiCall } from './api.js';

/* ── Icon map for markdown ─────────────────────────────────────── */

const TYPE_EMOJI: Record<string, string> = {
  message: '💬',
  thinking: '🧠',
  planning: '🧭',
  'context-gather': '📖',
  'file-create': '📄',
  'file-edit': '✏️',
  'file-read': '👁️',
  'file-delete': '🗑️',
  terminal: '⬛',
  search: '🔍',
  'todo-update': '☑️',
  'state-change': '⚡',
  error: '⚠️',
  'tool-call': '🔧',
  summary: '📝',
  note: '📌',
};

/* ── Export ─────────────────────────────────────────────────────── */

export async function exportSessionMarkdown(): Promise<void> {
  const session = getActiveSession();
  if (!session) {
    vscode.window.showWarningMessage('No active session to export.');
    return;
  }

  try {
    const data = await apiCall(`/api/sessions/${session.id}/export`);
    if (!data || !data.events) {
      vscode.window.showErrorMessage('Failed to fetch session data.');
      return;
    }

    const lines: string[] = [
      `# Dev Log: ${data.session?.title || session.title}`,
      '',
      `**Session ID:** \`${session.id}\``,
      `**Started:** ${new Date(session.createdAt).toLocaleString()}`,
      `**Events:** ${data.events.length}`,
      '',
      '---',
      '',
    ];

    for (const event of data.events) {
      const time = new Date(event.timestamp).toLocaleTimeString();
      const emoji = TYPE_EMOJI[event.type] || '📋';
      const role = event.meta?.role ? ` (${event.meta.role})` : '';
      const header = `### ${emoji} ${event.type}${role} — ${time}`;

      lines.push(header);
      lines.push('');

      if (event.type === 'terminal') {
        lines.push('```bash');
        lines.push(event.content);
        lines.push('```');
      } else if (event.type === 'message' && event.meta?.role === 'assistant') {
        lines.push(event.content); // Already markdown
      } else {
        lines.push(event.content);
      }

      if (event.meta?.filePath) {
        lines.push('');
        lines.push(`> File: \`${event.meta.filePath}\``);
      }

      lines.push('');
    }

    // Open as untitled document
    const doc = await vscode.workspace.openTextDocument({
      content: lines.join('\n'),
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage(`Exported ${data.events.length} events as Markdown.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Export failed: ${err}`);
  }
}
