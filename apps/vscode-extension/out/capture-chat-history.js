"use strict";
/**
 * VeggaAI Auto-Capture — Chat History Watcher (v0.6.0)
 *
 * Monitors VS Code's internal chat session JSONL files and automatically
 * extracts + pushes ALL conversation content to Dev Logs.
 *
 * HOW IT WORKS:
 * VS Code stores all chat conversations in append-only JSONL files at:
 *   <workspaceStorage>/<hash>/chatSessions/<sessionId>.jsonl
 *
 * Each line is a JSON patch. Content comes in these forms:
 *   - `requests` (kind=2, array) — full request objects with `message.text` (user message)
 *   - `requests.N.response` (kind=2, array) — response patches containing:
 *       - kind: "thinking" — AI reasoning blocks
 *       - kind: "toolInvocationSerialized" — tool calls (file edits, terminal, etc.)
 *       - no kind + value string — assistant text responses
 *   - `inputState.inputText` (kind=1) — real-time user typing (used as fallback)
 *
 * This module captures:
 * 1. User messages (from `requests` → `message.text`)
 * 2. Thinking/reasoning blocks
 * 3. Assistant response text
 * 4. Tool invocations (file edits, searches, terminal commands)
 *
 * ZERO MANUAL INTERVENTION. Full conversation is captured transparently.
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
exports.registerChatHistoryWatcher = registerChatHistoryWatcher;
exports.getAvailableChatSessions = getAvailableChatSessions;
exports.disposeChatHistoryWatcher = disposeChatHistoryWatcher;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const session_js_1 = require("./session.js");
const api_js_1 = require("./api.js");
/* ── State ─────────────────────────────────────────────────────── */
let chatSessionsDir = null;
let fileWatcher = null;
let pollInterval = null;
const trackedFiles = new Map();
const debounceTimers = new Map();
let disposed = false;
let lastSeenVSCodeSessionId = null; // Track which VS Code chat we're in
let lastSeenVSCodeTitle = null; // Track the VS Code chat title for sync
// Map: VS Code chat sessionId → dev logs session ID
// This enables switching between VS Code chats and routing events to the correct dev logs session.
const vscodeToDevLogs = new Map();
// Dedup: avoid pushing the same content twice
// Key = hash of first N chars of content
const pushedHashes = new Set();
const MAX_HASH_CACHE = 5000;
const pendingResponses = new Map();
const RESPONSE_SETTLE_MS = 2000; // Wait 2s after last fragment — reduced from 4s to catch rapid exchanges
const preSessionQueue = [];
let sessionListenerRegistered = false;
function addHash(hash) {
    if (pushedHashes.size > MAX_HASH_CACHE) {
        const first = pushedHashes.values().next().value;
        if (first)
            pushedHashes.delete(first);
    }
    pushedHashes.add(hash);
}
/* ── Init ──────────────────────────────────────────────────────── */
/**
 * Start watching VS Code's chat history for new reasoning blocks.
 * Call this from extension.ts activate() after session manager is ready.
 */
