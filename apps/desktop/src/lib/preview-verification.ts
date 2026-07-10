export interface ExistingPreviewState {
  readonly port: number;
  readonly baselineLoadCount: number;
  readonly devPort: number | null;
  readonly lastPreviewPort: number | null;
  readonly previewLoadCount: number;
  readonly previewReady: boolean;
  readonly status: string;
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
