/** Shared helpers for react-resizable-panels drag-to-collapse UX. */

export interface PanelResizeSize {
  asPercentage: number;
  inPixels: number;
}

export function isPanelCollapsedSize(size: PanelResizeSize): boolean {
  return size.asPercentage < 0.5 || size.inPixels < 8;
}

export function syncPanelCollapsedAttr(
  element: HTMLDivElement | null,
  size: PanelResizeSize,
): void {
  if (!element) return;
  if (isPanelCollapsedSize(size)) {
    element.setAttribute('data-panel-collapsed', '');
  } else {
    element.removeAttribute('data-panel-collapsed');
  }
}