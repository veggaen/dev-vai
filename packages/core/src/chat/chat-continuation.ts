/**
 * ContinuationEmitter — engine-layer follow-up handler.
 *
 * Fires when the user's current message looks like a delta against a prior
 * assistant turn (e.g. "now add a button", "explain it", "make it dark").
 * Emits a deterministic, focused response in <10ms instead of letting the
 * slow corpus path run a fresh retrieval and risk wedging the server.
 *
 * Trust layers (Thorsen):
 *   1. Types: pure function over typed inputs, no IO.
 *   2. Consistency: every recognized continuation kind maps to exactly one
 *      template — no model variance.
 *   3. Honesty: when we don't know what to do, return null so the normal
 *      path runs. We do not fabricate code that pretends to extend the
 *      prior turn — we emit standalone snippets the user can integrate.
 *   4. Coverage: pure ⇒ unit-testable.
 *   5. Security: no execution, no IO, no template injection (closed-set
 *      regexes, never interpolated into output).
 *
 * This is intentionally narrow: it only handles the common follow-up
 * patterns that recur across coding sessions ("add a button", "add a
 * search input", "explain it", "fix it"). Anything outside the catalog
 * returns null and falls through to normal dispatch.
 */

export interface ContinuationRequest {
  readonly content: string;
  /** Most recent assistant text in the conversation, if any. */
  readonly priorAssistantText?: string;
}

export interface ContinuationReply {
  readonly reply: string;
  readonly kind:
    | 'add-button'
    | 'add-search-input'
    | 'add-form'
    | 'add-table'
    | 'add-list'
    | 'add-dark-mode'
    | 'explain-prior'
    | 'fix-clarify';
}

const FOLLOWUP_TRIGGER_RE =
  /\b(?:now\s+(?:add|also|make|extend|update|change|fix)|also\s+add|add\s+(?:a|an|the)\b|extend\s+it|update\s+it|change\s+it|fix\s+(?:it|this|the)|explain\s+(?:it|this|that)|make\s+it\b)\b/i;

function priorHasCodeFence(text: string | undefined): boolean {
  return Boolean(text && /```[a-z]*[\s\S]*?```/i.test(text));
}

function emitAddButton(): ContinuationReply {
  return {
    kind: 'add-button',
    reply: [
      "Here's a focused, accessible button you can drop into the prior code:",
      '',
      '```tsx',
      'export function ActionButton(props: {',
      '  label: string;',
      '  onClick: () => void;',
      '  disabled?: boolean;',
      "  variant?: 'primary' | 'secondary';",
      '}) {',
      "  const variant = props.variant ?? 'primary';",
      '  const styles =',
      "    variant === 'primary'",
      "      ? 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-600'",
      "      : 'border border-zinc-300 text-zinc-700 hover:bg-zinc-100 focus-visible:outline-zinc-600 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';",
      '  return (',
      '    <button',
      '      type="button"',
      '      onClick={props.onClick}',
      '      disabled={props.disabled}',
      "      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}",
      '    >',
      '      {props.label}',
      '    </button>',
      '  );',
      '}',
      '```',
      '',
      'Wire it where the prior code rendered the action area. Keyboard- and screen-reader-friendly out of the box.',
    ].join('\n'),
  };
}

function emitAddSearchInput(): ContinuationReply {
  return {
    kind: 'add-search-input',
    reply: [
      "Here's an accessible search input with case-insensitive filtering. Drop it above the list/grid in the prior code:",
      '',
      '```tsx',
      "import { useState, useMemo } from 'react';",
      '',
      'export function SearchBox<T>(props: {',
      '  items: readonly T[];',
      '  getLabel: (item: T) => string;',
      '  children: (filtered: readonly T[]) => React.ReactNode;',
      "  placeholder?: string;",
      '}) {',
      "  const [query, setQuery] = useState('');",
      '  const filtered = useMemo(() => {',
      '    const q = query.trim().toLowerCase();',
      '    if (!q) return props.items;',
      '    return props.items.filter((it) => props.getLabel(it).toLowerCase().includes(q));',
      '  }, [query, props.items, props.getLabel]);',
      '  return (',
      '    <div className="space-y-3">',
      '      <label>',
      '        <span className="sr-only">Filter</span>',
      '        <input',
      '          type="search"',
      '          value={query}',
      '          onChange={(e) => setQuery(e.target.value)}',
      "          placeholder={props.placeholder ?? 'Filter...'}",
      '          aria-label="Filter items"',
      '          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"',
      '        />',
      '      </label>',
      '      {props.children(filtered)}',
      '    </div>',
      '  );',
      '}',
      '```',
      '',
      'Generic over `T`; pass any list with a `getLabel` accessor. Filter is `label.toLowerCase().includes(query.toLowerCase())`.',
    ].join('\n'),
  };
}

