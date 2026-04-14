"use strict";
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
exports.onDidChangePlatformAuthState = void 0;
exports.getPlatformAuthState = getPlatformAuthState;
exports.initPlatformAuth = initPlatformAuth;
exports.restorePlatformAuth = restorePlatformAuth;
exports.refreshPlatformAuth = refreshPlatformAuth;
exports.signInToPlatform = signInToPlatform;
exports.signOutFromPlatform = signOutFromPlatform;
const node_crypto_1 = require("node:crypto");
const vscode = __importStar(require("vscode"));
const api_js_1 = require("./api.js");
const SECRET_KEY = 'vai.platformSessionToken';
const INSTALLATION_KEY_STATE = 'vai.platformInstallationKey';
const COMPANION_CLIENT_ID_STATE = 'vai.platformCompanionClientId';
const CLIENT_NAME = 'VS Code Extension';
const CLIENT_TYPE = 'vscode-extension';
const LAUNCH_TARGET = 'vscode';
const CLIENT_CAPABILITIES = ['audit-consume', 'handoff-consume', 'broadcast-consume'];
let extensionContext = null;
let sessionToken;
let state = {
    status: 'signed-out',
    user: null,
    error: null,
};
const onDidChangeEmitter = new vscode.EventEmitter();
exports.onDidChangePlatformAuthState = onDidChangeEmitter.event;
function setState(nextState) {
    state = nextState;
    onDidChangeEmitter.fire(state);
}
async function persistToken(token) {
    if (!extensionContext)
        return;
    if (token) {
        await extensionContext.secrets.store(SECRET_KEY, token);
        return;
    }
    await extensionContext.secrets.delete(SECRET_KEY);
}
function getPlatformAuthState() {
    return state;
}
function initPlatformAuth(context) {
    extensionContext = context;
    (0, api_js_1.setAuthTokenProvider)(() => sessionToken);
    (0, api_js_1.setClientMetadataProvider)(async () => ({
        installationKey: await getInstallationKey(),
        clientName: CLIENT_NAME,
        clientType: CLIENT_TYPE,
        launchTarget: LAUNCH_TARGET,
        capabilities: CLIENT_CAPABILITIES,
        companionClientId: extensionContext ? extensionContext.globalState.get(COMPANION_CLIENT_ID_STATE) : undefined,
    }));
}
async function restorePlatformAuth() {
    if (!extensionContext)
        return;
    sessionToken = await extensionContext.secrets.get(SECRET_KEY);
    if (!sessionToken) {
        setState({ status: 'signed-out', user: null, error: null });
        return;
    }
    await refreshPlatformAuth();
}
async function refreshPlatformAuth() {
    try {
        const payload = await (0, api_js_1.apiCall)('/api/auth/me');
        if (!payload.enabled || !payload.authenticated || !payload.user) {
            sessionToken = undefined;
            await persistToken(undefined);
            await persistCompanionClientId(undefined);
            setState({ status: 'signed-out', user: null, error: null });
            return;
        }
        await persistCompanionClientId(payload.companionClient?.id);
        setState({ status: 'authenticated', user: payload.user, error: null });
    }
    catch (error) {
        setState({
            status: 'error',
            user: state.user,
            error: error instanceof Error ? error.message : 'Unable to verify platform session.',
        });
    }
}
async function signInToPlatform() {
    setState({ status: 'signing-in', user: state.user, error: null });
    try {
        const installationKey = await getInstallationKey();
        const payload = await (0, api_js_1.apiCall)('/api/auth/device/start', 'POST', {
            clientName: CLIENT_NAME,
            clientType: CLIENT_TYPE,
            installationKey,
            launchTarget: LAUNCH_TARGET,
            capabilities: CLIENT_CAPABILITIES,
        });
        await vscode.env.openExternal(vscode.Uri.parse(payload.verificationUri));
        const expiresAt = new Date(payload.expiresAt).getTime();
        const intervalMs = Math.max(1000, payload.intervalSeconds * 1000);
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Waiting for VeggaAI sign-in (${payload.userCode})`,
            cancellable: true,
        }, async (progress, cancellationToken) => {
            progress.report({ message: 'Finish approval in your browser.' });
            while (Date.now() < expiresAt) {
                if (cancellationToken.isCancellationRequested) {
                    throw new Error('Sign-in cancelled.');
                }
                const result = await (0, api_js_1.apiCall)('/api/auth/device/poll', 'POST', {
                    deviceCode: payload.deviceCode,
                });
                if (result.status === 'approved' && result.sessionToken && result.user) {
                    sessionToken = result.sessionToken;
                    await persistToken(sessionToken);
                    await persistCompanionClientId(result.companionClientId);
                    setState({ status: 'authenticated', user: result.user, error: null });
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, intervalMs));
            }
            throw new Error('Sign-in timed out. Start again from VS Code.');
        });
        if (state.status === 'authenticated' && state.user) {
            vscode.window.showInformationMessage(`VeggaAI connected as ${state.user.email}`);
            return;
        }
        throw new Error('Sign-in did not complete.');
    }
    catch (error) {
        sessionToken = undefined;
        await persistToken(undefined);
        await persistCompanionClientId(undefined);
        setState({
            status: 'error',
            user: null,
            error: error instanceof Error ? error.message : 'Sign-in failed.',
        });
        throw error;
    }
}
async function signOutFromPlatform() {
    try {
        await (0, api_js_1.apiCall)('/api/auth/logout', 'POST');
    }
    catch {
        // Local cleanup still matters if the runtime session is already gone.
    }
    sessionToken = undefined;
    await persistToken(undefined);
    await persistCompanionClientId(undefined);
    setState({ status: 'signed-out', user: null, error: null });
}
async function getInstallationKey() {
    if (!extensionContext) {
        throw new Error('Platform auth has not been initialized');
    }
    const existing = extensionContext.globalState.get(INSTALLATION_KEY_STATE);
    if (existing?.trim()) {
        return existing;
    }
    const nextValue = `vscode-${(0, node_crypto_1.randomUUID)()}`;
    await extensionContext.globalState.update(INSTALLATION_KEY_STATE, nextValue);
    return nextValue;
}
async function persistCompanionClientId(clientId) {
    if (!extensionContext)
        return;
    await extensionContext.globalState.update(COMPANION_CLIENT_ID_STATE, clientId?.trim() || undefined);
}
//# sourceMappingURL=platform-auth.js.map