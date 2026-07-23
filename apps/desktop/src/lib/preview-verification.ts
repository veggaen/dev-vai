export interface ExistingPreviewState {
  readonly port: number;
  readonly baselineLoadCount: number;
  readonly devPort: number | null;
  readonly lastPreviewPort: number | null;
  readonly previewLoadCount: number;
  readonly previewReady: boolean;
  readonly status: string;
}

export const PREVIEW_REFRESH_REQUEST_EVENT = 'vai:preview-refresh-request';

export interface PreviewRefreshRequest {
  readonly port: number;
  readonly requestId: string;
}

export function parsePreviewRefreshRequest(value: unknown): PreviewRefreshRequest | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PreviewRefreshRequest>;
  if (!Number.isInteger(candidate.port) || Number(candidate.port) <= 0) return null;
  if (typeof candidate.requestId !== 'string' || candidate.requestId.trim().length === 0) return null;
  return { port: Number(candidate.port), requestId: candidate.requestId.trim() };
}

/** Cache-bust a preview document without changing the user-facing app URL. */
export function previewUrlForRefresh(url: string, requestId: string): string {
  const next = new URL(url);
  next.searchParams.set('_vai_refresh', requestId);
  return next.toString();
}

/**
 * Next/Vite HMR updates an already-mounted iframe without firing a new iframe
 * load event. A responsive server plus this mounted state is valid evidence;
 * requiring the load counter to increment creates false auto-repair turns.
 */
export function existingPreviewRemainedHealthy(input: ExistingPreviewState): boolean {
  return input.baselineLoadCount > 0
    && input.status !== 'failed'
    && input.devPort === input.port
    && input.lastPreviewPort === input.port
    && input.previewReady
    && input.previewLoadCount >= input.baselineLoadCount;
}
