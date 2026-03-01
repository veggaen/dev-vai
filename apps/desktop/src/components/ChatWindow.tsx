import { useRef, useEffect, useState, useCallback } from 'react';
import { useChatStore } from '../stores/chatStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { useLayoutStore, MODE_PLACEHOLDERS } from '../stores/layoutStore.js';
import { MessageBubble } from './MessageBubble.js';
import { ModeSelector } from './ModeSelector.js';
import {
  Code, Zap, Sparkles, BookOpen, Shield, MessageCircle,
  Paperclip, X, FileText, ArrowUp, Image as ImageIcon, Square,
} from 'lucide-react';

/* ── Preset suggestions shown when no messages ── */
const PRESETS = [
  { label: 'Scaffold a Next.js app', icon: Code, category: 'Build' },
  { label: 'Create a REST API', icon: Zap, category: 'Build' },
  { label: 'Build a landing page', icon: Sparkles, category: 'Build' },
  { label: 'Explain React 19 features', icon: BookOpen, category: 'Learn' },
  { label: 'OWASP Top 10 summary', icon: Shield, category: 'Learn' },
  { label: 'Compare Prisma vs Drizzle', icon: MessageCircle, category: 'Learn' },
];

/* ── File extension detection ── */
const CODE_PATTERNS: { test: RegExp; ext: string }[] = [
  { test: /^import\s+.*from\s+['"]|^export\s+(default\s+)?/m, ext: 'tsx' },
  { test: /^const\s+\w+\s*[:=]|^let\s+|^var\s+|^function\s+\w+\s*\(|=>\s*\{/m, ext: 'ts' },
  { test: /^<\w+[\s>]|<\/\w+>/m, ext: 'html' },
  { test: /^\.\w+\s*\{|^@media|^@import/m, ext: 'css' },
  { test: /^{[\s\n]*"/m, ext: 'json' },
  { test: /^#!/m, ext: 'sh' },
  { test: /^def\s+\w+|^class\s+\w+|^import\s+\w+$/m, ext: 'py' },
];

function detectFileExtension(text: string): string {
  for (const p of CODE_PATTERNS) {
    if (p.test.test(text)) return p.ext;
  }
  // Long text without code patterns → markdown
  return 'md';
}

interface PastedImage {
  data: string;
  mimeType: string;
  preview: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

interface FileAttachment {
  id: string;
  name: string;
  content: string;
  language: string;
  sizeBytes: number;
}

const LARGE_PASTE_THRESHOLD = 500; // chars — above this, isolate as file

export function ChatWindow() {
  const {
    messages,
    activeConversationId,
    isStreaming,
    sendMessage,
    createConversation,
  } = useChatStore();
  const { selectedModelId } = useSettingsStore();
  const { mode } = useLayoutStore();

  const [input, setInput] = useState('');
  const [pastedImage, setPastedImage] = useState<PastedImage | null>(null);
  const [imageDescription, setImageDescription] = useState('');
  const [imageQuestion, setImageQuestion] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasMessages = activeConversationId && messages.length > 0;
  const hasContent = input.trim().length > 0 || pastedImage || attachedFiles.length > 0;

  // Auto-scroll on new messages
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

  useEffect(() => { resizeTextarea(); }, [input, resizeTextarea]);

  // Image paste + smart text paste
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    // Check for image
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
          const img = new Image();
          img.onload = () => {
            setPastedImage({ data: base64, mimeType, preview: dataUrl, sizeBytes: file.size, width: img.width, height: img.height });
            setTimeout(() => descriptionRef.current?.focus(), 100);
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
        return;
      }
    }

    // Smart text paste — detect large code/text blocks
    const text = e.clipboardData?.getData('text/plain');
    if (text && text.length > LARGE_PASTE_THRESHOLD) {
      e.preventDefault();
      const ext = detectFileExtension(text);
      const lineCount = text.split('\n').length;
      const name = `pasted-${attachedFiles.length + 1}.${ext}`;
      setAttachedFiles((prev) => [
        ...prev,
        {
          id: `file-${Date.now()}`,
          name,
          content: text,
          language: ext,
          sizeBytes: new Blob([text]).size,
        },
      ]);
      // Optionally set a short reference in the input
      if (!input.trim()) {
        setInput(`Analyze attached ${ext} file (${lineCount} lines)`);
      }
    }
  }, [attachedFiles.length, input]);

  // File upload handler
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        const ext = file.name.split('.').pop() || detectFileExtension(content);
        setAttachedFiles((prev) => [
          ...prev,
          {
            id: `file-${Date.now()}-${file.name}`,
            name: file.name,
            content,
            language: ext,
            sizeBytes: file.size,
          },
        ]);
      };
      reader.readAsText(file);
    });

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeFile = useCallback((id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearImage = useCallback(() => {
    setPastedImage(null);
    setImageDescription('');
    setImageQuestion('');
  }, []);

  /**
   * Send message — auto-creates a conversation if none is active.
   * Requires text when images or files are attached.
   */
  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (isStreaming) return;

    // Must have text — images and files require description/context
    if (!text) return;
    if (pastedImage && !imageDescription.trim()) {
      descriptionRef.current?.focus();
      return;
    }

    // Auto-create conversation if none active
    let convId = activeConversationId;
    if (!convId) {
      if (!selectedModelId) return;
      convId = await createConversation(selectedModelId);
    }
    if (!convId) return;

    // Build message content with file attachments inline
    let fullContent = text;
    if (attachedFiles.length > 0) {
      const fileSections = attachedFiles.map(
        (f) => `\n\n---\n📎 **${f.name}** (${f.language}, ${(f.sizeBytes / 1024).toFixed(1)}KB)\n\`\`\`${f.language}\n${f.content}\n\`\`\``
      );
      fullContent = text + fileSections.join('');
    }

    // Send
    if (pastedImage) {
      sendMessage(fullContent, {
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
      sendMessage(fullContent);
    }

    setInput('');
    setAttachedFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handlePresetClick = (label: string) => {
    handleSend(label);
  };

  const charCount = input.length;
  const canSend = (input.trim().length > 0) && !isStreaming && (!pastedImage || imageDescription.trim().length > 0);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.md,.tsx,.ts,.js,.jsx,.json,.css,.html,.py,.sh,.yaml,.yml,.toml,.xml,.sql,.csv,.env,.log"
        onChange={handleFileUpload}
        className="hidden"
      />
      {/* Messages / Welcome area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        {!hasMessages ? (
          /* ── Empty state: greeting + presets ── */
          <div className="flex h-full flex-col items-center justify-center px-6">
            <div className="mb-8 text-center">
              <h1 className="mb-2 text-3xl font-bold tracking-tight text-zinc-100">
                How can I help you?
              </h1>
              <p className="text-sm text-zinc-500">
                Ask anything, or pick a starter below.
              </p>
            </div>

            {/* Category pills */}
            <div className="mb-6 flex gap-2">
              {['Build', 'Learn'].map((cat) => (
                <span
                  key={cat}
                  className="rounded-full border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-400"
                >
                  {cat}
                </span>
              ))}
            </div>

            {/* Preset suggestion cards */}
            <div className="w-full max-w-lg space-y-2">
              {PRESETS.map((p) => {
                const Icon = p.icon;
                return (
                  <button
                    key={p.label}
                    onClick={() => handlePresetClick(p.label)}
                    className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 px-4 py-3 text-left text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-900"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-zinc-500" />
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* ── Message list ── */
          <div className="mx-auto max-w-3xl px-4 py-6">
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
        )}
      </div>

      {/* ── Input area — always at bottom ── */}
      <div className="border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-4 py-3">
          {/* Image preview */}
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
                    </label>
                    <input
                      ref={descriptionRef}
                      type="text"
                      value={imageDescription}
                      onChange={(e) => setImageDescription(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                        if (e.key === 'Escape') clearImage();
                      }}
                      placeholder="e.g. 'React component tree with a bug'"
                      className="w-full rounded border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
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
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                        if (e.key === 'Escape') clearImage();
                      }}
                      placeholder="e.g. 'What is causing this error?'"
                      className="w-full rounded border border-zinc-600 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  onClick={clearImage}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
                  title="Remove image (Esc)"
                >
                  x
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

          {/* Attached files chips */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-1">
              {attachedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-xs text-zinc-300"
                >
                  <FileText className="h-3 w-3 text-zinc-500" />
                  <span className="max-w-[120px] truncate">{file.name}</span>
                  <span className="text-[10px] text-zinc-600">{(file.sizeBytes / 1024).toFixed(1)}KB</span>
                  <button
                    onClick={() => removeFile(file.id)}
                    className="ml-0.5 rounded p-0.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300"
                    title="Remove file"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Text input */}
          <div className="relative flex flex-col rounded-xl border border-zinc-700 bg-zinc-900 focus-within:border-zinc-500 focus-within:ring-1 focus-within:ring-zinc-500/50">
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
              placeholder={pastedImage ? 'Describe what you need help with...' : MODE_PLACEHOLDERS[mode]}
              rows={1}
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
            />
            {/* Bottom toolbar */}
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="flex items-center gap-1">
                <ModeSelector />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                  title="Attach files"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                {charCount > 0 && (
                  <span className="text-[11px] tabular-nums text-zinc-600">{charCount}</span>
                )}
                {isStreaming ? (
                  <button
                    onClick={() => {/* TODO: stop streaming */}}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-zinc-300 transition-all hover:bg-zinc-600"
                    title="Stop generating"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleSend()}
                    disabled={!canSend}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-zinc-900 transition-all hover:bg-zinc-200 disabled:bg-zinc-700 disabled:text-zinc-500"
                    title="Send message (Enter)"
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="mt-1.5 text-center text-xs text-zinc-700">
            Ctrl+V to paste images · Paperclip to attach files · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