function registerChatHistoryWatcher(context) {
    // Derive the chatSessions directory from the extension's storage URI.
    // context.storageUri = .../workspaceStorage/<hash>/v3gga.vai-devlogs/
    // chatSessions = .../workspaceStorage/<hash>/chatSessions/
    const storageUri = context.storageUri;
    if (!storageUri) {
        console.log('[vai:chat-history] No storageUri — cannot watch chat history');
        return;
    }
    const workspaceStorageRoot = path.dirname(storageUri.fsPath);
    chatSessionsDir = path.join(workspaceStorageRoot, 'chatSessions');
    if (!fs.existsSync(chatSessionsDir)) {
        console.log(`[vai:chat-history] chatSessions dir not found: ${chatSessionsDir}`);
        // It might be created later when a chat session starts
        // Watch the parent for its creation
        watchForDirectoryCreation(workspaceStorageRoot, context);
        return;
    }
    startWatching(context);
}
/* ── Directory Creation Watch ──────────────────────────────────── */
function watchForDirectoryCreation(parentDir, context) {
    try {
        const watcher = fs.watch(parentDir, (eventType, filename) => {
            if (filename === 'chatSessions' && chatSessionsDir && fs.existsSync(chatSessionsDir)) {
                watcher.close();
                startWatching(context);
            }
        });
        context.subscriptions.push({ dispose: () => watcher.close() });
    }
    catch (err) {
        console.error('[vai:chat-history] Failed to watch parent dir:', err);
    }
}
/* ── Start Watching ────────────────────────────────────────────── */
function startWatching(context) {
    if (!chatSessionsDir || disposed)
        return;
    console.log(`[vai:chat-history] Watching: ${chatSessionsDir}`);
    // Initial scan — find existing JSONL files and record their current size
    // (so we only capture NEW content going forward, not replaying history)
    try {
        const files = fs.readdirSync(chatSessionsDir).filter(f => f.endsWith('.jsonl'));
        // Sort by modification time to find the most recent chat
        const sortedFiles = files.map(file => {
            const fp = path.join(chatSessionsDir, file);
            const stat = fs.statSync(fp);
            return { file, filePath: fp, stat };
        }).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
        for (const { file, filePath: fp, stat } of sortedFiles) {
            trackedFiles.set(file, {
                filePath: fp,
                bytesRead: stat.size, // Start from current end — don't replay
                lastModified: stat.mtimeMs,
            });
        }
        // Read the header of the most recent file to know current VS Code session ID
        if (sortedFiles.length > 0) {
            const newestFile = sortedFiles[0];
            try {
                const fd = fs.openSync(newestFile.filePath, 'r');
                const headerBuf = Buffer.alloc(Math.min(16384, newestFile.stat.size));
                fs.readSync(fd, headerBuf, 0, headerBuf.length, 0);
                fs.closeSync(fd);
                const firstLine = headerBuf.toString('utf8').split('\n')[0];
                if (firstLine) {
                    const header = JSON.parse(firstLine);
                    if (header.kind === 0 && header.v?.sessionId) {
                        lastSeenVSCodeSessionId = header.v.sessionId;
                        lastSeenVSCodeTitle = header.v.customTitle || null;
                        // Also set vscodeSessionId on the tracked file so routing works after reload
                        const tracked = trackedFiles.get(newestFile.file);
                        if (tracked) {
                            tracked.vscodeSessionId = header.v.sessionId;
                        }
                        console.log(`[vai:chat-history] Current VS Code chat: "${header.v.customTitle || 'untitled'}" (${header.v.sessionId})`);
                    }
                }
            }
            catch (err) {
                console.warn(`[vai:chat-history] Header parse failed for newest file — will detect on next content`, err);
            }
        }
        console.log(`[vai:chat-history] Tracking ${files.length} existing JSONL files (starting from current position)`);
    }
    catch (err) {
        console.error('[vai:chat-history] Error scanning directory:', err);
    }
    // ── Listen for session becoming available ──
    // The extension restores/creates the session ~2s after activation.
    // We need to map the current VS Code chat to it and replay any queued events.
    if (!sessionListenerRegistered) {
        sessionListenerRegistered = true;
        const disposable = (0, session_js_1.onSessionChange)((session) => {
            if (!session)
                return;
            // Map the current VS Code chat to this newly available session
            if (lastSeenVSCodeSessionId && !vscodeToDevLogs.has(lastSeenVSCodeSessionId)) {
                vscodeToDevLogs.set(lastSeenVSCodeSessionId, session.id);
                console.log(`[vai:chat-history] 🔗 Mapped current VS Code chat ${lastSeenVSCodeSessionId} → session ${session.id} (on session restore)`);
            }
            // ── TITLE SYNC: VS Code chat name always wins ──
            // On session restore/attach, sync the VS Code chat title to the dev logs session.
            // This overrides whatever title the agent set via session-bridge.mjs.
            if (lastSeenVSCodeTitle && lastSeenVSCodeTitle !== session.title) {
                void (async () => {
                    try {
                        await (0, api_js_1.apiCall)(`/api/sessions/${session.id}`, 'PATCH', {
                            title: lastSeenVSCodeTitle,
                            description: session.title !== lastSeenVSCodeTitle ? `Agent: ${session.title}` : undefined,
                        });
                        console.log(`[vai:chat-history] 📝 Synced VS Code chat title: "${lastSeenVSCodeTitle}" (was: "${session.title}")`);
                    }
                    catch (err) {
                        console.warn(`[vai:chat-history] ⚠️ Failed to sync VS Code title:`, err);
                    }
                })();
            }
            // Replay any queued events that arrived before session was ready
            if (preSessionQueue.length > 0) {
                console.log(`[vai:chat-history] 📤 Replaying ${preSessionQueue.length} queued events`);
                for (const queued of preSessionQueue) {
                    try {
                        queued.handler();
                    }
                    catch (err) {
                        console.warn(`[vai:chat-history] Failed to replay queued event (${queued.description}):`, err);
                    }
                }
                preSessionQueue.length = 0;
            }
        });
        context.subscriptions.push(disposable);
    }
    // Watch for changes via fs.watch (may be unreliable on Windows for large files)
    try {
        fileWatcher = fs.watch(chatSessionsDir, (eventType, filename) => {
            if (!filename || !filename.endsWith('.jsonl') || disposed)
                return;
            // If this is a new file we haven't seen, start tracking from byte 0
            if (!trackedFiles.has(filename)) {
                const fp = path.join(chatSessionsDir, filename);
                try {
                    const stat = fs.statSync(fp);
                    trackedFiles.set(filename, {
                        filePath: fp,
                        bytesRead: 0, // Read from start to capture header
                        lastModified: stat.mtimeMs,
                    });
                    console.log(`[vai:chat-history] 🆕 New JSONL file via fs.watch: ${filename}`);
                }
                catch { /* file may not exist yet */ }
            }
            scheduleRead(filename);
        });
        context.subscriptions.push({ dispose: () => disposeChatHistoryWatcher() });
    }
    catch (err) {
        console.error('[vai:chat-history] Failed to watch directory:', err);
    }
    // Polling fallback: fs.watch on Windows can silently fail for large files
    // in AppData directories. Poll every 3s to catch what fs.watch misses.
    startPolling();
    context.subscriptions.push({ dispose: () => stopPolling() });
}
/* ── Polling Fallback ───────────────────────────────────────────── */
const POLL_INTERVAL_MS = 3000;
function startPolling() {
    if (pollInterval)
        return;
    pollInterval = setInterval(() => {
        if (disposed || !chatSessionsDir)
            return;
        pollForChanges();
    }, POLL_INTERVAL_MS);
}
function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}
function pollForChanges() {
    if (!chatSessionsDir)
        return;
    try {
        // Scan for new or changed JSONL files
        const files = fs.readdirSync(chatSessionsDir).filter(f => f.endsWith('.jsonl'));
        for (const file of files) {
            const filePath = path.join(chatSessionsDir, file);
            try {
                const stat = fs.statSync(filePath);
                const tracked = trackedFiles.get(file);
                if (!tracked) {
                    // New JSONL file = new VS Code chat conversation!
                    trackedFiles.set(file, {
                        filePath,
                        bytesRead: 0,
                        lastModified: stat.mtimeMs,
                    });
                    console.log(`[vai:chat-history:poll] New JSONL file discovered: ${file} — reading from start`);
                    scheduleRead(file);
                    continue;
                }
                // Check if file has grown since last read
                if (stat.size > tracked.bytesRead) {
                    scheduleRead(file);
                }
            }
            catch {
                // File deleted or inaccessible
            }
        }
    }
    catch {
        // Directory inaccessible
    }
}
/* ── Debounced Read ────────────────────────────────────────────── */
function scheduleRead(filename) {
    // Debounce: VS Code writes rapidly during streaming responses.
    // Wait 800ms after last write to batch-read new content.
    // Lower debounce = fewer missed messages during rapid exchanges.
    const existing = debounceTimers.get(filename);
    if (existing)
        clearTimeout(existing);
    debounceTimers.set(filename, setTimeout(() => {
        debounceTimers.delete(filename);
        void readNewContent(filename);
    }, 800));
}
/* ── Read New Content ──────────────────────────────────────────── */
async function readNewContent(filename) {
    if (!chatSessionsDir || disposed)
        return;
    const filePath = path.join(chatSessionsDir, filename);
    if (!fs.existsSync(filePath))
        return;
    const stat = fs.statSync(filePath);
    const tracked = trackedFiles.get(filename);
    const startByte = tracked?.bytesRead ?? 0;
    // No new content
    if (stat.size <= startByte)
        return;
    // Preserve existing vscodeSessionId when updating tracking
    const existingVscodeSessionId = tracked?.vscodeSessionId;
    trackedFiles.set(filename, {
        filePath,
        bytesRead: stat.size,
        lastModified: stat.mtimeMs,
        vscodeSessionId: existingVscodeSessionId,
    });
    // Read only the new bytes
    try {
        const newBytes = stat.size - startByte;
        const buffer = Buffer.alloc(newBytes);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buffer, 0, newBytes, startByte);
        fs.closeSync(fd);
        const newContent = buffer.toString('utf8');
        const lines = newContent.split('\n').filter(line => line.trim().length > 0);
        // Before processing content, switch to the correct dev logs session for this file's VS Code chat.
        // This ensures events from different VS Code chats go to their respective dev logs sessions.
        const fileVscodeId = trackedFiles.get(filename)?.vscodeSessionId;
        if (fileVscodeId) {
            await ensureCorrectDevLogsSession(fileVscodeId);
        }
        for (const line of lines) {
            try {
                const obj = JSON.parse(line);
                await processJsonlLine(obj, filename);
            }
            catch {
                // Partial line (streaming in progress) — will be picked up on next read
            }
        }
    }
    catch (err) {
        console.error('[vai:chat-history] Error reading new content:', err);
    }
}
/* ── Session Routing Helpers ────────────────────────────────────── */
/**
 * Ensure the active dev logs session matches the given VS Code chat.
 * If the active session is already the correct one, does nothing.
 * If a different VS Code chat's session should be active, switches via attachToSession.
 */
