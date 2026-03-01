import { useState, useCallback } from 'react';
import { MarkdownRenderer } from '@vai/ui';
import { API_BASE } from '../lib/api.js';
import { Copy, Check, FileText } from 'lucide-react';

interface FileAttachment {
  name: string;
  content: string;
  language: string;
}

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  imageId?: string | null;
  imagePreview?: string;
  files?: FileAttachment[];
}

export function MessageBubble({ role, content, imageId, imagePreview, files }: MessageBubbleProps) {
  const isUser = role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopyAll = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  // Determine image source: preview (pasted, not yet persisted) or server URL
  const imageSrc = imagePreview || (imageId ? `${API_BASE}/api/images/${imageId}/raw` : null);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} group/msg mb-4`}>
      <div
        className={`relative max-w-[75%] overflow-hidden rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-100'
        }`}
      >
        {/* Copy All button — appears on hover for assistant messages */}
        {!isUser && content.length > 0 && (
          <button
            onClick={handleCopyAll}
            className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-zinc-700/80 px-2 py-1 text-[10px] font-medium text-zinc-400 opacity-0 backdrop-blur-sm transition-opacity hover:text-zinc-200 group-hover/msg:opacity-100"
            title="Copy entire response"
          >
            {copied ? (
              <><Check className="h-3 w-3 text-emerald-400" /> Copied</>
            ) : (
              <><Copy className="h-3 w-3" /> Copy all</>
            )}
          </button>
        )}

        {imageSrc && (
          <div className="mb-2">
            <img
              src={imageSrc}
              alt="Attached screenshot"
              className="max-h-64 w-auto rounded-lg border border-white/10"
              loading="lazy"
            />
          </div>
        )}

        {/* File attachments */}
        {files && files.length > 0 && (
          <div className="mb-2 space-y-1">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-zinc-600/50 bg-zinc-900/60 px-3 py-1.5">
                <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <span className="truncate text-xs font-medium text-zinc-300">{f.name}</span>
                <span className="text-[10px] text-zinc-500">{f.language}</span>
              </div>
            ))}
          </div>
        )}

        {isUser ? (
          <p className="whitespace-pre-wrap break-words text-sm">{content}</p>
        ) : (
          <div className="overflow-x-auto">
            <MarkdownRenderer content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
