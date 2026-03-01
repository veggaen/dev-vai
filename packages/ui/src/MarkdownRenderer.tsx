import { useState, useCallback, useMemo } from 'react';

/* ── Copy button for code blocks ── */
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
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
        copied
          ? 'bg-emerald-500/20 text-emerald-400'
          : 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
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

/* ── Code block with language label + copy ── */
function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <div className="group/code relative my-3 overflow-hidden rounded-lg border border-zinc-700/60 bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-700/60 bg-zinc-800/50 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {language || 'code'}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className="text-zinc-200">{code}</code>
      </pre>
    </div>
  );
}

/* ── Parsed segment types ── */
type Segment =
  | { type: 'text'; content: string }
  | { type: 'code'; code: string; language: string };

function parseMarkdown(content: string): Segment[] {
  const segments: Segment[] = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', code: match[2].trimEnd(), language: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) });
  }

  return segments;
}

function renderInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code class="rounded bg-zinc-800 px-1.5 py-0.5 text-[13px] text-blue-300 font-mono">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-zinc-100">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-400 hover:underline" target="_blank" rel="noopener">$1</a>')
    .replace(/^### (.+)$/gm, '<h3 class="mt-4 mb-2 text-base font-semibold text-zinc-100">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="mt-4 mb-2 text-lg font-semibold text-zinc-100">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="mt-4 mb-2 text-xl font-bold text-zinc-100">$1</h1>')
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc text-zinc-300">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-zinc-300">$1</li>')
    .replace(/\n/g, '<br/>');
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const segments = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className={`prose prose-invert prose-sm max-w-none ${className}`}>
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <CodeBlock key={i} code={seg.code} language={seg.language} />
        ) : (
          <div
            key={i}
            className="text-sm leading-relaxed text-zinc-300"
            dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(seg.content) }}
          />
        ),
      )}
    </div>
  );
}