async function ensureCorrectDevLogsSession(vscodeSessionId) {
    const mappedId = vscodeToDevLogs.get(vscodeSessionId);
    if (!mappedId)
        return; // Not mapped yet — will be handled when header is processed
    const current = (0, session_js_1.getActiveSession)();
    if (current?.id === mappedId)
        return; // Already correct
    console.log(`[vai:chat-history] 🔄 Switching dev logs session to ${mappedId} for VS Code chat ${vscodeSessionId}`);
    const ok = await (0, session_js_1.attachToSession)(mappedId, `VS Code Chat`);
    if (!ok) {
        console.warn(`[vai:chat-history] ⚠️ Failed to switch to session ${mappedId} — it may have ended`);
        vscodeToDevLogs.delete(vscodeSessionId); // Clear stale mapping
    }
}
/**
 * Write `.vai-session` file so session-bridge.mjs can discover the active session.
 */
function writeVaiSessionFile(sessionId, title) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
        const vaiSessionPath = path.join(workspaceRoot, '.vai-session');
        fs.writeFileSync(vaiSessionPath, JSON.stringify({ id: sessionId, title }, null, 2));
        console.log(`[vai:chat-history] 📝 Wrote .vai-session for session ${sessionId}`);
    }
}
/**
 * Create a new dev logs session for a genuinely new VS Code chat.
 * Returns the session ID for mapping, or null on failure.
 */
async function createNewChatSession(title, vscodeSessionId) {
    try {
        const sessionId = await (0, session_js_1.createSession)(title);
        console.log(`[vai:chat-history] ✅ Created dev logs session ${sessionId} for chat: "${title}"`);
        // Map + write .vai-session
        vscodeToDevLogs.set(vscodeSessionId, sessionId);
        writeVaiSessionFile(sessionId, title);
        (0, session_js_1.pushEvent)('state-change', `New chat: ${title}`, {
            state: 'New chat',
            detail: title,
            vscodeSessionId,
            source: 'chat-history-watcher',
            autoCapture: true,
        });
        return sessionId;
    }
    catch (err) {
        console.error(`[vai:chat-history] Failed to create session for new chat:`, err);
        return null;
    }
}
/* ── Response Text Buffering ────────────────────────────────────── */
/**
 * Buffer response text for a given request index.
 * Each VS Code streaming response sends many incremental patches, each containing
 * the full (growing) array of response items. Instead of pushing every fragment,
 * we keep only the LATEST (longest) combined text per request and flush after
 * streaming settles (RESPONSE_SETTLE_MS with no new updates).
 */
function bufferResponseText(requestIndex, combinedText) {
    const existing = pendingResponses.get(requestIndex);
    // Only update if new text is longer — later patches have ALL previous content plus new
    if (existing && combinedText.length <= existing.combinedText.length)
        return;
    // Clear existing timer
    if (existing?.timer)
        clearTimeout(existing.timer);
    const timer = setTimeout(() => {
        const pending = pendingResponses.get(requestIndex);
        if (pending) {
            pendingResponses.delete(requestIndex);
            handleResponseText(pending.combinedText);
        }
    }, RESPONSE_SETTLE_MS);
    pendingResponses.set(requestIndex, { combinedText, timer });
}
/**
 * Flush all buffered response texts immediately.
 * Called when: 1) a new user message arrives (turn boundary), 2) extension disposes.
 */
