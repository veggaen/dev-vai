import { MarkdownRenderer } from '@vai/ui';
import { API_BASE } from '../lib/api.js';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  imageId?: string | null;
  imagePreview?: string;
}

export function MessageBubble({ role, content, imageId, imagePreview }: MessageBubbleProps) {
  const isUser = role === 'user';

  // Determine image source: preview (pasted, not yet persisted) or server URL
  const imageSrc = imagePreview || (imageId ? `${API_BASE}/api/images/${imageId}/raw` : null);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[75%] overflow-hidden rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-100'
        }`}
      >
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
