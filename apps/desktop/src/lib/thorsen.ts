/**
 * Thorsen Client SDK — Desktop-side API for the Thorsen intent protocol.
 *
 * All calls go through the existing Vai runtime (Fastify on :3006).
 * Uses the same API_BASE / proxy setup as all other desktop API calls.
 */

import { API_BASE } from './api.js';

/* ── Types (mirrored from @vai/core/thorsen for client use) ───── */

export type ThorsenAction = 'create' | 'optimize' | 'debug' | 'explain' | 'transpile' | 'test';
export type ThorsenDomain = 'calculator' | 'component' | 'api-route' | 'utility' | 'dataset' | 'pipeline' | 'vai-drill' | 'custom';
export type ThorsenLogicType = 'functional' | 'stateful' | 'reactive' | 'declarative';
export type ThorsenTargetEnv = 'node' | 'browser' | 'wsl2' | 'docker' | 'edge';
export type ThorsenLanguage = 'typescript' | 'python' | 'rust' | 'go' | 'auto';

export interface ThorsenIntent {
  action: ThorsenAction;
  domain: ThorsenDomain;
  logicType?: ThorsenLogicType;
  targetEnv?: ThorsenTargetEnv;
  language?: ThorsenLanguage;
  spec?: string;
  constraints?: string[];
  timestampUs?: number;
}

export interface ThorsenArtifact {
  language: string;
  code: string;
  filename: string;
  thorsenScore: number;
  verified: boolean;
  verifyOutput?: string;
}

export type ThorsenSyncState = 'linear' | 'parallel' | 'wormhole';

export interface ThorsenSyncStatus {
  state: ThorsenSyncState;
  latencyMs: number;
  resolved: boolean;
}

/* ── Pipeline Trace Types ─────────────────────────────────────── */

export type PipelineStage = 'receive' | 'normalize' | 'route' | 'synthesize' | 'verify' | 'score';
export type RoutingStrategy = 'template' | 'llm' | 'hybrid' | 'skeleton';
export type IntentComplexity = 'trivial' | 'standard' | 'complex' | 'novel';

export interface StageTiming {
  stage: PipelineStage;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface IntentFingerprint {
  key: string;
  action: ThorsenAction;
  domain: ThorsenDomain;
  logicType: ThorsenLogicType;
  targetEnv: ThorsenTargetEnv;
}

export interface RoutingDecision {
  strategy: RoutingStrategy;
  templateKey: string | null;
  reason: string;
  estimatedLatencyMs: number;
}

export interface PipelineTrace {
  traceId: string;
  totalMs: number;
  stages: StageTiming[];
  intermediates: {
    received?: { valid: boolean; validationErrors: string[] };
    normalized?: { fingerprint: IntentFingerprint; complexity: IntentComplexity; templateAvailable: boolean };
    routed?: RoutingDecision;
    synthesized?: { generationMethod: RoutingStrategy; rawLatencyMs: number };
    verified?: { parseValid: boolean; constraintsPassed: boolean; constraintResults: Array<{ constraint: string; passed: boolean; reason?: string }> };
    scored?: { adjustedScore: number; scoreFactors: Record<string, number>; syncState: ThorsenSyncState; pipelineLatencyMs: number };
  };
  success: boolean;
  error?: string;
  failedAt?: PipelineStage;
}

/* ── Response Types ───────────────────────────────────────────── */

export interface ThorsenResponse {
  artifact: ThorsenArtifact;
  sync: ThorsenSyncStatus;
  trace?: PipelineTrace;
}

export interface ThorsenPulseResponse {
  state: ThorsenSyncState;
  latencyMs: number;
  serverTimestampUs: number;
}

export interface ThorsenTemplate {
  key: string;
  action: string;
  domain: string;
  logicType: string;
}

export interface ThorsenPipelineInfo {
  stages: Array<{ stage: string; description: string }>;
  coreFields: string[];
  strategies: string[];
  complexityLevels: string[];
  curveThresholds: { LINEAR_THRESHOLD: number; WORMHOLE_THRESHOLD: number };
  templates: string[];
}

/* ── API calls ────────────────────────────────────────────────── */

/**
 * Send an intent through the full 6-stage Thorsen pipeline.
 * Returns artifact + sync status + pipeline trace.
 */
export async function thorsenSynthesize(
  intent: ThorsenIntent,
  opts?: { traceMode?: boolean; skipVerify?: boolean },
): Promise<ThorsenResponse> {
  const res = await fetch(`${API_BASE}/api/thorsen/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...intent,
      timestampUs: intent.timestampUs ?? Date.now() * 1000,
      traceMode: opts?.traceMode !== false,
      skipVerify: opts?.skipVerify,
    }),
  });
  if (!res.ok) throw new Error(`Thorsen synthesis failed: ${res.status}`);
  return res.json();
}

/**
 * Send a pulse to measure Thorsen Curve sync state.
 */
export async function thorsenPulse(frequency = 144, intensity = 0.8): Promise<ThorsenPulseResponse> {
  const res = await fetch(`${API_BASE}/api/thorsen/pulse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timestampUs: Date.now() * 1000,
      frequency,
      intensity,
    }),
  });
  if (!res.ok) throw new Error(`Thorsen pulse failed: ${res.status}`);
  return res.json();
}

/**
 * List available deterministic templates.
 */
export async function thorsenTemplates(): Promise<{ count: number; templates: ThorsenTemplate[] }> {
  const res = await fetch(`${API_BASE}/api/thorsen/templates`);
  if (!res.ok) throw new Error(`Thorsen templates failed: ${res.status}`);
  return res.json();
}

/**
 * Get Thorsen Curve threshold constants.
 */
export async function thorsenCurve(): Promise<{
  thresholds: { LINEAR_THRESHOLD: number; WORMHOLE_THRESHOLD: number };
  states: Array<{ state: string; label: string; description: string }>;
}> {
  const res = await fetch(`${API_BASE}/api/thorsen/curve`);
  if (!res.ok) throw new Error(`Thorsen curve failed: ${res.status}`);
  return res.json();
}

/**
 * Get pipeline architecture info — stages, strategies, complexity levels.
 */
export async function thorsenPipelineInfo(): Promise<ThorsenPipelineInfo> {
  const res = await fetch(`${API_BASE}/api/thorsen/pipeline`);
  if (!res.ok) throw new Error(`Thorsen pipeline info failed: ${res.status}`);
  return res.json();
}