function flushPendingResponses() {
    for (const [index, pending] of pendingResponses) {
        if (pending.timer)
            clearTimeout(pending.timer);
        handleResponseText(pending.combinedText);
    }
    pendingResponses.clear();
}
/* ── Process JSONL Line ────────────────────────────────────────── */
async function processJsonlLine(obj, filename) {
    const record = obj;
    // ── Chat session header (kind: 0) — VS Code chat identity ──
    // Format: { kind: 0, v: { customTitle: "...", sessionId: "...", ... } }
    // This is the FIRST line in every JSONL file and identifies which VS Code chat this is.
    if (record.kind === 0 && record.v && typeof record.v === 'object') {
        const header = record.v;
        const customTitle = header.customTitle;
        const vscodeSessionId = header.sessionId;
        if (!vscodeSessionId)
            return;
        // Store the VS Code session ID on the tracked file for future routing
        if (filename) {
            const tracked = trackedFiles.get(filename);
            if (tracked) {
                tracked.vscodeSessionId = vscodeSessionId;
            }
        }
        const title = customTitle || 'VS Code Chat Session';
        const isNewChat = vscodeSessionId !== lastSeenVSCodeSessionId;
        lastSeenVSCodeSessionId = vscodeSessionId;
        lastSeenVSCodeTitle = customTitle || null; // Always update for future syncs
        // ── Case 1: Already mapped — switch to its dev logs session ──
        const mappedId = vscodeToDevLogs.get(vscodeSessionId);
        if (mappedId) {
            const current = (0, session_js_1.getActiveSession)();
            if (current?.id !== mappedId) {
                console.log(`[vai:chat-history] 🔄 Switching to dev logs session ${mappedId} for VS Code chat: "${title}"`);
                const ok = await (0, session_js_1.attachToSession)(mappedId, title);
                if (!ok) {
                    console.warn(`[vai:chat-history] ⚠️ Session ${mappedId} ended — creating new one for "${title}"`);
                    vscodeToDevLogs.delete(vscodeSessionId);
                    await createNewChatSession(title, vscodeSessionId);
                }
                else {
                    writeVaiSessionFile(mappedId, title);
                }
            }
            return; // Header processed
        }
        // ── Case 2: Not mapped yet — first time seeing this VS Code chat ──
        if (isNewChat) {
            console.log(`[vai:chat-history] 🆕 New VS Code chat detected: "${title}" (${vscodeSessionId})`);
        }
        const existing = (0, session_js_1.getActiveSession)();
        const sessionAge = existing ? Date.now() - existing.createdAt : Infinity;
        if (existing && sessionAge < 120_000 && !vscodeToDevLogs.has(vscodeSessionId)) {
            // Recent session (likely from session-bridge) — adopt it for this VS Code chat
            vscodeToDevLogs.set(vscodeSessionId, existing.id);
            console.log(`[vai:chat-history] ♻️ Mapped VS Code chat "${title}" → existing session ${existing.id} (age: ${Math.round(sessionAge / 1000)}s)`);
            // Sync the title from VS Code to the dev logs session — VS Code chat name always wins
            try {
                const patchBody = { title };
                // Preserve the agent's original title as description so both names are visible
                if (existing.title && existing.title !== title) {
                    patchBody.description = `Agent session: ${existing.title}`;
                }
                await (0, api_js_1.apiCall)(`/api/sessions/${existing.id}`, 'PATCH', patchBody);
                console.log(`[vai:chat-history] 📝 Synced title to "${title}" on session ${existing.id}`);
            }
            catch (err) {
                console.warn(`[vai:chat-history] Failed to sync title:`, err);
            }
            writeVaiSessionFile(existing.id, title);
            (0, session_js_1.pushEvent)('state-change', `Chat: ${title}`, {
                state: 'Mapped VS Code chat',
                detail: title,
                vscodeSessionId,
                devLogsSessionId: existing.id,
                source: 'chat-history-watcher',
                autoCapture: true,
                reusedSession: true,
            });
        }
        else if (!existing || sessionAge >= 120_000) {
            // No session or old one — genuinely new chat, create a new dev logs session
            await createNewChatSession(title, vscodeSessionId);
        }
        return; // Header line — no content events to extract
    }
    if (!Array.isArray(record.k))
        return;
    const keyPath = record.k.map((x) => typeof x === 'number' ? 'N' : x).join('.');
    // ── Full request objects (user messages + metadata) ──
    // Format: kind=2, k=["requests"], v=[{message: {text: "..."}, requestId, timestamp, response, ...}]
    if (record.kind === 2 && keyPath === 'requests' && Array.isArray(record.v)) {
        const requests = record.v;
        for (let i = 0; i < requests.length; i++) {
            const req = requests[i];
            if (!req || typeof req !== 'object')
                continue;
            // User message: req.message.text
            const reqMsg = req.message;
            if (reqMsg?.text && typeof reqMsg.text === 'string' && reqMsg.text.length > 0) {
                handleUserMessage(reqMsg.text);
            }
            // If this request already has inline response data, process it using buffered approach
            if (Array.isArray(req.response)) {
                const responseItems = req.response;
                // Process thinking and tool invocations immediately
                for (const item of responseItems) {
                    if (!item || typeof item !== 'object')
                        continue;
                    if (item.kind === 'thinking' && item.value && item.value.length > 0) {
                        handleThinkingBlock(item);
                    }
                    if (item.kind === 'toolInvocationSerialized') {
                        handleToolInvocation(item);
                    }
                }
                // Combine text response items and buffer (don't push fragments)
                const textItems = responseItems.filter((item) => item && typeof item === 'object' && !('kind' in item) &&
                    item.value && typeof item.value === 'string' && item.value.length > 30);
                if (textItems.length > 0) {
                    const combinedText = textItems.map((item) => item.value).join('\n\n');
                    bufferResponseText(i, combinedText);
                }
            }
        }
    }
    // ── Response patches (thinking, text, tool invocations) ──
    // Format: kind=2, k=["requests", N, "response"], v=[{kind: "thinking", value: "..."}, ...]
    // N = request index (preserved from the original k array)
    if (record.kind === 2 && keyPath === 'requests.N.response' && Array.isArray(record.v)) {
        const kArray = record.k;
        const requestIndex = typeof kArray[1] === 'number' ? kArray[1] : 0;
        const items = record.v;
        // Process thinking and tool invocations immediately
        for (const item of items) {
            if (!item || typeof item !== 'object')
                continue;
            if (item.kind === 'thinking' && item.value && item.value.length > 0) {
                handleThinkingBlock(item);
            }
            if (item.kind === 'toolInvocationSerialized') {
                handleToolInvocation(item);
            }
        }
        // Combine ALL text response items into ONE and buffer
        // This prevents 10-20 fragment messages per assistant turn
        const textItems = items.filter((item) => item && typeof item === 'object' && !('kind' in item) &&
            item.value && typeof item.value === 'string' && item.value.length > 30);
        if (textItems.length > 0) {
            const combinedText = textItems.map((item) => item.value).join('\n\n');
            bufferResponseText(requestIndex, combinedText);
        }
    }
    // ── User typing (fallback — inputState.inputText) ──
    // These fire per-keystroke. We only capture the longest one before it resets.
    // The `requests` handler above is the primary source for user messages.
    if (record.kind === 1 && keyPath === 'inputState.inputText' && typeof record.v === 'string') {
        trackInputText(record.v);
    }
}
/* ── Process Response Item ─────────────────────────────────────── */
// NOTE: processResponseItem was removed. Thinking blocks, tool invocations, and text responses
// are now handled directly in processJsonlLine — text responses use the buffered approach
// (bufferResponseText + flushPendingResponses) to avoid fragment spam.
/* ── Handle Thinking Block ─────────────────────────────────────── */
function handleThinkingBlock(block) {
    // Skip empty/done markers (these have empty value and vscodeReasoningDone: true)
    if (!block.value || block.value.trim().length === 0)
        return;
    // Skip very short thinking (noise) — but keep everything substantial
    if (block.value.length < 20)
        return;
    // Dedup check
    const hash = simpleHash(block.value.substring(0, 200));
    if (pushedHashes.has(hash))
        return;
    addHash(hash);
    // Only push if we have an active session
    if (!(0, session_js_1.getActiveSession)())
        return;
    const title = block.generatedTitle || block.value.substring(0, 80).replace(/\n/g, ' ') + '...';
    (0, session_js_1.pushEvent)('thinking', block.value, {
        source: 'chat-history-watcher',
        thinkingId: block.id || undefined,
        generatedTitle: block.generatedTitle || undefined,
        charCount: block.value.length,
        autoCapture: true,
    });
    // Emit a state-change from thinking blocks to show agent is actively reasoning
    // Only for substantial thinking (longer blocks = real analysis, not quick checks)
    if (block.value.length > 100) {
        const statusLine = block.generatedTitle || block.value.substring(0, 60).replace(/\n/g, ' ').trim();
        (0, session_js_1.pushEvent)('state-change', `Thinking...\n${statusLine}`, {
            state: 'Thinking...',
            detail: statusLine,
            source: 'chat-history-watcher',
            autoCapture: true,
        });
    }
    console.log(`[vai:chat-history] Captured thinking block (${block.value.length} chars): ${title}`);
}
/* ── Plan Detection in Responses ───────────────────────────────── */
/**
 * Detect structured plans in assistant text and emit a planning event.
 * Looks for numbered step patterns (1. ... 2. ... 3+...) preceded by
 * a heading/intent line. Only fires if ≥3 numbered steps are found.
 */
