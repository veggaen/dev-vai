/**
 * InfoBlock — renders a Vai/council-emitted HTML info block in a MAXIMALLY sandboxed iframe.
 *
 * The HTML is built server-side from structured data (packages/core info-block.ts) and arrives
 * already escaped. We still render it with `sandbox=""` — NO allow-scripts, NO allow-same-origin
 * — so even if something slipped through, scripts can't run and it can't reach the parent origin.
 * This is the defense-in-depth boundary; the server builder is the primary one.
 */
import { useEffect, useMemo, useRef } from 'react';

type RowTone = 'good' | 'warn' | 'bad' | 'muted' | 'default';

type ParsedInfoBlock =
  | { kind: 'rows'; rows: Array<{ label: string; value: string; tone: RowTone }> }
  | { kind: 'steps'; steps: Array<{ label: string; state: 'done' | 'running' | 'pending' }> };

const INFO_BLOCK_FRAME_CSS = [
  'html{margin:0;background:#111418;color-scheme:dark;}',
  'body{box-sizing:border-box;margin:0;padding:8px 10px;background:#111418;color:#e4e4e7;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
  '*{box-sizing:border-box;}',
  'body::-webkit-scrollbar{width:10px;}',
  'body::-webkit-scrollbar-track{background:#111418;}',
  'body::-webkit-scrollbar-thumb{background:#3f3f46;border:2px solid #111418;border-radius:999px;}',
].join('');

function withInfoBlockFrameStyles(html: string): string {
  if (html.includes('data-vai-info-block-frame')) return html;
  const style = `<style data-vai-info-block-frame>${INFO_BLOCK_FRAME_CSS}</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>${html}</body></html>`;
}

function estimateInfoBlockHeight(html: string): number {
  const rowCount = (html.match(/display:flex/gi) ?? []).length;
  const titleCount = (html.match(/font-weight:600/gi) ?? []).length;
  const estimated = 22 + rowCount * 24 + titleCount * 24;
  return Math.max(72, Math.min(260, estimated));
}

function toneFromStyle(style: string): RowTone {
  if (/#34d399/i.test(style)) return 'good';
  if (/#fbbf24/i.test(style)) return 'warn';
  if (/#f87171/i.test(style)) return 'bad';
  if (/#9ca3af/i.test(style)) return 'muted';
  return 'default';
}

function parseInfoBlockHtml(html: string): ParsedInfoBlock | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const entries = Array.from(doc.body.querySelectorAll('div'))
    .map((div) => {
      const spans = Array.from(div.children).filter((child): child is HTMLSpanElement => child.tagName.toLowerCase() === 'span');
      if (spans.length < 2) return null;
      return {
        left: spans[0].textContent?.trim() ?? '',
        right: spans.slice(1).map((span) => span.textContent?.trim() ?? '').filter(Boolean).join(' '),
        style: spans[1].getAttribute('style') ?? '',
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.left && entry.right));

  if (entries.length === 0) return null;

  const firstTokens = new Set(['✓', '◐', '○', '·']);
  if (entries.every((entry) => firstTokens.has(entry.left))) {
    return {
      kind: 'steps',
      steps: entries.map((entry) => ({
        label: entry.right,
        state: entry.left === '✓' ? 'done' : entry.left === '◐' ? 'running' : 'pending',
      })),
    };
  }

  return {
    kind: 'rows',
    rows: entries.map((entry) => ({
      label: entry.left,
      value: entry.right,
      tone: toneFromStyle(entry.style),
    })),
  };
}

const rowToneClass = {
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-red-300',
  muted: 'text-zinc-400',
  default: 'text-zinc-100',
} satisfies Record<RowTone, string>;

export function InfoBlock({ html, title }: { html: string; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const parsed = useMemo(() => parseInfoBlockHtml(html), [html]);
  const framedHtml = withInfoBlockFrameStyles(html);
  const estimatedHeight = estimateInfoBlockHeight(framedHtml);

  // Start with a deterministic height estimate because sandbox="" can make the
  // iframe document opaque to the parent. If the browser allows measurement, tighten it.
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
  }, [framedHtml]);

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--panel-bg-muted)]">
      {title && (
        <div className="border-b border-[color:var(--border)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--chat-muted)]">
          {title}
        </div>
      )}
      {parsed?.kind === 'rows' ? (
        <dl className="divide-y divide-white/[0.055] px-3 py-1">
          {parsed.rows.map((row, index) => (
            <div
              key={`${row.label}-${index}`}
              className="grid grid-cols-[minmax(5.5rem,8rem)_minmax(0,1fr)] gap-3 py-1.5 text-[12px] leading-5"
            >
              <dt className="min-w-0 text-[color:var(--chat-muted)]">{row.label}</dt>
              <dd className={`min-w-0 break-words font-medium ${rowToneClass[row.tone]}`}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : parsed?.kind === 'steps' ? (
        <ol className="space-y-1 px-3 py-2">
          {parsed.steps.map((step, index) => (
            <li key={`${step.label}-${index}`} className="flex min-w-0 items-start gap-2 text-[12px] leading-5 text-zinc-200">
              <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                step.state === 'done' ? 'bg-emerald-300' : step.state === 'running' ? 'bg-indigo-300' : 'bg-zinc-600'
              }`} />
              <span className="min-w-0 break-words">{step.label}</span>
            </li>
          ))}
        </ol>
      ) : (
        <iframe
          ref={ref}
          sandbox=""
          srcDoc={framedHtml}
          title={title ?? 'info block'}
          className="block w-full border-0"
          style={{ height: estimatedHeight, background: '#111418', colorScheme: 'dark' }}
        />
      )}
    </div>
  );
}
