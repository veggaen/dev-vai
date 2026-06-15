import { useEffect, useState } from 'react';

/**
 * Reveal list items one at a time even when the backend bursts several progress
 * steps in a single frame (common at turn start). Matches Cursor/t3code pacing.
 */
export function useStaggeredReveal(total: number, intervalMs = 380): number {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (total <= 0) {
      setVisible(0);
      return;
    }
    // First step appears immediately; later steps pace out (backend often bursts 3–4 at once).
    setVisible((current) => Math.max(current, Math.min(1, total)));
  }, [total]);

  useEffect(() => {
    if (total <= 0) {
      return;
    }
    if (visible >= total) return;

    const delay = visible <= 1 ? 60 : intervalMs;
    const timer = window.setTimeout(() => {
      setVisible((current) => Math.min(current + 1, total));
    }, delay);

    return () => window.clearTimeout(timer);
  }, [total, visible, intervalMs]);

  useEffect(() => {
    if (total < visible) setVisible(total);
  }, [total, visible]);

  if (total <= 0) return 0;
  // At least one step visible once work has started (SSR-safe first paint).
  return Math.min(Math.max(visible, 1), total);
}
