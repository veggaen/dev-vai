"use strict";
/**
 * VeggaAI Runtime API Client
 *
 * Handles all HTTP communication with the runtime server (port 3006).
 * Includes retry logic, connection health checking, and batch event pushing.
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
exports.getApiBase = getApiBase;
exports.setAuthTokenProvider = setAuthTokenProvider;
exports.setClientMetadataProvider = setClientMetadataProvider;
exports.apiCall = apiCall;
exports.isServerHealthy = isServerHealthy;
exports.isHealthy = isHealthy;
const vscode = __importStar(require("vscode"));
let authTokenProvider = null;
let clientMetadataProvider = null;
function getApiBase() {
    return vscode.workspace.getConfiguration('vai').get('runtimeUrl', 'http://localhost:3006');
}
function setAuthTokenProvider(provider) {
    authTokenProvider = provider;
}
function setClientMetadataProvider(provider) {
    clientMetadataProvider = provider;
}
async function buildHeaders(headers, hasBody = true) {
    const merged = new Headers(headers);
    if (hasBody && !merged.has('Content-Type')) {
        merged.set('Content-Type', 'application/json');
    }
    const token = authTokenProvider ? await authTokenProvider() : undefined;
    if (token && !merged.has('Authorization')) {
        merged.set('Authorization', `Bearer ${token}`);
    }
    const metadata = clientMetadataProvider ? await clientMetadataProvider() : undefined;
    if (metadata?.installationKey && !merged.has('x-vai-installation-key')) {
        merged.set('x-vai-installation-key', metadata.installationKey);
    }
    if (metadata?.clientName && !merged.has('x-vai-client-name')) {
        merged.set('x-vai-client-name', metadata.clientName);
    }
    if (metadata?.clientType && !merged.has('x-vai-client-type')) {
        merged.set('x-vai-client-type', metadata.clientType);
    }
    if (metadata?.launchTarget && !merged.has('x-vai-launch-target')) {
        merged.set('x-vai-launch-target', metadata.launchTarget);
    }
    if (metadata?.capabilities?.length && !merged.has('x-vai-client-capabilities')) {
        merged.set('x-vai-client-capabilities', JSON.stringify(metadata.capabilities));
    }
    if (metadata?.companionClientId && !merged.has('x-vai-companion-client-id')) {
        merged.set('x-vai-companion-client-id', metadata.companionClientId);
    }
    return merged;
}
/* ── Core HTTP ─────────────────────────────────────────────────── */
let _healthy = false;
let _lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 30_000; // 30s
async function apiCall(path, method = 'GET', body, init) {
    const url = `${getApiBase()}${path}`;
    const opts = {
        method,
        ...init,
        headers: await buildHeaders(init?.headers, body !== undefined),
        signal: AbortSignal.timeout(5000),
    };
    if (body !== undefined)
        opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
    }
    _healthy = true;
    if (res.status === 204) {
        return null;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
        const text = await res.text();
        return text.length ? text : null;
    }
    return res.json();
}
async function isServerHealthy() {
    const now = Date.now();
    if (now - _lastHealthCheck < HEALTH_CHECK_INTERVAL)
        return _healthy;
    _lastHealthCheck = now;
    try {
        await fetch(`${getApiBase()}/api/sessions?limit=1`, {
            headers: await buildHeaders(),
            signal: AbortSignal.timeout(3000),
        });
        _healthy = true;
    }
    catch {
        _healthy = false;
    }
    return _healthy;
}
function isHealthy() {
    return _healthy;
}
//# sourceMappingURL=api.js.map