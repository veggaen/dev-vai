import { useRef, useEffect, useState, useCallback } from 'react';
import { useChatStore } from '../stores/chatStore.js';
import { MessageBubble } from './MessageBubble.js';

interface PastedImage {
  data: string;       // base64 (no prefix)
  mimeType: string;
  preview: string;    // data URL for display
  sizeBytes: number;
  width?: number;
  height?: number;
}

export function ChatWindow() {
  const { messages, activeConversationId, isStreaming, sendMessage } =
    useChatStore();
  const [input, setInput] = useState('');
  const [pastedImage, setPastedImage] = useState<PastedImage | null>(null);
  const [imageDescription, setImageDescription] = useState('');
  const [imageQuestion, setImageQuestion] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  // Handle Ctrl+V paste for images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1];
          const mimeType = item.type;

          // Get dimensions
          const img = new Image();
          img.onload = () => {
            setPastedImage({
              data: base64,
              mimeType,
              preview: dataUrl,
              sizeBytes: file.size,
              width: img.width,
              height: img.height,
            });
            // Focus the description input
            setTimeout(() => descriptionRef.current?.focus(), 100);
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  }, []);

  const clearImage = useCallback(() => {
    setPastedImage(null);
    setImageDescription('');
    setImageQuestion('');
  }, []);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!activeConversationId || isStreaming) return;

    // If there's a pasted image, description is required
    if (pastedImage) {
      if (!imageDescription.trim()) {
        descriptionRef.current?.focus();
        return;
      }
      sendMessage(trimmed, {
        data: pastedImage.data,
        mimeType: pastedImage.mimeType,
        description: imageDescription.trim(),
        question: imageQuestion.trim() || undefined,
        width: pastedImage.width,
        height: pastedImage.height,
        sizeBytes: pastedImage.sizeBytes,
      });
      clearImage();
    } else {
      if (!trimmed) return;
      sendMessage(trimmed);
    }

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const charCount = input.length;

  if (!activeConversationId) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <div className="px-6 text-center">
          <h2 className="mb-3 text-3xl font-bold text-zinc-200">VeggaAI</h2>
          <p className="mb-6 text-sm text-zinc-500">
            Select a conversation or start a new chat
          </p>
          <div className="mx-auto max-w-sm space-y-2 text-left text-xs text-zinc-600">
            <p>Try saying:</p>
            <p className="rounded-lg border border-zinc-800 px-3 py-2 text-zinc-400">&quot;hello&quot;</p>
            <p className="rounded-lg border border-zinc-800 px-3 py-2 text-zinc-400">&quot;what can you do?&quot;</p>
            <p className="rounded-lg border border-zinc-800 px-3 py-2 text-zinc-400">&quot;React is a JavaScript library&quot;</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto max-w-3xl px-4 py-6">
          {messages.length === 0 && (
            <div className="flex items-center justify-center py-20">
              <p className="text-sm text-zinc-600">Send a message to start the conversation</p>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              imageId={msg.imageId}
              imagePreview={msg.imagePreview}
            />
          ))}
          {isStreaming && messages[messages.length - 1]?.content === '' && (
            <div className="mb-4 flex justify-start">
              <div className="flex items-center space-x-1.5 rounded-2xl bg-zinc-800 px-4 py-3">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: '0ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-4 py-3">
          {/* Image preview (shown when an image is pasted) */}
          {pastedImage && (
            <div className="mb-3 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
              <div className="mb-2 flex items-start gap-3">
                <img
                  src={pastedImage.preview}
                  alt="Pasted screenshot"
                  className="h-20 w-auto rounded border border-zinc-600 object-contain"
                />
                <div className="flex-1 space-y-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-400">
                      Description <span className="text-red-400">*</span>
                      <span className="ml-1 font-normal text-zinc-600">(at least 1 true fact)</span>
                    </label>
                    <input
                      ref={descriptionRef}
                      type="text"
                      value={imageDescription}
                      onChange={(e) => setImageDescription(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                        if (e.key === 'Escape') clearImage();
                      }}
                      placeholder="e.g. 'This shows the React component tree with a bug in the useEffect hook'"
                      className="w-full rounded border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-400">
                      Question <span className="font-normal text-zinc-600">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={imageQuestion}
                      onChange={(e) => setImageQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                        if (e.key === 'Escape') clearImage();
                      }}
                      placeholder="e.g. 'What is causing this error?' or 'How should I fix this layout?'"
                      className="w-full rounded border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <button
                  onClick={clearImage}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
                  title="Remove image (Esc)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                <span>{pastedImage.mimeType}</span>
                <span>{pastedImage.width}x{pastedImage.height}</span>
                <span>{(pastedImage.sizeBytes / 1024).toFixed(0)}KB</span>
                {!imageDescription.trim() && (
                  <span className="ml-auto text-amber-500">Description required to send</span>
                )}
              </div>
            </div>
          )}

          <div className="relative flex items-end rounded-xl border border-zinc-700 bg-zinc-900 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={pastedImage ? "Add a message (optional with image)" : "Message VeggaAI... (Ctrl+V to paste image, Shift+Enter for new line)"}
              rows={1}
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
            />
            <div className="flex shrink-0 items-center gap-2 px-2 pb-2">
              {charCount > 0 && (
                <span className="text-xs text-zinc-600">{charCount}</span>
              )}
              {pastedImage && (
                <span className="text-xs text-blue-400" title="Image attached">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.69l-2.22-2.219a.75.75 0 00-1.06 0l-1.91 1.909.47.47a.75.75 0 11-1.06 1.06L6.53 8.091a.75.75 0 00-1.06 0L2.5 11.06zm10-1.56a1.75 1.75 0 113.5 0 1.75 1.75 0 01-3.5 0z" clipRule="evenodd" />
                  </svg>
                </span>
              )}
              <button
                onClick={handleSend}
                disabled={(!input.trim() && !pastedImage) || isStreaming || (!!pastedImage && !imageDescription.trim())}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white transition-all hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500"
                title="Send message (Enter)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
                </svg>
              </button>
            </div>
          </div>
          <p className="mt-1.5 text-center text-xs text-zinc-700">
            VAI v0 — Ctrl+V to paste screenshots for image training. Teach me by capturing pages with the extension.
          </p>
        </div>
      </div>
    </div>
  );
}
