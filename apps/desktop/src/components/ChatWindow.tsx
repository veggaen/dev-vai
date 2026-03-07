/**
 * ChatWindow — Claude-inspired chat interface.
 *
 * Layout philosophy:
 *   • Empty state: centered welcome + presets in the middle of the window.
 *   • First message: welcome fades out, messages appear ABOVE the input.
 *   • New messages push previous ones UP. The input stays anchored near the
 *     bottom so the user's eyes stay focused on the latest content.
 *   • Smart auto-scroll: auto-follows during streaming unless user scrolled up.
 *   • Scroll-to-bottom FAB when user has scrolled away.
 *   • Auto-growing textarea (1 line → max ~8 lines) with Enter to send.
 *   • Draggable divider between messages and input.
 *
 * Key CSS trick for "messages above input":
 *   The scroll container uses `flex-col justify-end` so when messages are sparse
 *   they sit at the BOTTOM of the viewport, right above the input. As messages
 *   accumulate they naturally push upward and overflow triggers scroll.
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useChatStore } from '../stores/chatStore.js';
import { useSettingsStore } from '../stores/settingsStore.js';
import { toast } from 'sonner';
import { useLayoutStore, MODE_PLACEHOLDERS, MODE_SYSTEM_PROMPTS } from '../stores/layoutStore.js';
import { MessageBubble } from './MessageBubble.js';
import { ModeSelector } from './ModeSelector.js';
import { ScrollToBottom } from './ScrollToBottom.js';
import { TypingIndicator } from './TypingIndicator.js';
import { useAutoScroll } from '../hooks/useAutoScroll.js';
import { useIntentStore, computeFallbackMap } from '../stores/intentStore.js';
import {
  Code, Zap, Sparkles, BookOpen, Shield, MessageCircle,
  Paperclip, X, FileText, ArrowUp, Square,
  Layout, Rocket, Globe, Eye, EyeOff, Brain,
} from 'lucide-react';
import { FocusModeToggle } from './LayoutModeToggle.js';

/* ── Preset suggestions for empty state ── */
const PRESETS = [
  { label: 'Scaffold a Next.js app', icon: Code, category: 'Build' },
  { label: 'Create a REST API', icon: Zap, category: 'Build' },
  { label: 'Build a landing page', icon: Layout, category: 'Build' },
  { label: 'Deploy from a template', icon: Rocket, category: 'Deploy' },
  { label: 'Explain React 19 features', icon: BookOpen, category: 'Learn' },
  { label: 'Compare Prisma vs Drizzle', icon: MessageCircle, category: 'Explore' },
];

