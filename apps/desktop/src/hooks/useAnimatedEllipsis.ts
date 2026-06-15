import { useEffect, useState } from 'react';

/** Strip trailing ellipsis / dots so we can animate `.` → `..` → `...` cleanly. */
function stripTrailingDots(text: string): string {
  return text.replace(/\.{1,3}$/, '').replace(/…$/, '').trimEnd();
}

/**
 * Cycles trailing dots on running process labels so long backend waits never
 * look frozen (e.g. "Council members deliberating." → ".." → "...").
 */
export function useAnimatedEllipsis(active: boolean, text: string, intervalMs = 420): string {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    if (!active) {
      setDots(1);
      return;
    }
    const id = window.setInterval(() => {
      setDots((current) => (current >= 3 ? 1 : current + 1));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);

  if (!active) return text;
  const base = stripTrailingDots(text);
  return `${base}${'.'.repeat(dots)}`;
}
