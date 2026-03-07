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
exports.apiCall = apiCall;
exports.isServerHealthy = isServerHealthy;
exports.isHealthy = isHealthy;
const vscode = __importStar(require("vscode"));
/* ── Config ────────────────────────────────────────────────────── */
function getApiBase() {
    return vscode.workspace.getConfiguration('vai').get('runtimeUrl', 'http://localhost:3006');
}
/* ── Core HTTP ─────────────────────────────────────────────────── */
let _healthy = false;
let _lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 30_000; // 30s
async function apiCall(path, method = 'GET', body) {
    const url = `${getApiBase()}${path}`;
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
    };
    if (body)
        opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
    }
    _healthy = true;
    return res.json();
}
async function isServerHealthy() {
    const now = Date.now();
    if (now - _lastHealthCheck < HEALTH_CHECK_INTERVAL)
        return _healthy;
    _lastHealthCheck = now;
    try {
        await fetch(`${getApiBase()}/api/sessions?limit=1`, {
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