import { useState, useCallback, useEffect, useMemo } from 'react';
import { codeToHtml } from 'shiki';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeLanguage(language: string): string {
  const normalized = language.toLowerCase().trim();

  if (!normalized) return 'text';
  if (normalized === 'ts') return 'typescript';
  if (normalized === 'js') return 'javascript';
  if (normalized === 'sh') return 'bash';
  if (normalized === 'yml') return 'yaml';
  if (normalized === 'md') return 'markdown';

  return normalized;
}

const highlightCache = new Map<string, string>();

function fallbackHighlightedHtml(code: string): string {
  return `<pre class="shiki shiki-themes vscode-block" style="background-color:transparent;color:#d4d4d4" tabindex="0"><code>${escapeHtml(code)}</code></pre>`;
}

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`chat-code-copybutton inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium transition-all duration-200 ${
        copied
          ? 'bg-emerald-500/18 text-emerald-300'
          : 'bg-white/5 text-zinc-400 hover:bg-white/9 hover:text-zinc-100'
      } ${className}`}
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? (
        <>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function CodeBlock({ code, language, title }: { code: string; language: string; title?: string }) {
  const normalizedLanguage = useMemo(() => normalizeLanguage(language || 'text'), [language]);
  const cacheKey = useMemo(() => `${normalizedLanguage}::${code}`, [normalizedLanguage, code]);
  const [highlightedCode, setHighlightedCode] = useState<string>(() => highlightCache.get(cacheKey) ?? fallbackHighlightedHtml(code));

  useEffect(() => {
    let cancelled = false;

    const cached = highlightCache.get(cacheKey);
    if (cached) {
      setHighlightedCode(cached);
      return () => {
        cancelled = true;
      };
    }

    setHighlightedCode(fallbackHighlightedHtml(code));

    codeToHtml(code, {
      lang: normalizedLanguage,
      theme: 'dark-plus',
    }).then((html) => {
      if (cancelled) return;
      highlightCache.set(cacheKey, html);
      setHighlightedCode(html);
    }).catch(() => {
      if (cancelled) return;
      const fallback = fallbackHighlightedHtml(code);
      highlightCache.set(cacheKey, fallback);
      setHighlightedCode(fallback);
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, code, normalizedLanguage]);

  return (
    <div className="chat-code-panel group/code my-5 w-full overflow-hidden">
      <div className="chat-code-toolbar flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="chat-code-language rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[#d7dbe4]">
            {normalizedLanguage}
          </span>
          {title && (
            <span className="truncate text-[11px] text-zinc-500">
              {title}
            </span>
          )}
        </div>
        <CopyButton text={code} />
      </div>
      <div className="chat-code-shell" dangerouslySetInnerHTML={{ __html: highlightedCode }} />
    </div>
  );
}

type Segment =
  | { type: 'text'; content: string }
  | { type: 'code'; code: string; language: string; title?: string };

type CodeVisibility = 'show' | 'compact';

function CompactCodeBlock({ code, language, title }: { code: string; language: string; title?: string }) {
  const [expanded, setExpanded] = useState(false);
  const normalizedLanguage = useMemo(() => normalizeLanguage(language || 'text'), [language]);
  const lineCount = useMemo(() => Math.max(1, code.split('\n').length), [code]);

  if (expanded) {
    return (
      <div className="my-5 space-y-2">
        <div className="flex justify-end">
          <button
            onClick={() => setExpanded(false)}
            className="rounded-full bg-white/5 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400 transition-colors hover:bg-white/9 hover:text-zinc-200"
          >
            Hide code
          </button>
        </div>
        <CodeBlock code={code} language={language} title={title} />
      </div>
    );
  }

  return (
    <div className="chat-code-collapsed my-4 flex items-center justify-between gap-3 rounded-2xl px-3.5 py-3">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-400">
          <span>{normalizedLanguage}</span>
          <span className="h-1 w-1 rounded-full bg-zinc-700" />
          <span>{lineCount} lines</span>
        </div>
        <div className="mt-1 truncate text-[12px] text-zinc-500">
          {title || 'Code is hidden in chat. Open Preview > Code to inspect or edit, or reveal it here.'}
        </div>
      </div>
      <button
        onClick={() => setExpanded(true)}
        className="shrink-0 rounded-full bg-white/6 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-200 transition-colors hover:bg-white/10"
      >
        Show code
      </button>
    </div>
  );
}

function parseMarkdown(content: string): Segment[] {
  const segments: Segment[] = [];
  const codeBlockRegex = /```(\w*)(?:\s+title=["']([^"']+)["'])?\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', code: match[3].trimEnd(), language: match[1], title: match[2] || undefined });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) });
  }

  return segments;
}

/** Apply inline token formatting (bold, italic, code, links) to a plain text string */
function applyInlineStyles(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code class="inline-code rounded px-1.5 py-0.5 text-[13px] font-mono">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-zinc-50">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-violet-300 transition-colors hover:text-violet-200 hover:underline" target="_blank" rel="noopener">$1</a>');
}

/**
 * Render one paragraph-block (text between double-newlines) into HTML.
 * Handles headings, bullet lists, ordered lists, and mixed prose with inline
 * elements — without collapsing everything into a single <br/>-joined blob.
 */
function renderBlock(block: string): string {
  const lines = block.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const parts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading line
    const hm = line.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      const level = hm[1].length;
      const cls = level === 1
        ? 'mt-5 mb-2 text-xl font-bold text-zinc-50 leading-tight tracking-tight'
        : level === 2
          ? 'mt-4 mb-2 text-[17px] font-semibold text-zinc-100 leading-tight tracking-tight'
          : 'mt-3 mb-1.5 text-[15px] font-semibold text-zinc-200 tracking-tight';
      parts.push(`<h${level} class="${cls}">${applyInlineStyles(hm[2])}</h${level}>`);
      i++;
      continue;
    }

    // Bullet list: collect consecutive bullet lines
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${applyInlineStyles(lines[i].replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      parts.push(`<ul class="my-2.5 space-y-1.5 pl-5 list-disc marker:text-zinc-500 text-zinc-200">${items.join('')}</ul>`);
      continue;
    }

    // Ordered list: collect consecutive numbered lines
    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) {
        items.push(`<li>${applyInlineStyles(lines[i].replace(/^\d+[.)]\s+/, ''))}</li>`);
        i++;
      }
      parts.push(`<ol class="my-2.5 space-y-1.5 pl-5 list-decimal marker:text-zinc-500 text-zinc-200">${items.join('')}</ol>`);
      continue;
    }

    // Regular prose: collect until next heading/list marker
    const textLines: string[] = [];
    while (
      i < lines.length &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+[.)]\s+/.test(lines[i])
    ) {
      textLines.push(applyInlineStyles(lines[i]));
      i++;
    }
    if (textLines.length > 0) {
      parts.push(`<p class="mb-3 last:mb-0">${textLines.join('<br/>')}</p>`);
    }
  }

  return parts.join('\n');
}

function renderInlineMarkdown(text: string): string {
  // Split on paragraph breaks (2+ newlines), render each block, rejoin
  return text
    .split(/\n{2,}/)
    .filter((b) => b.trim())
    .map(renderBlock)
    .join('\n');
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  codeVisibility?: CodeVisibility;
}

export function MarkdownRenderer({ content, className = '', codeVisibility = 'show' }: MarkdownRendererProps) {
  const segments = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className={`chat-markdown prose prose-invert prose-sm max-w-none break-words [overflow-wrap:anywhere] ${className}`}>
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          codeVisibility === 'compact'
            ? <CompactCodeBlock key={i} code={seg.code} language={seg.language} title={seg.title} />
            : <CodeBlock key={i} code={seg.code} language={seg.language} title={seg.title} />
        ) : (
          <div
            key={i}
            className="chat-markdown__segment text-[15px] leading-7 text-zinc-200 break-words [overflow-wrap:anywhere]"
            dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(seg.content) }}
          />
        ),
      )}
    </div>
  );
}
