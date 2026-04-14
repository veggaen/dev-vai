"use strict";
/**
 * VeggaAI Event Capture — Terminal Watchers
 *
 * Tracks:
 * - Terminal open/close events
 * - Shell integration: command start, command end, output
 * - Terminal data (command text) via shell integration API
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
exports.registerTerminalWatchers = registerTerminalWatchers;
const vscode = __importStar(require("vscode"));
const session_js_1 = require("./session.js");
/* ── State ─────────────────────────────────────────────────────── */
/** Map terminal name → last known command for dedup */
const terminalCommands = new Map();
/* ── Register Watchers ─────────────────────────────────────────── */
function registerTerminalWatchers(context) {
    const cfg = vscode.workspace.getConfiguration('vai');
    if (!cfg.get('captureTerminal', true))
        return;
    // ── Terminal open ──
    context.subscriptions.push(vscode.window.onDidOpenTerminal((terminal) => {
        if (!(0, session_js_1.getActiveSession)())
            return;
        (0, session_js_1.pushEvent)('note', `Terminal opened: ${terminal.name}`, {
            terminalName: terminal.name,
        });
    }));
    // ── Terminal close ──
    context.subscriptions.push(vscode.window.onDidCloseTerminal((terminal) => {
        if (!(0, session_js_1.getActiveSession)())
            return;
        (0, session_js_1.pushEvent)('note', `Terminal closed: ${terminal.name}`, {
            terminalName: terminal.name,
        });
        terminalCommands.delete(terminal.name);
    }));
    // ── Shell Integration: Command Start ──
    // This fires when VS Code detects a command has started executing in a terminal
    context.subscriptions.push(vscode.window.onDidStartTerminalShellExecution((e) => {
        if (!(0, session_js_1.getActiveSession)())
            return;
        const commandLine = e.execution.commandLine;
        if (!commandLine)
            return;
        // Get the command text
        const cmd = typeof commandLine === 'string' ? commandLine : commandLine.value;
        if (!cmd || cmd.trim().length === 0)
            return;
        // Skip duplicate commands (same terminal, same command)
        const key = e.terminal.name;
        if (terminalCommands.get(key) === cmd)
            return;
        terminalCommands.set(key, cmd);
        (0, session_js_1.pushEvent)('terminal', `$ ${cmd}`, {
            command: cmd,
            terminalName: e.terminal.name,
        });
    }));
    // ── Shell Integration: Command End ──
    context.subscriptions.push(vscode.window.onDidEndTerminalShellExecution((e) => {
        if (!(0, session_js_1.getActiveSession)())
            return;
        const commandLine = e.execution.commandLine;
        if (!commandLine)
            return;
        const cmd = typeof commandLine === 'string' ? commandLine : commandLine.value;
        if (!cmd)
            return;
        const exitCode = e.exitCode;
        if (exitCode !== undefined && exitCode !== 0) {
            (0, session_js_1.pushEvent)('terminal', `Command failed (exit ${exitCode}): ${cmd}`, {
                command: cmd,
                exitCode,
                terminalName: e.terminal.name,
            });
        }
    }));
    // ── Terminal active change (track which terminal is focused) ──
    context.subscriptions.push(vscode.window.onDidChangeActiveTerminal((terminal) => {
        if (!(0, session_js_1.getActiveSession)() || !terminal)
            return;
        // Don't push this as it's too noisy — just track internally
    }));
}
//# sourceMappingURL=capture-terminal.js.map