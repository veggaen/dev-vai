/**
 * info-block — deterministic HTML "info blocks" Vai/council emit into chat.
 *
 * SECURITY MODEL (decided 2026-06-23): HTML is built SERVER-SIDE from STRUCTURED DATA only and
 * rendered in an iframe with `sandbox=""` (no scripts, no same-origin). We never sanitize
 * model-authored HTML — sanitization-as-a-security-boundary is the failure mode we avoid. The
 * only dynamic values are escaped text; tags come from this fixed allowlist of builders.
 *
 * Pure + deterministic → unit-testable, inspectable (AGENTS.md), and safe to render.
 */

/** Escape the only attacker-influenced surface: text values. */
export function escapeHtml(value: string): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

export interface InfoBlockKeyValue {
  readonly kind: 'key-value';
  readonly title?: string;
  readonly rows: ReadonlyArray<{ readonly label: string; readonly value: string; readonly tone?: 'good' | 'warn' | 'bad' | 'muted' }>;
}
export interface InfoBlockSteps {
  readonly kind: 'steps';
  readonly title?: string;
  readonly steps: ReadonlyArray<{ readonly label: string; readonly state: 'done' | 'running' | 'pending' }>;
}
export type InfoBlockSpec = InfoBlockKeyValue | InfoBlockSteps;

const TONE_COLOR: Record<string, string> = {
  good: '#34d399', warn: '#fbbf24', bad: '#f87171', muted: '#9ca3af',
};
const STATE_GLYPH: Record<string, string> = { done: '✓', running: '◐', pending: '○' };

/**
 * Render a structured spec to a complete, self-contained HTML document string for `srcdoc`.
 * Styles are inline + token-aligned dark; no external resources, no scripts.
 */
export function renderInfoBlockHtml(spec: InfoBlockSpec): string {
  const base = 'font-family:system-ui,-apple-system,sans-serif;color:#e6e6ee;background:transparent;margin:0;padding:2px';
  let body = '';
  if (spec.kind === 'key-value') {
    const rows = spec.rows.map((r) => {
      const color = r.tone ? TONE_COLOR[r.tone] ?? '#e6e6ee' : '#e6e6ee';
      return `<div style="display:flex;gap:10px;padding:3px 0;font-size:13px">`
        + `<span style="color:#9ca3af;min-width:120px">${escapeHtml(r.label)}</span>`
        + `<span style="color:${color}">${escapeHtml(r.value)}</span></div>`;
    }).join('');
    body = (spec.title ? `<div style="font-weight:600;font-size:13px;margin-bottom:6px">${escapeHtml(spec.title)}</div>` : '') + rows;
  } else {
    const items = spec.steps.map((s) => {
      const color = s.state === 'done' ? TONE_COLOR.good : s.state === 'running' ? '#a5b4fc' : '#6b7280';
      return `<div style="display:flex;gap:8px;padding:2px 0;font-size:13px;color:${color}">`
        + `<span>${STATE_GLYPH[s.state] ?? '·'}</span><span>${escapeHtml(s.label)}</span></div>`;
    }).join('');
    body = (spec.title ? `<div style="font-weight:600;font-size:13px;margin-bottom:6px">${escapeHtml(spec.title)}</div>` : '') + items;
  }
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="${base}">${body}</body></html>`;
}
