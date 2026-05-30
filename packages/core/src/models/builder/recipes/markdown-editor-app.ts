import { composeAppShell } from '../app-shell/index.js';

const MD_TOP_MATTER = String.raw`
const STORAGE_KEY = 'vai.markdown.v1';

const STARTER = [
  '# Hello, Markdown',
  '',
  'Write on the left, preview on the right.',
  '',
  '## What works',
  '',
  '- **Bold**, *italic*, and ` + '`' + `inline code` + '`' + String.raw`',
  '- Bullet and numbered lists',
  '- Headings, links, blockquotes',
  '- Fenced code blocks',
  '',
  '1. Try editing this document',
  '2. Watch the preview update live',
  '3. Copy as HTML when you are done',
  '',
  '> Auto-saved to your browser — refresh and your draft is still here.',
  '',
  'Read more at [example](https://example.com).',
  '',
].join('\n');

function loadDoc(): string {
  if (typeof window === 'undefined') return STARTER;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ?? STARTER;
  } catch { return STARTER; }
}

function saveDoc(text: string) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, text); } catch {}
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/` + '`([^`]+)`' + String.raw`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return out;
}

const FENCE_RE = new RegExp('^' + String.fromCharCode(96).repeat(3));

function renderMarkdown(src: string): string {
  const lines = src.split(/\r?\n/);
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) { code.push(lines[i]); i++; }
      i++;
      blocks.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
      continue;
    }
    const hMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (hMatch) {
      const level = hMatch[1].length;
      blocks.push('<h' + level + '>' + renderInline(hMatch[2]) + '</h' + level + '>');
      i++; continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push('<blockquote>' + renderInline(quote.join(' ')) + '</blockquote>');
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push('<li>' + renderInline(lines[i].replace(/^[-*+]\s+/, '')) + '</li>');
        i++;
      }
      blocks.push('<ul>' + items.join('') + '</ul>');
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push('<li>' + renderInline(lines[i].replace(/^\d+\.\s+/, '')) + '</li>');
        i++;
      }
      blocks.push('<ol>' + items.join('') + '</ol>');
      continue;
    }
    if (/^\s*$/.test(line)) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !/^>\s?/.test(lines[i]) && !/^[-*+]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i]) && !FENCE_RE.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push('<p>' + renderInline(para.join(' ')) + '</p>');
  }
  return blocks.join('\n');
}
`;

const MD_SETUP = String.raw`  const [text, setText] = useState<string>(() => loadDoc());
  const [copied, setCopied] = useState(false);

  useEffect(() => { saveDoc(text); }, [text]);

  const html = useMemo(() => renderMarkdown(text), [text]);
  const words = useMemo(() => text.trim() ? text.trim().split(/\s+/).length : 0, [text]);
  const chars = text.length;

  async function copyHtml() {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(html);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }
    } catch {}
  }

  function clearDoc() {
    if (!window.confirm('Clear the document?')) return;
    setText('');
  }
`;

const MD_BODY = String.raw`      <div className="md-toolbar vai-card">
        <div className="md-stats">
          <span><strong>{words}</strong> words</span>
          <span><strong>{chars}</strong> chars</span>
          <span className="md-saved">Auto-saved</span>
        </div>
        <div className="md-actions">
          <button type="button" className="md-btn" onClick={copyHtml}>{copied ? 'Copied!' : 'Copy HTML'}</button>
          <button type="button" className="md-btn md-btn-ghost" onClick={clearDoc}>Clear</button>
        </div>
      </div>

      <div className="md-split">
        <div className="md-pane md-editor vai-card">
          <div className="md-pane-label">Editor</div>
          <textarea
            className="md-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="Start typing markdown..."
          />
        </div>
        <div className="md-pane md-preview vai-card">
          <div className="md-pane-label">Preview</div>
          <div className="md-preview-body" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>`;