function emitAddForm(): ContinuationReply {
  return {
    kind: 'add-form',
    reply: [
      "Here's a small accessible form scaffold with inline validation. Integrate into the prior code:",
      '',
      '```tsx',
      "import { useState, type FormEvent } from 'react';",
      '',
      'export function ContactForm(props: { onSubmit: (data: { name: string; email: string }) => void }) {',
      "  const [name, setName] = useState('');",
      "  const [email, setEmail] = useState('');",
      '  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});',
      '  function handleSubmit(e: FormEvent) {',
      '    e.preventDefault();',
      '    const next: { name?: string; email?: string } = {};',
      "    if (!name.trim()) next.name = 'Name is required';",
      "    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) next.email = 'Enter a valid email';",
      '    setErrors(next);',
      '    if (Object.keys(next).length === 0) props.onSubmit({ name: name.trim(), email: email.trim() });',
      '  }',
      '  return (',
      '    <form onSubmit={handleSubmit} noValidate className="space-y-3">',
      '      <label className="block">',
      '        <span className="block text-sm font-medium">Name</span>',
      '        <input',
      '          value={name}',
      '          onChange={(e) => setName(e.target.value)}',
      "          aria-invalid={Boolean(errors.name)}",
      "          aria-describedby={errors.name ? 'name-err' : undefined}",
      '          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"',
      '        />',
      '        {errors.name ? <p id="name-err" role="alert" className="mt-1 text-xs text-red-600">{errors.name}</p> : null}',
      '      </label>',
      '      <label className="block">',
      '        <span className="block text-sm font-medium">Email</span>',
      '        <input',
      '          type="email"',
      '          value={email}',
      '          onChange={(e) => setEmail(e.target.value)}',
      "          aria-invalid={Boolean(errors.email)}",
      "          aria-describedby={errors.email ? 'email-err' : undefined}",
      '          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"',
      '        />',
      '        {errors.email ? <p id="email-err" role="alert" className="mt-1 text-xs text-red-600">{errors.email}</p> : null}',
      '      </label>',
      '      <button type="submit" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Submit</button>',
      '    </form>',
      '  );',
      '}',
      '```',
      '',
      '`aria-invalid` + `aria-describedby` wire validation to assistive tech; `role="alert"` announces errors live.',
    ].join('\n'),
  };
}

function emitAddTable(): ContinuationReply {
  return {
    kind: 'add-table',
    reply: [
      "Here's a semantic, accessible table you can drop into the prior code:",
      '',
      '```tsx',
      'export function DataTable<T>(props: {',
      '  rows: readonly T[];',
      '  columns: readonly { key: string; header: string; render: (row: T) => React.ReactNode }[];',
      '  caption?: string;',
      '}) {',
      '  return (',
      '    <table className="w-full border-collapse text-sm">',
      '      {props.caption ? <caption className="sr-only">{props.caption}</caption> : null}',
      '      <thead>',
      '        <tr>',
      '          {props.columns.map((c) => (',
      '            <th key={c.key} scope="col" className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-left font-semibold dark:border-zinc-700 dark:bg-zinc-900">',
      '              {c.header}',
      '            </th>',
      '          ))}',
      '        </tr>',
      '      </thead>',
      '      <tbody>',
      '        {props.rows.map((r, i) => (',
      '          <tr key={i}>',
      '            {props.columns.map((c) => (',
      '              <td key={c.key} className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">',
      '                {c.render(r)}',
      '              </td>',
      '            ))}',
      '          </tr>',
      '        ))}',
      '      </tbody>',
      '    </table>',
      '  );',
      '}',
      '```',
      '',
      'Generic over row type, with `<caption>` + `scope="col"` for screen readers. Pass `columns` as `[{ key, header, render }]`.',
    ].join('\n'),
  };
}

function emitAddList(): ContinuationReply {
  return {
    kind: 'add-list',
    reply: [
      "Here's a small accessible list with keyboard activation. Drop into the prior code:",
      '',
      '```tsx',
      'export function ItemList<T>(props: {',
      '  items: readonly T[];',
      '  getKey: (item: T) => string;',
      '  renderItem: (item: T) => React.ReactNode;',
      '  onActivate?: (item: T) => void;',
      '}) {',
      '  return (',
      "    <ul role={props.onActivate ? 'listbox' : 'list'} className=\"divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800\">",
      '      {props.items.map((it) => (',
      '        <li',
      '          key={props.getKey(it)}',
      "          role={props.onActivate ? 'option' : undefined}",
      '          tabIndex={props.onActivate ? 0 : undefined}',
      '          onClick={() => props.onActivate?.(it)}',
      "          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && props.onActivate) { e.preventDefault(); props.onActivate(it); } }}",
      '          className="cursor-pointer px-3 py-2 text-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-zinc-900"',
      '        >',
      '          {props.renderItem(it)}',
      '        </li>',
      '      ))}',
      '    </ul>',
      '  );',
      '}',
      '```',
      '',
      'When `onActivate` is provided, the list switches to `role="listbox"` and items become keyboard-activatable with Enter/Space.',
    ].join('\n'),
  };
}