/* ── Quick suggestion chips (inline above input when empty) ── */
const QUICK_CHIPS = [
  { label: 'Build something', icon: Sparkles },
  { label: 'Explain a concept', icon: BookOpen },
  { label: 'Debug my code', icon: Shield },
  { label: 'Browse the web', icon: Globe },
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

const LARGE_PASTE_THRESHOLD = 500;
const MIN_INPUT_HEIGHT = 56;
const MAX_INPUT_HEIGHT = 200;

export function ChatWindow() {
  const {
    messages,
    activeConversationId,
    isStreaming,
    sendMessage,
    stopStreaming,
    createConversation,
    learningEnabled,
    setLearningEnabled,
  } = useChatStore();
  const { selectedModelId } = useSettingsStore();
  const { mode, showBuilderPanel, toggleBuilderPanel } = useLayoutStore();

  const [input, setInput] = useState('');
  const [pastedImage, setPastedImage] = useState<PastedImage | null>(null);
  const [imageDescription, setImageDescription] = useState('');
  const [imageQuestion, setImageQuestion] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasMessages = activeConversationId && messages.length > 0;

  /* ── Smart auto-scroll ── */
  const { scrollRef, showScrollButton, scrollToBottom } = useAutoScroll({
    messageCount: messages.length,
    isStreaming,
  });

  /* ── Adaptive intent tracking ── */
  const intentStore = useIntentStore();
  const { recordUserAction, recordDeployTriggered, setBuildMode, resetConversation } = intentStore;

  const isBuildMode = mode === 'agent' || mode === 'builder';
  useEffect(() => { setBuildMode(isBuildMode); }, [isBuildMode, setBuildMode]);
  useEffect(() => { resetConversation(); }, [activeConversationId, resetConversation]);

  const fallbackDeployMap = useMemo(
    () => computeFallbackMap(messages, intentStore),
    [messages, intentStore.intents, intentStore.adaptiveBoost],
  );

  /* ── Auto-grow textarea ── */
  const adjustTextareaHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, []);

  useEffect(() => { adjustTextareaHeight(); }, [input, adjustTextareaHeight]);

  /* ── Focus textarea on mount + after sending ── */
  useEffect(() => {
    if (!isStreaming && !pastedImage) {
      textareaRef.current?.focus();
    }
  }, [isStreaming, pastedImage, messages.length]);

  /* ── Image paste + smart text paste ── */
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

    const text = e.clipboardData?.getData('text/plain');
    if (text && text.length > LARGE_PASTE_THRESHOLD) {
      e.preventDefault();
      const ext = detectFileExtension(text);
      const lineCount = text.split('\n').length;
      const name = `pasted-${attachedFiles.length + 1}.${ext}`;
      setAttachedFiles((prev) => [
        ...prev,
        { id: `file-${Date.now()}`, name, content: text, language: ext, sizeBytes: new Blob([text]).size },
      ]);
      if (!input.trim()) {
        setInput(`Analyze attached ${ext} file (${lineCount} lines)`);
      }
    }
  }, [attachedFiles.length, input]);

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
          { id: `file-${Date.now()}-${file.name}`, name: file.name, content, language: ext, sizeBytes: file.size },
        ]);
      };
      reader.readAsText(file);
    });
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

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (isStreaming || !text) return;
    if (pastedImage && !imageDescription.trim()) {
      descriptionRef.current?.focus();
      return;
    }

    let convId = activeConversationId;
    if (!convId) {
      if (!selectedModelId) {
        toast.error('No AI model selected — open Settings to choose one');
        return;
      }
      convId = await createConversation(selectedModelId);
    }
    if (!convId) return;

    let fullContent = text;
    if (attachedFiles.length > 0) {
      const fileSections = attachedFiles.map(
        (f) => `\n\n---\n📎 **${f.name}** (${f.language}, ${(f.sizeBytes / 1024).toFixed(1)}KB)\n\`\`\`${f.language}\n${f.content}\n\`\`\``
      );
      fullContent = text + fileSections.join('');
    }

    const systemPrompt = MODE_SYSTEM_PROMPTS[mode] || undefined;

    if (pastedImage) {
      sendMessage(fullContent, {
        data: pastedImage.data, mimeType: pastedImage.mimeType,
        description: imageDescription.trim(), question: imageQuestion.trim() || undefined,
        width: pastedImage.width, height: pastedImage.height, sizeBytes: pastedImage.sizeBytes,
      }, systemPrompt);
      clearImage();
    } else {
      sendMessage(fullContent, undefined, systemPrompt);
    }

    setInput('');
    setAttachedFiles([]);
    // Reset textarea height
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    });
  };

  const handlePresetClick = (label: string) => { handleSend(label); };
  const handleChipClick = (label: string) => {
    setInput(label + ': ');
    textareaRef.current?.focus();
  };
  const charCount = input.length;
  const canSend = input.trim().length > 0 && !isStreaming && (!pastedImage || imageDescription.trim().length > 0);

  const showTypingIndicator = isStreaming && messages.length > 0 && messages[messages.length - 1]?.content === '';

  return (
    <div className="flex min-w-0 flex-1 flex-col h-full overflow-hidden relative">
      {/* Preview toggle — top-right, only shown when preview is hidden */}
      {!showBuilderPanel && (
        <button
          onClick={toggleBuilderPanel}
          className="absolute top-2 right-2 z-10 flex h-7 items-center gap-1 rounded-md border border-zinc-800/60 bg-zinc-900/80 px-2 text-[10px] text-zinc-500 backdrop-blur-sm transition-all hover:border-zinc-700 hover:text-zinc-300"
          title="Show preview (Ctrl+B)"
        >
          <Eye className="h-3 w-3" />
          <span>Preview</span>
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.md,.tsx,.ts,.js,.jsx,.json,.css,.html,.py,.sh,.yaml,.yml,.toml,.xml,.sql,.csv,.env,.log"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* ── Messages area ── */}
      <div
        ref={scrollRef}
        className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        style={{ overscrollBehavior: 'contain' }}
      >
        {/* Scroll-to-bottom FAB */}
        <ScrollToBottom visible={showScrollButton} onClick={scrollToBottom} />

        {!hasMessages ? (
          /* ═══════════ WELCOME STATE ═══════════ */
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            className="flex h-full flex-col items-center justify-center px-6"
          >
            {/* Branding */}
            <div className="mb-8 text-center">
              <div className="relative mx-auto mb-4 h-14 w-14">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 blur-xl" />
                <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-600/15 to-blue-600/15 ring-1 ring-violet-500/20">
                  <Sparkles className="h-6 w-6 text-violet-400" />
                </div>
              </div>
              <h1 className="mb-2 text-2xl font-semibold tracking-tight text-zinc-100">
                What shall we think through?
              </h1>
              <p className="text-sm text-zinc-500">
                Ask anything, build something, or pick a starter below
              </p>
            </div>

            {/* Preset cards */}
            <div className="w-full max-w-lg space-y-1.5">
              {PRESETS.map((p) => {
                const Icon = p.icon;
                return (
                  <button
                    key={p.label}
                    onClick={() => handlePresetClick(p.label)}
                    className="group/preset flex w-full items-center gap-3 rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-4 py-3 text-left text-sm text-zinc-400 transition-all duration-200 hover:border-zinc-600 hover:bg-zinc-800/50 hover:text-zinc-200 hover:shadow-lg hover:shadow-violet-500/5"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800/80 transition-colors group-hover/preset:bg-violet-500/10">
                      <Icon className="h-4 w-4 text-zinc-500 transition-colors group-hover/preset:text-violet-400" />
                    </div>
                    <span className="flex-1">{p.label}</span>
                    <span className="rounded-md bg-zinc-800/50 px-1.5 py-0.5 text-[10px] text-zinc-600 group-hover/preset:text-zinc-500">
                      {p.category}
                    </span>
                    <ArrowUp className="h-3.5 w-3.5 -rotate-45 text-zinc-700 transition-all group-hover/preset:translate-x-0.5 group-hover/preset:text-zinc-500" />
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : (
          /* ═══════════ MESSAGE THREAD ═══════════ */
          /* justify-end makes sparse messages sit at the bottom, above input */
          <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end px-4 py-4 pb-2">
            <AnimatePresence initial={false}>
              {messages.map((msg, idx) => {
                const fb = fallbackDeployMap.get(idx);
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    layout
                  >
                    <MessageBubble
                      role={msg.role}
                      content={msg.content}
                      imageId={msg.imageId}
                      imagePreview={msg.imagePreview}
                      fallbackDeploy={fb?.intent ?? null}
                      recoveryPattern={fb?.recovery ?? 'none'}
                      allIntents={fb?.allIntents}
                      onIntentAction={(accepted) => {
                        recordUserAction(idx, accepted);
                        if (accepted) recordDeployTriggered();
                      }}
                      isLatest={idx === messages.length - 1}
                      isStreaming={isStreaming && idx === messages.length - 1}
                      sources={msg.sources}
                      followUps={msg.followUps}
                      confidence={msg.confidence}
                      feedback={msg.feedback}
                      onFeedback={(helpful) => useChatStore.getState().setFeedback(msg.id, helpful)}
                      onFollowUp={(question) => sendMessage(question)}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* Typing indicator */}
            <AnimatePresence>
              {showTypingIndicator && <TypingIndicator />}
            </AnimatePresence>

            {/* Spacer to ensure last message isn't flush with divider */}
            <div className="h-2 flex-shrink-0" />
          </div>
        )}
      </div>

      {/* ── Subtle divider between messages & input ── */}
      <div className="relative flex-shrink-0">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
      </div>

      {/* ── Input area — centered, auto-growing ── */}
      <div className="flex-shrink-0 bg-zinc-950/80 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-4 pb-3 pt-3">

          {/* Quick chips — shown only when input is empty and no messages */}
          {!hasMessages && !input && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mb-2 flex flex-wrap justify-center gap-1.5"
            >
              {QUICK_CHIPS.map((chip) => {
                const Icon = chip.icon;
                return (
                  <button
                    key={chip.label}
                    onClick={() => handleChipClick(chip.label)}
                    className="flex items-center gap-1.5 rounded-full border border-zinc-800/60 bg-zinc-900/40 px-3 py-1.5 text-[11px] text-zinc-500 transition-all hover:border-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-300"
                  >
                    <Icon className="h-3 w-3" />
                    {chip.label}
                  </button>
                );
              })}
            </motion.div>
          )}

          {/* Image preview row */}
          {pastedImage && (
            <div className="mb-2 rounded-lg border border-zinc-700/50 bg-zinc-900/80 p-2.5">
              <div className="flex items-start gap-3">
                <img
                  src={pastedImage.preview}
                  alt="Pasted screenshot"
                  className="h-14 w-auto rounded border border-zinc-600/50 object-contain"
                />
                <div className="flex-1 space-y-1.5">
                  <input
                    ref={descriptionRef}
                    type="text"
                    value={imageDescription}
                    onChange={(e) => setImageDescription(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                      if (e.key === 'Escape') clearImage();
                    }}
                    placeholder="Describe this image..."
                    className="w-full rounded-md border border-zinc-700/50 bg-zinc-800/60 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                  />
                  <input
                    type="text"
                    value={imageQuestion}
                    onChange={(e) => setImageQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                      if (e.key === 'Escape') clearImage();
                    }}
                    placeholder="Question (optional)"
                    className="w-full rounded-md border border-zinc-700/50 bg-zinc-800/60 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                  />
                </div>
                <button onClick={clearImage} className="rounded-md p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300" title="Remove image (Esc)">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Attached files row */}
          {attachedFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachedFiles.map((file) => (
                <div key={file.id} className="group/file flex items-center gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/60 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-600">
                  <FileText className="h-3 w-3 text-zinc-500" />
                  <span className="max-w-[120px] truncate">{file.name}</span>
                  <span className="text-[10px] text-zinc-600">{(file.sizeBytes / 1024).toFixed(1)}KB</span>
                  <button onClick={() => removeFile(file.id)} className="ml-0.5 rounded p-0.5 text-zinc-700 transition-colors hover:text-red-400" title="Remove">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* The input box */}
          <div className="relative flex flex-col rounded-2xl border border-zinc-700/50 bg-zinc-900/70 shadow-lg shadow-black/10 transition-all focus-within:border-violet-500/30 focus-within:ring-1 focus-within:ring-violet-500/15 focus-within:shadow-violet-500/5">
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
              className="resize-none overflow-y-auto bg-transparent px-4 pt-3 pb-1 text-sm leading-relaxed text-zinc-100 placeholder-zinc-600 focus:outline-none"
              style={{ minHeight: `${MIN_INPUT_HEIGHT}px`, maxHeight: `${MAX_INPUT_HEIGHT}px` }}
            />

            {/* Bottom toolbar */}
            <div className="flex items-center justify-between px-3 pb-2.5">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-800/80 hover:text-zinc-300"
                  title="Attach files"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <ModeSelector />
                <div className="mx-0.5 h-4 w-px bg-zinc-800" />
                <FocusModeToggle />
                <button
                  onClick={() => setLearningEnabled(!learningEnabled)}
                  className={`flex h-7 items-center gap-1 rounded-lg px-1.5 text-xs transition-colors ${
                    learningEnabled
                      ? 'text-emerald-400 hover:bg-emerald-900/30'
                      : 'text-zinc-600 hover:bg-zinc-800/80 hover:text-zinc-400'
                  }`}
                  title={learningEnabled ? 'Learning ON — Vai learns from this chat' : 'Learning OFF — Vai won\'t learn from this chat'}
                >
                  <Brain className="h-3.5 w-3.5" />
                  {!learningEnabled && <span className="text-[10px] font-medium uppercase tracking-wider">off</span>}
                </button>
              </div>

              <div className="flex items-center gap-2">
                {charCount > 0 && (
                  <span className="text-[10px] tabular-nums text-zinc-600">{charCount}</span>
                )}
                {isStreaming ? (
                  <button
                    onClick={stopStreaming}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-zinc-300 transition-all hover:bg-red-600/80 hover:text-white"
                    title="Stop generating"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleSend()}
                    disabled={!canSend}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white transition-all hover:bg-violet-500 hover:shadow-lg hover:shadow-violet-500/25 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:shadow-none"
                    title="Send message (Enter)"
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Disclaimer */}
          <p className="mt-1.5 text-center text-[10px] text-zinc-700">
            Vai can make mistakes. Verify important information.
          </p>
        </div>
      </div>
    </div>
  );
}
