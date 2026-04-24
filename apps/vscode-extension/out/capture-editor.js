"use strict";
/**
 * VeggaAI Event Capture — Editor & Focus Watchers
 *
 * Tracks:
 * - Active editor changes (which file you're looking at)
 * - Visible editor changes (split views)
 * - Text selections (large selections → likely copy/paste or reading)
 * - Editor column/group changes
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
exports.registerEditorWatchers = registerEditorWatchers;
const vscode = __importStar(require("vscode"));
const session_js_1 = require("./session.js");
/* ── State ─────────────────────────────────────────────────────── */
// Editor focus tracking DISABLED.
// Clicking files in VS Code is normal navigation — not something that belongs
// in dev logs. The chat-history watcher already captures file reads done by
// the AI agent via tool invocations (read_file, grep_search, etc.).
// Logging every editor tab switch floods the timeline with noise.
/* ── Register Watchers ─────────────────────────────────────────── */
function registerEditorWatchers(context) {
    const cfg = vscode.workspace.getConfiguration('vai');
    if (!cfg.get('captureEditorFocus', true))
        return;
    // ── Active editor change — DISABLED ──
    // This was logging "Read File" events every time you clicked a tab.
    // Those are user navigation, not AI activity. Removed to reduce noise.
    // ── Visible editors change (splits) ──
    // Debounced + deduped to avoid spamming 30+ identical notes per session
    let lastSplitKey = '';
    let splitDebounce = null;
    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors((editors) => {
        if (!(0, session_js_1.getActiveSession)())
            return;
        if (editors.length <= 1)
            return; // Normal single editor, skip
        const files = editors
            .filter((e) => e.document.uri.scheme === 'file')
            .map((e) => vscode.workspace.asRelativePath(e.document.uri))
            .sort();
        if (files.length <= 1)
            return;
        const key = files.join('|');
        if (key === lastSplitKey)
            return; // Same set of files, skip
        if (splitDebounce)
            clearTimeout(splitDebounce);
        splitDebounce = setTimeout(() => {
            lastSplitKey = key;
            (0, session_js_1.pushEvent)('note', `Split view: ${files.join(', ')}`, {
                files,
                editorCount: files.length,
            });
        }, 2000); // 2s debounce
    }));
}
//# sourceMappingURL=capture-editor.js.map