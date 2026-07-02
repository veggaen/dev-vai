/**
 * Feature flag for the spatial ReasoningFlow view (vs. the classic ProcessTree). Additive and
 * reversible; persisted in localStorage so the choice survives reloads; toggled from
 * Settings → Engine → "Turn process view".
 *
 * DEFAULT-ON as of 2026-07-02 after verifying ReasoningFlow against real multi-round turns
 * (including error/aborted paths) in the live app. Unset → on; users who explicitly opt out
 * (stored '0') still get the classic ProcessTree.
 */
const STORAGE_KEY = 'vai-timeline-view';

export function isTimelineViewEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    // Default on: only an explicit '0' opt-out disables it.
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
