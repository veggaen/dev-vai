"use strict";
/**
 * VeggaAI Dev Logs — Status Bar
 *
 * Shows session status with live event counter in the VS Code status bar.
 * Recording indicator with animated dot when session is active.
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
exports.registerStatusBar = registerStatusBar;
const vscode = __importStar(require("vscode"));
const session_js_1 = require("./session.js");
const platform_auth_js_1 = require("./platform-auth.js");
/* ── State ─────────────────────────────────────────────────────── */
let statusBarItem;
/* ── Initialize ────────────────────────────────────────────────── */
function registerStatusBar(context) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);
    // Update on session changes
    context.subscriptions.push((0, session_js_1.onSessionChange)(() => updateStatusBar()), (0, session_js_1.onEventPushed)(() => updateStatusBar()), (0, platform_auth_js_1.onDidChangePlatformAuthState)(() => updateStatusBar()));
    updateStatusBar();
}
/* ── Update ────────────────────────────────────────────────────── */
function updateStatusBar() {
    const session = (0, session_js_1.getActiveSession)();
    const auth = (0, platform_auth_js_1.getPlatformAuthState)();
    const platformLine = auth.user
        ? `Platform: ${auth.user.email}`
        : auth.status === 'signing-in'
            ? 'Platform: connecting'
            : auth.error
                ? `Platform: ${auth.error}`
                : 'Platform: signed out';
    if (session) {
        const count = session.eventCount;
        const title = session.title.length > 25 ? session.title.slice(0, 25) + '…' : session.title;
        statusBarItem.text = `$(radio-tower) Vai: ${title} (${count})`;
        statusBarItem.tooltip = [
            `Session: ${session.title}`,
            `ID: ${session.id}`,
            `Events: ${count}`,
            `Buffered: ${session.eventBuffer.length}`,
            platformLine,
            '',
            'Click to end session',
        ].join('\n');
        statusBarItem.command = 'vai.endSession';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        statusBarItem.show();
    }
    else {
        statusBarItem.text = '$(circle-outline) Vai: No session';
        statusBarItem.tooltip = `${platformLine}\n\nClick to start a dev log session`;
        statusBarItem.command = 'vai.startSession';
        statusBarItem.backgroundColor = undefined;
        statusBarItem.show();
    }
}
//# sourceMappingURL=statusbar.js.map