function detectPlanInResponse(text) {
    // Only scan first 3000 chars — plans appear early in responses
    const snippet = text.substring(0, 3000);
    // Find numbered steps: "1. ...", "2. ...", etc. (at line start or after whitespace)
    const stepMatches = snippet.match(/(?:^|\n)\s*(\d+)\.\s+(.+)/g);
    if (!stepMatches || stepMatches.length < 3)
        return;
    // Extract step texts
    const steps = [];
    for (const match of stepMatches) {
        const m = match.match(/(\d+)\.\s+(.+)/);
        if (m)
            steps.push(m[2].trim().substring(0, 120));
    }
    // Look for an intent/heading line before the first step
    const firstStepIndex = snippet.indexOf(stepMatches[0].trimStart());
    const textBefore = firstStepIndex > 0 ? snippet.substring(0, firstStepIndex).trim() : '';
    // Intent: grab the last non-empty line before the steps (heading / summary)
    const linesBeforeSteps = textBefore.split('\n').filter(l => l.trim().length > 5);
    const intent = linesBeforeSteps.length > 0
        ? linesBeforeSteps[linesBeforeSteps.length - 1].replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim().substring(0, 200)
        : `${steps.length}-step plan`;
    // Approach: if there's a line before the intent line, use it
    const approach = linesBeforeSteps.length > 1
        ? linesBeforeSteps[linesBeforeSteps.length - 2].replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim().substring(0, 200)
        : '';
    // Dedup by intent + step count
    const planHash = simpleHash(`plan:${intent}:${steps.length}`);
    if (pushedHashes.has(planHash))
        return;
    addHash(planHash);
    const summary = `Plan: ${intent} (${steps.length} steps)`;
    (0, session_js_1.pushEvent)('planning', summary, {
        intent,
        approach,
        steps,
        source: 'chat-history-watcher',
        autoCapture: true,
        detectedFrom: 'response-text',
    });
    console.log(`[vai:chat-history] 🧭 Detected plan: ${intent} (${steps.length} steps)`);
}
/* ── Handle Response Text ──────────────────────────────────────── */
function handleResponseText(text) {
    if (!(0, session_js_1.getActiveSession)())
        return;
    // Skip very short responses (noise / partial renders)
    if (text.length < 50)
        return;
    // Dedup check — use first 300 chars (response text can be long)
    const hash = simpleHash(text.substring(0, 300));
    if (pushedHashes.has(hash))
        return;
    addHash(hash);
    // Capture full responses — dev logs should have 100% of the content
    // Only truncate truly massive single responses (>100KB)
    const MAX_RESPONSE_LENGTH = 100_000;
    const content = text.length > MAX_RESPONSE_LENGTH
        ? text.substring(0, MAX_RESPONSE_LENGTH) + `\n\n[...truncated ${text.length - MAX_RESPONSE_LENGTH} chars]`
        : text;
    const preview = text.substring(0, 80).replace(/\n/g, ' ') + '...';
    // If no session yet (extension still starting up), queue for replay
    if (!(0, session_js_1.getActiveSession)()) {
        console.log(`[vai:chat-history] ⏳ No session yet — queuing assistant response (${text.length} chars)`);
        preSessionQueue.push({
            handler: () => {
                (0, session_js_1.pushEvent)('message', content, {
                    eventType: 'message',
                    role: 'assistant',
                    source: 'chat-history-watcher',
                    charCount: text.length,
                    truncated: text.length > MAX_RESPONSE_LENGTH,
                    autoCapture: true,
                    queued: true,
                });
            },
            description: `assistant response (${text.length} chars)`,
        });
        return;
    }
    (0, session_js_1.pushEvent)('message', content, {
        eventType: 'message',
        role: 'assistant',
        source: 'chat-history-watcher',
        charCount: text.length,
        truncated: text.length > MAX_RESPONSE_LENGTH,
        autoCapture: true,
    });
    // Extract status-like opening lines from response text
    // Patterns: "Working...", "Processing...", "Building UI...", etc.
    const STATUS_PATTERN = /^(Working|Processing|Building|Analyzing|Investigating|Fixing|Implementing|Creating|Setting up|Configuring|Debugging|Refactoring|Testing|Reviewing|Updating|Deploying|Preparing|Evaluating|Scanning|Resolving)[.…]+\s*\n?(.*)/i;
    const statusMatch = text.substring(0, 200).match(STATUS_PATTERN);
    if (statusMatch) {
        const statusVerb = statusMatch[1] + '...';
        const statusDetail = (statusMatch[2] || '').trim().substring(0, 80);
        (0, session_js_1.pushEvent)('state-change', `${statusVerb}\n${statusDetail}`, {
            state: statusVerb,
            detail: statusDetail,
            source: 'chat-history-watcher',
            autoCapture: true,
        });
        console.log(`[vai:chat-history] ⚡ state-change from response: ${statusVerb} — ${statusDetail}`);
    }
    // Detect structured plans in assistant responses
    // Look for numbered step lists (1. ... 2. ... 3. ...) with a preceding heading/intent
    detectPlanInResponse(text);
    console.log(`[vai:chat-history] Captured response text (${text.length} chars): ${preview}`);
}
/* ── Handle User Message ───────────────────────────────────────── */
function handleUserMessage(text) {
    // Flush any buffered assistant response — a new user message means the previous turn is complete
    flushPendingResponses();
    // Skip very short messages or system messages
    if (text.length < 5)
        return;
    // Dedup check
    const hash = simpleHash(text.substring(0, 300));
    if (pushedHashes.has(hash))
        return;
    addHash(hash);
    // If no session yet (extension still starting up), queue for replay
    if (!(0, session_js_1.getActiveSession)()) {
        console.log(`[vai:chat-history] ⏳ No session yet — queuing user message (${text.length} chars)`);
        preSessionQueue.push({
            handler: () => {
                (0, session_js_1.pushEvent)('message', text, {
                    eventType: 'message',
                    role: 'user',
                    source: 'chat-history-watcher',
                    charCount: text.length,
                    autoCapture: true,
                    queued: true,
                });
            },
            description: `user message (${text.length} chars)`,
        });
        return;
    }
    (0, session_js_1.pushEvent)('message', text, {
        eventType: 'message',
        role: 'user',
        source: 'chat-history-watcher',
        charCount: text.length,
        autoCapture: true,
    });
    // Detect frustration signals — emit a note so session analyzer can score outcome
    const FRUSTRATION_RE = /\b(?:no(?:pe)?|wrong|broken|doesn'?t work|still (?:broken|failing)|that'?s not right|not what I (?:meant|asked)|again|try again|same (?:issue|error|problem)|you'?re repeating|i(?:'ve)? (?:already|just) (?:told|said))\b/i;
    const SUCCESS_RE = /\b(?:thanks?|thank you|perfect|great|awesome|works?(?:ing)?|that(?:'s| is) (?:it|right|correct)|exactly|fixed|it (?:works?|runs?))\b/i;
    if (FRUSTRATION_RE.test(text)) {
        (0, session_js_1.pushEvent)('note', `[frustration] ${text.substring(0, 120)}`, {
            eventType: 'note',
            author: 'user-signal-detector',
            signalType: 'frustration',
            autoCapture: true,
            source: 'chat-history-watcher',
        });
    }
    else if (SUCCESS_RE.test(text)) {
        (0, session_js_1.pushEvent)('note', `[success] ${text.substring(0, 120)}`, {
            eventType: 'note',
            author: 'user-signal-detector',
            signalType: 'success',
            autoCapture: true,
            source: 'chat-history-watcher',
        });
    }
    console.log(`[vai:chat-history] Captured user message (${text.length} chars)`);
}
/* ── Handle Tool Invocation ────────────────────────────────────── */
// Maps VS Code Copilot tool IDs → dev-logs event types + metadata extractors
const TOOL_TYPE_MAP = {
    // ── Search tools → 'search' events ──
    'copilot_findTextInFiles': {
        type: 'search',
        extract: (item, msg) => {
            const results = item.resultDetails;
            return {
                searchType: 'grep',
                query: extractBetween(msg, '`', '`') || msg,
                resultCount: Array.isArray(results) ? results.length : undefined,
            };
        },
    },
    'copilot_findFiles': {
        type: 'search',
        extract: (_item, msg) => ({
            searchType: 'file',
            query: extractBetween(msg, '`', '`') || msg,
        }),
    },
    'copilot_searchCodebase': {
        type: 'search',
        extract: (_item, msg) => ({
            searchType: 'semantic',
            query: msg,
        }),
    },
    'search_subagent': {
        type: 'search',
        extract: (_item, msg) => ({
            searchType: 'subagent',
            query: msg,
        }),
    },
    // ── File tools → proper file event types ──
    'copilot_readFile': {
        type: 'file-read',
        extract: (_item, msg) => {
            const filePath = extractFilePath(msg);
            return { filePath: filePath || undefined };
        },
    },
    'copilot_replaceString': {
        type: 'file-edit',
        extract: (_item, msg) => {
            const filePath = extractFilePath(msg);
            return { filePath: filePath || undefined, editType: 'replace' };
        },
    },
    'copilot_multiReplaceString': {
        type: 'file-edit',
        extract: (_item, msg) => {
            const filePath = extractFilePath(msg);
            return { filePath: filePath || undefined, editType: 'multi-replace' };
        },
    },
    'copilot_createFile': {
        type: 'file-create',
        extract: (_item, msg) => {
            const filePath = extractFilePath(msg);
            return { filePath: filePath || undefined };
        },
    },
    // ── Terminal tools ──
    'run_in_terminal': {
        type: 'terminal',
        extract: (item, msg) => {
            const data = item.toolSpecificData || {};
            return {
                command: data.kind === 'terminal' ? msg : undefined,
                terminalId: data.terminalToolSessionId || undefined,
            };
        },
    },
    'get_terminal_output': { type: 'terminal' },
    'kill_terminal': { type: 'terminal' },
    // ── Todo ──
    'manage_todo_list': { type: 'todo-update' },
    // ── Context gathering tools ──
    'runSubagent': {
        type: 'context-gather',
        extract: (_item, msg) => ({ gatherType: 'subagent', query: msg }),
    },
    'copilot_fetchWebPage': {
        type: 'context-gather',
        extract: (_item, msg) => ({ gatherType: 'web', url: msg }),
    },
    'vscode_fetchWebPage_internal': {
        type: 'context-gather',
        extract: (_item, msg) => ({ gatherType: 'web', url: msg }),
    },
    // ── Error checking ──
    'copilot_getErrors': {
        type: 'state-change',
        extract: (_item, msg) => ({ state: 'error-check', detail: msg }),
    },
    // ── User interaction tools ──
    'ask_questions': {
        type: 'tool-call',
        extract: (_item, msg) => ({
            toolName: 'ask_questions',
            category: 'interaction',
            detail: msg,
        }),
    },
    // ── Tool discovery ──
    'tool_search_tool_regex': {
        type: 'tool-call',
        extract: (_item, msg) => ({
            toolName: 'tool_search',
            category: 'discovery',
            detail: msg,
        }),
    },
    // ── Semantic search ──
    'semantic_search': {
        type: 'search',
        extract: (_item, msg) => ({
            searchType: 'semantic',
            query: msg,
        }),
    },
    // ── Grep search ──
    'grep_search': {
        type: 'search',
        extract: (_item, msg) => ({
            searchType: 'grep',
            query: msg,
        }),
    },
    // ── File search ──
    'file_search': {
        type: 'search',
        extract: (_item, msg) => ({
            searchType: 'file',
            query: msg,
        }),
    },
    // ── Read file ──
    'read_file': {
        type: 'file-read',
        extract: (_item, msg) => {
            const filePath = extractFilePath(msg);
            return { filePath: filePath || undefined };
        },
    },
    // ── Create file ──
    'create_file': {
        type: 'file-create',
        extract: (_item, msg) => {
            const filePath = extractFilePath(msg);
            return { filePath: filePath || undefined };
        },
    },
    // ── Replace string in file ──
    'replace_string_in_file': {
        type: 'file-edit',
        extract: (_item, msg) => {
            const filePath = extractFilePath(msg);
            return { filePath: filePath || undefined, editType: 'replace' };
        },
    },
    // ── Multi-replace ──
    'multi_replace_string_in_file': {
        type: 'file-edit',
        extract: (_item, msg) => {
            const filePath = extractFilePath(msg);
            return { filePath: filePath || undefined, editType: 'multi-replace' };
        },
    },
    // ── List directory ──
    'list_dir': {
        type: 'file-read',
        extract: (_item, msg) => ({
            filePath: msg,
            readType: 'directory',
        }),
    },
    // ── Get errors ──
    'get_errors': {
        type: 'state-change',
        extract: (_item, msg) => ({ state: 'error-check', detail: msg }),
    },
};
function handleToolInvocation(item) {
    if (!(0, session_js_1.getActiveSession)())
        return;
    const toolId = item.toolId || '';
    const toolData = item.toolSpecificData || {};
    const msg = item.invocationMessage?.value || item.pastTenseMessage?.value || '';
    const cleanMsg = msg.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
    // ── Special: manage_todo_list has unique data format ──
    if (toolId === 'manage_todo_list' && (toolData.kind === 'todoList' || toolData.todoList)) {
        const todos = toolData.todoList || [];
        const completed = todos.filter(t => t.status === 'completed').length;
        const inProgress = todos.filter(t => t.status === 'in-progress').length;
        const summary = `Todos: ${completed}/${todos.length} completed` +
            (inProgress > 0 ? `, ${inProgress} in progress` : '');
        // Dedup: include all todo statuses for unique hash (not just completed count)
        const statusKey = todos.map(t => `${t.id}:${t.status}`).join(',');
        const hash = simpleHash(`todo-${statusKey}`);
        if (pushedHashes.has(hash))
            return;
        addHash(hash);
        (0, session_js_1.pushEvent)('todo-update', summary, {
            todos: todos.map(t => ({ id: t.id, title: t.title, status: t.status })),
            source: 'chat-history-watcher',
            autoCapture: true,
        });
        // Also emit a state-change for each in-progress todo → powers the "Status" panel
        const inProgressTodos = todos.filter(t => t.status === 'in-progress');
        if (inProgressTodos.length > 0) {
            const current = inProgressTodos[0];
            const statusLabel = completed > 0 ? 'Processing...' : 'Working...';
            (0, session_js_1.pushEvent)('state-change', `${statusLabel}\n${current.title}`, {
                state: statusLabel,
                detail: current.title,
                todosCompleted: completed,
                todosTotal: todos.length,
                source: 'chat-history-watcher',
                autoCapture: true,
            });
            console.log(`[vai:chat-history] ⚡ state-change: ${statusLabel} — ${current.title}`);
        }
        else if (completed === todos.length && todos.length > 0) {
            // All done
            (0, session_js_1.pushEvent)('state-change', `Completed\nAll ${todos.length} todos finished`, {
                state: 'Completed',
                detail: `All ${todos.length} todos finished`,
                todosCompleted: completed,
                todosTotal: todos.length,
                source: 'chat-history-watcher',
                autoCapture: true,
            });
            console.log(`[vai:chat-history] ⚡ state-change: Completed — ${todos.length} todos`);
        }
        console.log(`[vai:chat-history] ✅ todo-update: ${summary}`);
        return;
    }
    // Skip if no meaningful message
    if (!cleanMsg || cleanMsg.length < 5)
        return;
    // Dedup check
    const hash = simpleHash(cleanMsg.substring(0, 200));
    if (pushedHashes.has(hash))
        return;
    addHash(hash);
    // ── Look up tool type mapping ──
    const mapping = TOOL_TYPE_MAP[toolId];
    if (mapping) {
        const extraMeta = mapping.extract ? mapping.extract(item, cleanMsg) : {};
        (0, session_js_1.pushEvent)(mapping.type, cleanMsg, {
            source: 'chat-history-watcher',
            toolId,
            autoCapture: true,
            ...extraMeta,
        });
        console.log(`[vai:chat-history] ✅ ${mapping.type}: ${cleanMsg.substring(0, 80)}`);
        return;
    }
    // ── Fallback: unknown tools → generic tool-call ──
    (0, session_js_1.pushEvent)('tool-call', cleanMsg, {
        source: 'chat-history-watcher',
        toolId: toolId || undefined,
        confirmed: item.isConfirmed !== false,
        autoCapture: true,
    });
    console.log(`[vai:chat-history] 🔧 tool-call (${toolId}): ${cleanMsg.substring(0, 80)}`);
}
/* ── Tool Invocation Helpers ──────────────────────────────────── */
/** Extract text between delimiters (e.g. backticks) */
function extractBetween(text, open, close) {
    const start = text.indexOf(open);
    if (start === -1)
        return '';
    const end = text.indexOf(close, start + open.length);
    if (end === -1)
        return '';
    return text.substring(start + open.length, end);
}
/** Extract file path from tool invocation message */
function extractFilePath(msg) {
    // Messages contain paths like: "Reading /c:/Users/.../file.ts, lines 17 to 57"
    // or "Edited c:\Users\...\file.ts"
    const patterns = [
        /(?:Reading|Read|Editing|Edited|Created|Creating)\s+([^\s,]+)/i,
        /file:\/\/\/([^\s#)]+)/i,
        /([a-zA-Z]:[/\\][^\s,)]+\.\w+)/,
        /(\/?[^\s,)]+\.\w+)/,
    ];
    for (const p of patterns) {
        const m = msg.match(p);
        if (m)
            return m[1].replace(/%3A/g, ':').replace(/%2F/g, '/');
    }
    return '';
}
/* ── Input Text Tracking (fallback for user messages) ──────────── */
let lastInputText = '';
let inputFlushTimer = null;
function trackInputText(text) {
    // Track the longest input text. When it resets (to empty or short),
    // the previous long text was the submitted message.
    if (text.length > lastInputText.length) {
        lastInputText = text;
    }
    // If text becomes empty/short, the user submitted the previous text
    if (text.length < 5 && lastInputText.length > 10) {
        const submitted = lastInputText;
        lastInputText = '';
        // Only push via this path if the `requests` handler hasn't already captured it
        const hash = simpleHash(submitted.substring(0, 300));
        if (!pushedHashes.has(hash)) {
            addHash(hash);
            if ((0, session_js_1.getActiveSession)()) {
                (0, session_js_1.pushEvent)('message', submitted, {
                    eventType: 'message',
                    role: 'user',
                    source: 'chat-history-watcher-input',
                    charCount: submitted.length,
                    autoCapture: true,
                });
                console.log(`[vai:chat-history] Captured user message via inputState (${submitted.length} chars)`);
            }
        }
    }
    // Also flush after 3s of no updates (user might have submitted without clearing)
    if (inputFlushTimer)
        clearTimeout(inputFlushTimer);
    inputFlushTimer = setTimeout(() => {
        inputFlushTimer = null;
    }, 3000);
}
/* ── Helpers ───────────────────────────────────────────────────── */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return hash.toString(36);
}
/**
 * Returns a list of known VS Code chat sessions from tracked JSONL files.
 * The desktop uses this to populate the session picker dropdown.
 */
