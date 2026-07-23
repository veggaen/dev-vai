import { buildApiHeaders } from './api.js';

export interface VisualLayoutVerificationIssue {
  readonly rule: string;
  readonly severity: 'warning' | 'error';
  readonly message: string;
  readonly selectors: readonly string[];
  readonly measuredPx: number;
  readonly expectedPx?: number;
}

export interface VisualLayoutVerificationRun {
  readonly viewport: { readonly name: string; readonly width: number; readonly height: number };
  readonly verdict: 'pass' | 'warn' | 'fail';
  readonly spacingRhythmPx: number;
  readonly issues: readonly VisualLayoutVerificationIssue[];
  readonly browserErrors: readonly string[];
}

export interface VisualLayoutVerificationReport {
  readonly url: string;
  readonly verdict: 'pass' | 'warn' | 'fail';
  readonly runs: readonly VisualLayoutVerificationRun[];
}

export interface VisualLayoutVerificationResult {
  readonly available: boolean;
  readonly report: VisualLayoutVerificationReport | null;
  readonly error?: string;
}

function isReport(value: unknown): value is VisualLayoutVerificationReport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VisualLayoutVerificationReport>;
  return typeof candidate.url === 'string'
    && ['pass', 'warn', 'fail'].includes(candidate.verdict ?? '')
    && Array.isArray(candidate.runs);
}

export async function requestVisualLayoutVerification(
  projectId: string,
  apiBase: string,
): Promise<VisualLayoutVerificationResult> {
  try {
    const path = `/api/sandbox/${encodeURIComponent(projectId)}/visual-audit`;
    const response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: buildApiHeaders(undefined, path),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) {
      const error = payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: unknown }).error)
        : `Visual audit request failed with HTTP ${response.status}`;
      return { available: false, report: null, error };
    }
    return isReport(payload)
      ? { available: true, report: payload }
      : { available: false, report: null, error: 'Visual audit returned an invalid report.' };
  } catch (error) {
    return {
      available: false,
      report: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function blockingVisualLayoutEvidence(report: VisualLayoutVerificationReport): string[] {
  const evidence = report.runs.flatMap((run) => [
    ...run.browserErrors.map((message) => `${run.viewport.name}: browser error: ${message}`),
    ...run.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `${run.viewport.name}: ${issue.message}`),
  ]);
  return [...new Set(evidence)];
}

export function isVisualLayoutCandidate(paths: readonly string[]): boolean {
  return paths.some((path) => /\.(?:css|scss|sass|less|html?|tsx?|jsx?|vue|svelte)$/i.test(path));
}
