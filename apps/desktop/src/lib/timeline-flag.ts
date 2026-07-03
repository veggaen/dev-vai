/**
 * Feature flag for the loop-aware Timeline view (vs. the classic ProcessTree). Additive and
 * reversible: when off (default), turns render exactly as before. Persisted in localStorage so the
 * choice survives reloads; toggled from Settings → Engine → "Turn process view".
 */
const STORAGE_KEY = 'vai-timeline-view';

export function isTimelineViewEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // Default ON: the ReasoningFlow timeline is the canonical turn surface. Only an
    // explicit '0' (Settings → Engine → "Turn process view") falls back to the tree.
    return window.localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setTimelineViewEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    // Notify open views in the same tab (storage event only fires cross-tab).
    window.dispatchEvent(new CustomEvent('vai-timeline-view-change', { detail: enabled }));
  } catch {
    // best-effort
  }
}