function getAvailableChatSessions() {
    if (!chatSessionsDir)
        return [];
    const sessions = [];
    for (const [filename, tracked] of trackedFiles) {
        // Parse header once and cache results
        if (!tracked.vscodeSessionId) {
            try {
                const header = readJsonlHeader(tracked.filePath);
                if (header?.kind === 0 && header.v?.sessionId) {
                    tracked.vscodeSessionId = String(header.v.sessionId);
                    if (header.v.customTitle) {
                        tracked.cachedTitle = String(header.v.customTitle);
                    }
                }
            }
            catch { /* ignore */ }
        }
        if (!tracked.vscodeSessionId)
            continue;
        // Derive title: use cached, or try first user message
        if (!tracked.cachedTitle) {
            try {
                tracked.cachedTitle = deriveSessionTitle(tracked.filePath);
            }
            catch { /* ignore */ }
        }
        sessions.push({
            sessionId: tracked.vscodeSessionId,
            title: tracked.cachedTitle || 'Untitled',
            lastModified: tracked.lastModified,
            chatApp: 'chat',
        });
    }
    sessions.sort((a, b) => b.lastModified - a.lastModified);
    return sessions;
}
/** Read the first JSON line (header) from a JSONL file, handling very large headers. */
function readJsonlHeader(filePath) {
    const fileSize = fs.statSync(filePath).size;
    if (fileSize === 0)
        return null;
    // Read in chunks until we find the first newline
    const fd = fs.openSync(filePath, 'r');
    try {
        const CHUNK = 64 * 1024; // 64KB chunks
        const MAX_READ = 8 * 1024 * 1024; // Stop after 8MB (some headers embed screenshots)
        let accumulated = '';
        let offset = 0;
        while (offset < Math.min(fileSize, MAX_READ)) {
            const toRead = Math.min(CHUNK, fileSize - offset);
            const buf = Buffer.alloc(toRead);
            fs.readSync(fd, buf, 0, toRead, offset);
            accumulated += buf.toString('utf8');
            offset += toRead;
            const nlIdx = accumulated.indexOf('\n');
            if (nlIdx >= 0) {
                return JSON.parse(accumulated.slice(0, nlIdx));
            }
        }
        // No newline found — try parsing entire accumulated text
        if (accumulated.length > 0) {
            return JSON.parse(accumulated);
        }
    }
    finally {
        fs.closeSync(fd);
    }
    return null;
}
/** Extract a title from the first user message in a JSONL chat session file. */
function deriveSessionTitle(filePath) {
    const fileSize = fs.statSync(filePath).size;
    if (fileSize === 0)
        return undefined;
    const fd = fs.openSync(filePath, 'r');
    try {
        // Read up to 2MB to find user messages in the first few lines
        const toRead = Math.min(2 * 1024 * 1024, fileSize);
        const buf = Buffer.alloc(toRead);
        fs.readSync(fd, buf, 0, toRead, 0);
        const text = buf.toString('utf8');
        const lines = text.split('\n');
        // Skip header (line 0), check next lines for user messages
        for (let i = 1; i < Math.min(lines.length, 30); i++) {
            const line = lines[i];
            if (!line || line.length < 10)
                continue;
            try {
                const obj = JSON.parse(line);
                // kind=3 is a chat request with user message
                if (obj.kind === 3 && obj.v?.request?.message) {
                    const msg = obj.v.request.message;
                    // Truncate to a reasonable title length
                    const clean = msg.replace(/\s+/g, ' ').trim();
                    return clean.length > 80 ? clean.slice(0, 77) + '...' : clean;
                }
            }
            catch { /* line may be too large or invalid, skip */ }
        }
    }
    finally {
        fs.closeSync(fd);
    }
    return undefined;
}
/* ── Dispose ───────────────────────────────────────────────────── */
function disposeChatHistoryWatcher() {
    disposed = true;
    // Flush any buffered response text before disposing
    flushPendingResponses();
    fileWatcher?.close();
    fileWatcher = null;
    stopPolling();
    for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
    }
    debounceTimers.clear();
    trackedFiles.clear();
    pushedHashes.clear();
    if (inputFlushTimer)
        clearTimeout(inputFlushTimer);
}
//# sourceMappingURL=capture-chat-history.js.map