const MD_CSS = String.raw`.md-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; padding: 10px 14px; flex-wrap: wrap;
}
.md-stats { display: flex; gap: 16px; font-size: 13px; color: var(--vai-muted); align-items: center; flex-wrap: wrap; }
.md-stats strong { color: var(--vai-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.md-saved { color: var(--vai-success); font-size: 12px; }
.md-actions { display: flex; gap: 8px; }
.md-btn {
  background: var(--vai-accent); color: white; border: none;
  border-radius: var(--vai-radius-sm); padding: 8px 14px;
  font-weight: 600; font-size: 13px; cursor: pointer;
  transition: filter 140ms ease;
}
.md-btn:hover { filter: brightness(1.15); }
.md-btn-ghost {
  background: transparent; color: var(--vai-muted);
  border: 1px solid var(--vai-border-strong);
}
.md-btn-ghost:hover { color: var(--vai-danger); border-color: var(--vai-danger); filter: none; }

.md-split { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; min-height: 480px; }
.md-pane { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.md-pane-label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--vai-muted); padding: 10px 14px; border-bottom: 1px solid var(--vai-border);
  font-weight: 600;
}
.md-textarea {
  flex: 1; background: transparent; border: none; outline: none;
  color: var(--vai-text); padding: 14px;
  font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 14px; line-height: 1.6;
  resize: none; min-height: 420px;
}
.md-preview-body { padding: 14px 18px; overflow: auto; }
.md-preview-body h1, .md-preview-body h2, .md-preview-body h3 { color: var(--vai-text); margin: 16px 0 8px; line-height: 1.2; }
.md-preview-body h1 { font-size: 26px; }
.md-preview-body h2 { font-size: 20px; }
.md-preview-body h3 { font-size: 16px; }
.md-preview-body p { color: var(--vai-text); line-height: 1.65; margin: 8px 0; }
.md-preview-body a { color: var(--vai-accent); text-decoration: underline; }
.md-preview-body strong { color: var(--vai-text); font-weight: 700; }
.md-preview-body em { color: var(--vai-text); font-style: italic; }
.md-preview-body ul, .md-preview-body ol { color: var(--vai-text); padding-left: 22px; margin: 8px 0; line-height: 1.6; }
.md-preview-body li { margin: 4px 0; }
.md-preview-body blockquote {
  border-left: 3px solid var(--vai-accent); padding: 6px 14px; margin: 12px 0;
  color: var(--vai-muted); background: var(--vai-surface-2); border-radius: 0 6px 6px 0;
}
.md-preview-body code {
  background: var(--vai-surface-2); padding: 1px 6px; border-radius: 4px;
  font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 13px;
  color: var(--vai-accent-2);
}
.md-preview-body pre {
  background: var(--vai-bg); border: 1px solid var(--vai-border);
  padding: 12px 14px; border-radius: 8px; overflow: auto; margin: 12px 0;
}
.md-preview-body pre code { background: transparent; padding: 0; color: var(--vai-text); }

@media (max-width: 720px) {
  .md-split { grid-template-columns: 1fr; }
  .md-textarea { min-height: 260px; }
}
`;

export function generateMarkdownEditorApp(brief: string): string {
  void brief;
  return composeAppShell({
    packageName: 'vai-markdown-app',
    title: 'Markdown · Vai',
    hero: {
      badge: 'Write better',
      title: 'Markdown in real time.',
      accentWord: 'real time',
      subtitle: 'Type on the left, watch beautiful preview render on the right. Auto-saved, word-counted, exportable.',
      pills: ['Live preview', 'Word count', 'Auto-save', 'Copy HTML'],
    },
    topMatter: MD_TOP_MATTER,
    setupCode: MD_SETUP,
    bodyJsx: MD_BODY,
    extraCss: MD_CSS,
    theme: { accent: '#5ce1ff', accent2: '#7c5cff' },
  });
}

export function markdownEditorPlan(): string {
  return [
    '**Plan**',
    '',
    'Building a real Markdown editor:',
    '',
    '- Polished landing hero from Vai\'s shared design system',
    '- Split editor / live preview, responsive (stacked on mobile)',
    '- Word + char counts, auto-save to `localStorage`',
    '- One-click Copy HTML',
    '',
  ].join('\n');
}
