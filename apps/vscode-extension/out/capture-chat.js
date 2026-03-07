"use strict";
/**
 * VeggaAI Event Capture — Chat Participant (@vai)
 *
 * Registers the @vai chat participant that:
 * 1. Proxies user messages to Copilot's language model
 * 2. Auto-logs both sides of the conversation
 * 3. Creates sessions on first message
 *
 * This is the INTERACTIVE capture layer — for when users actively use @vai.
 * The passive capture (files, terminals, editors) runs independently.
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
exports.handleChatRequest = handleChatRequest;
exports.registerChatParticipant = registerChatParticipant;
const vscode = __importStar(require("vscode"));
const session_js_1 = require("./session.js");
/* ── Chat Handler ──────────────────────────────────────────────── */
async function handleChatRequest(request, _context, stream, token) {
    const autoStart = vscode.workspace.getConfiguration('vai').get('autoStartSession', true);
    // Auto-create session on first @vai message
    if (!(0, session_js_1.getActiveSession)() && autoStart) {
        try {
            await (0, session_js_1.createSession)(request.prompt);
            stream.markdown(`*Dev Logs session started: ${(0, session_js_1.getActiveSession)().title}*\n\n---\n\n`);
        }
        catch {
            stream.markdown('*⚠️ Could not connect to VeggaAI runtime (port 3006). Logging disabled.*\n\n---\n\n');
        }
    }
    // Log user message
    (0, session_js_1.pushEvent)('message', request.prompt, { role: 'user' });
    // Use VS Code's Language Model API to get Copilot response
    let responseText = '';
    try {
        const [model] = await vscode.lm.selectChatModels({
            vendor: 'copilot',
            family: 'gpt-4o',
        });
        if (!model) {
            stream.markdown('No Copilot model available. Make sure GitHub Copilot is active.');
            (0, session_js_1.pushEvent)('error', 'No Copilot model available', { errorType: 'model' });
            return {};
        }
        const messages = [vscode.LanguageModelChatMessage.User(request.prompt)];
        const chatResponse = await model.sendRequest(messages, {}, token);
        for await (const fragment of chatResponse.text) {
            stream.markdown(fragment);
            responseText += fragment;
        }
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.includes('off_topic')) {
            stream.markdown("I can't help with that topic.");
        }
        else {
            stream.markdown(`Error: ${errorMsg}`);
        }
        (0, session_js_1.pushEvent)('error', `Chat error: ${errorMsg}`, { errorType: 'model' });
        return {};
    }
    // Log assistant response
    if (responseText) {
        (0, session_js_1.pushEvent)('message', responseText, { role: 'assistant' });
    }
    return {};
}
/* ── Register Participant ──────────────────────────────────────── */
function registerChatParticipant(context) {
    const participant = vscode.chat.createChatParticipant('vai.devlogs', handleChatRequest);
    participant.iconPath = new vscode.ThemeIcon('radio-tower');
    context.subscriptions.push(participant);
}
//# sourceMappingURL=capture-chat.js.map