function emitAddDarkMode(): ContinuationReply {
  return {
    kind: 'add-dark-mode',
    reply: [
      "Here's a dark-mode toggle that persists to localStorage and respects `prefers-color-scheme`. Drop into the prior code:",
      '',
      '```tsx',
      "import { useEffect, useState } from 'react';",
      '',
      'export function DarkModeToggle() {',
      '  const [dark, setDark] = useState<boolean>(() => {',
      "    if (typeof window === 'undefined') return false;",
      "    const saved = localStorage.getItem('theme');",
      "    if (saved) return saved === 'dark';",
      "    return window.matchMedia('(prefers-color-scheme: dark)').matches;",
      '  });',
      '  useEffect(() => {',
      "    document.documentElement.classList.toggle('dark', dark);",
      "    localStorage.setItem('theme', dark ? 'dark' : 'light');",
      '  }, [dark]);',
      '  return (',
      '    <button',
      '      type="button"',
      '      onClick={() => setDark((v) => !v)}',
      "      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}",
      '      aria-pressed={dark}',
      '      className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-zinc-700 dark:hover:bg-zinc-800"',
      '    >',
      "      {dark ? '☀ Light' : '☾ Dark'}",
      '    </button>',
      '  );',
      '}',
      '```',
      '',
      "Requires Tailwind's `darkMode: 'class'` in `tailwind.config.js`. `aria-pressed` exposes toggle state to screen readers.",
    ].join('\n'),
  };
}

function emitExplainPrior(priorAssistantText: string | undefined): ContinuationReply {
  // Honest move: don't pretend to deeply analyze. Echo a short summary
  // of what the prior turn produced and invite the user to point at a
  // specific part. Fast, never wedges, sets up a useful next turn.
  const codeFences = (priorAssistantText ?? '').match(/```([a-z]*)/gi) ?? [];
  const langs = Array.from(new Set(codeFences.map((f) => f.replace(/```/g, '').trim() || 'code')));
  const summary = priorAssistantText
    ? `The prior reply contained ${codeFences.length} code block${codeFences.length === 1 ? '' : 's'}${langs.length ? ` (${langs.join(', ')})` : ''}.`
    : 'There was no prior reply in this conversation.';
  return {
    kind: 'explain-prior',
    reply: [
      summary,
      '',
      'Point at the specific part you want me to explain — the function signature, a particular line, the data flow, the styling, or the trade-offs. Short focused asks get useful answers; "explain it" is too broad.',
      '',
      'For example:',
      '- "Why useMemo over useState for the filtered list?"',
      '- "Walk me through the onSubmit flow."',
      '- "What does aria-invalid do here?"',
    ].join('\n'),
  };
}

function emitFixClarify(): ContinuationReply {
  return {
    kind: 'fix-clarify',
    reply: [
      'I can fix it once I know what\'s broken. Paste:',
      '',
      '- the exact error message (or stack trace), or',
      '- the unexpected behavior (what you expected vs. what happened), or',
      '- the failing input.',
      '',
      'Without that I\'d be guessing. If it\'s a build error, the first line of the compiler output is usually enough.',
    ].join('\n'),
  };
}

export function tryEmitContinuation(req: ContinuationRequest): ContinuationReply | null {
  const text = req.content.trim();
  if (!text) return null;
  if (!FOLLOWUP_TRIGGER_RE.test(text)) return null;

  // "explain it" / "explain that" — only meaningful with a prior assistant turn.
  if (/\bexplain\s+(?:it|this|that)\b/i.test(text)) {
    return emitExplainPrior(req.priorAssistantText);
  }

  // "fix it" / "fix this" / "fix the X" — only meaningful with prior code.
  if (/\bfix\s+(?:it|this|the)\b/i.test(text) && priorHasCodeFence(req.priorAssistantText)) {
    return emitFixClarify();
  }

  // "add a button"
  if (/\badd\s+(?:a|an|the)\s+(?:[a-z\-]+\s+)?(?:button|btn|cta)\b/i.test(text)) {
    return emitAddButton();
  }
  // "add a search input" / "add a filter input" / "add a search bar"
  if (/\badd\s+(?:a|an|the)\s+(?:[a-z\-]+\s+)?(?:search|filter)\b|\badd\s+(?:a|an|the)\s+search\s+(?:input|box|bar)\b/i.test(text)) {
    return emitAddSearchInput();
  }
  // "add a (contact) form"
  if (/\badd\s+(?:a|an|the)\s+(?:[a-z\-]+\s+)?form\b/i.test(text)) {
    return emitAddForm();
  }
  // "add a table" / "add a compare table" / "add a data table"
  if (/\badd\s+(?:a|an|the)\s+(?:[a-z\-]+\s+)?(?:table|grid)\b/i.test(text)) {
    return emitAddTable();
  }
  // "add a list" / "add a menu"
  if (/\badd\s+(?:a|an|the)\s+(?:[a-z\-]+\s+)?(?:list|menu)\b/i.test(text)) {
    return emitAddList();
  }
  // "add dark mode" / "add a theme toggle" / "make it dark"
  if (/\b(?:add|make)\s+(?:a\s+)?(?:dark\s*mode|theme\s+(?:toggle|switch))\b|\bmake\s+it\s+dark\b/i.test(text)) {
    return emitAddDarkMode();
  }

  return null;
}
