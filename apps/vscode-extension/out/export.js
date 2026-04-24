"use strict";
/**
 * VeggaAI Dev Logs — Markdown Export
 *
 * Exports the current session as a human-readable Markdown file.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportSessionMarkdown = exportSessionMarkdown;
const vscode = __importStar(require("vscode"));
const session_js_1 = require("./session.js");
const api_js_1 = require("./api.js");
/* ── Icon map for markdown ─────────────────────────────────────── */
const TYPE_EMOJI = {
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
async function exportSessionMarkdown() {
    const session = (0, session_js_1.getActiveSession)();
    if (!session) {
        vscode.window.showWarningMessage('No active session to export.');
        return;
    }
    try {
        const data = await (0, api_js_1.apiCall)(`/api/sessions/${session.id}/export`);
        if (!data || !data.events) {
            vscode.window.showErrorMessage('Failed to fetch session data.');
            return;
        }
        const lines = [
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
            }
            else if (event.type === 'message' && event.meta?.role === 'assistant') {
                lines.push(event.content); // Already markdown
            }
            else {
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
    }
    catch (err) {
        vscode.window.showErrorMessage(`Export failed: ${err}`);
    }
}
//# sourceMappingURL=export.js.map