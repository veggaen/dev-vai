"use strict";
/**
 * VeggaAI Event Capture — File Watchers
 *
 * Tracks:
 * - File saves (file-edit events)
 * - File creates/deletes via workspace file system watcher
 * - Document content changes (diff tracking)
 * - File renames
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
exports.registerFileWatchers = registerFileWatchers;
const vscode = __importStar(require("vscode"));
const session_js_1 = require("./session.js");
/* ── State ─────────────────────────────────────────────────────── */
/** Track file versions to compute diff stats on save */
const fileVersions = new Map();
/* ── Exclude Patterns ──────────────────────────────────────────── */
function shouldExclude(uri) {
    const p = uri.fsPath;
    const relativePath = vscode.workspace.asRelativePath(uri);
    // Fast-path: always exclude .git internals (fsmonitor-daemon, hooks, objects, etc.)
    // Check both relative and absolute paths on all platforms
    if (relativePath.startsWith('.git/') || relativePath.startsWith('.git\\') || relativePath === '.git' ||
        p.includes('/.git/') || p.includes('\\.git\\') || p.includes('\\.git/')) {
        return true;
    }
    // Also exclude .vai-session, vai.db files, node_modules, build outputs
    const fastExcludes = ['.vai-session', 'vai.db', 'vai.db-wal', 'vai.db-shm'];
    const basename = relativePath.split(/[/\\]/).pop() ?? '';
    if (fastExcludes.includes(basename))
        return true;
    const patterns = vscode.workspace.getConfiguration('vai').get('excludePatterns', [
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
function registerFileWatchers(context) {
    const cfg = vscode.workspace.getConfiguration('vai');
    if (!cfg.get('captureFileEdits', true))
        return;
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
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.uri.scheme !== 'file' || shouldExclude(doc.uri))
            return;
        fileVersions.set(doc.uri.fsPath, {
            lineCount: doc.lineCount,
            version: doc.version,
        });
    }));
    // ── Document save — emit file-edit with diff stats ──
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
        if (!(0, session_js_1.getActiveSession)())
            return;
        if (doc.uri.scheme !== 'file' || shouldExclude(doc.uri))
            return;
        const relativePath = vscode.workspace.asRelativePath(doc.uri);
        const prev = fileVersions.get(doc.uri.fsPath);
        const currentLines = doc.lineCount;
        let linesAdded = 0;
        let linesRemoved = 0;
        if (prev) {
            const diff = currentLines - prev.lineCount;
            if (diff > 0)
                linesAdded = diff;
            else
                linesRemoved = Math.abs(diff);
        }
        (0, session_js_1.pushEvent)('file-edit', `Saved ${relativePath} (+${linesAdded}/-${linesRemoved})`, {
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
    }));
    // ── File system watcher — creates and deletes ──
    const fsWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false);
    context.subscriptions.push(fsWatcher.onDidCreate((uri) => {
        if (!(0, session_js_1.getActiveSession)())
            return;
        if (shouldExclude(uri))
            return;
        const relativePath = vscode.workspace.asRelativePath(uri);
        (0, session_js_1.pushEvent)('file-create', `Created ${relativePath}`, {
            filePath: relativePath,
        });
    }));
    context.subscriptions.push(fsWatcher.onDidDelete((uri) => {
        if (!(0, session_js_1.getActiveSession)())
            return;
        if (shouldExclude(uri))
            return;
        const relativePath = vscode.workspace.asRelativePath(uri);
        (0, session_js_1.pushEvent)('file-delete', `Deleted ${relativePath}`, {
            filePath: relativePath,
        });
        fileVersions.delete(uri.fsPath);
    }));
    context.subscriptions.push(fsWatcher);
}
//# sourceMappingURL=capture-files.js.map