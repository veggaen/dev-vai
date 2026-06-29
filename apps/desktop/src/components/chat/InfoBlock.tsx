/**
 * InfoBlock — renders a Vai/council-emitted HTML info block in a MAXIMALLY sandboxed iframe.
 *
 * The HTML is built server-side from structured data (packages/core info-block.ts) and arrives
 * already escaped. We still render it with `sandbox=""` — NO allow-scripts, NO allow-same-origin
 * — so even if something slipped through, scripts can't run and it can't reach the parent origin.
 * This is the defense-in-depth boundary; the server builder is the primary one.
 */
import { useEffect, useRef } from 'react';

export function InfoBlock({ html, title }: { html: string; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  // Auto-size to content height (no scrollbars) without granting scripts: measure after load.
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const fit = () => {
      try {
        const h = iframe.contentDocument?.body?.scrollHeight;
        if (h) iframe.style.height = `${h + 4}px`;
      } catch { /* cross-origin guard — leave default height */ }
    };
    iframe.addEventListener('load', fit);
    fit();
    return () => iframe.removeEventListener('load', fit);
  }, [html]);

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)]">
      {title && (
        <div className="border-b border-[color:var(--border)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--chat-muted)]">
          {title}
        </div>
      )}
      <iframe
        ref={ref}
        sandbox=""
        srcDoc={html}
        title={title ?? 'info block'}
        className="block w-full border-0"
        style={{ height: 60, background: 'transparent' }}
      />
    </div>
  );
}
