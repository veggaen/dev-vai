import { create } from 'zustand';
import { API_BASE, WS_BASE } from '../lib/api.js';
import { getActiveCapture, startSessionCapture } from '../lib/sessionCapture.js';
import type { SessionCapture } from '../lib/sessionCapture.js';

interface ImageAttachment {
  data: string;
  mimeType: string;
  description: string;
  question?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
}

export interface SearchSourceUI {
  url: string;
  title: string;
  domain: string;
  snippet: string;
  favicon: string;
  trustTier: 'high' | 'medium' | 'low' | 'untrusted';
  trustScore: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  imageId?: string | null;
  imagePreview?: string;
  /** Search sources attached to this response */
  sources?: SearchSourceUI[];
  /** Follow-up question suggestions */
  followUps?: string[];
  /** Confidence score (0-1) from search pipeline */
  confidence?: number;
  /** User feedback: true = helpful, false = not helpful, undefined = no feedback */
  feedback?: boolean;
}

interface Conversation {
  id: string;
  title: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  /** When false, Vai will NOT learn from this conversation (protective parenting) */
  learningEnabled: boolean;

  fetchConversations: () => Promise<void>;
  createConversation: (modelId: string) => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (content: string, image?: ImageAttachment, systemPrompt?: string) => void;
  stopStreaming: () => void;
  appendToLastMessage: (text: string) => void;
  setFeedback: (messageId: string, helpful: boolean) => void;
  setLearningEnabled: (enabled: boolean) => void;
}

let ws: WebSocket | null = null;

/**
 * Generate a clean session title from the first user message.
 * Strips markdown, collapses whitespace, truncates at word boundary.
 */
function deriveSessionTitle(content: string): string {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, '[code]')  // collapse code blocks
    .replace(/\[.*?\]\(.*?\)/g, '')        // remove links
    .replace(/[#*_`~]/g, '')              // strip markdown
    .replace(/\n+/g, ' ')                 // flatten newlines
    .replace(/\s+/g, ' ')                 // collapse whitespace
    .trim();

  if (cleaned.length <= 60) return cleaned || 'Chat Session';
  const truncated = cleaned.slice(0, 60);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 30 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

/**
 * Ensure there's an active SessionCapture for dev logs.
 * Auto-creates one on the first message if none exists.
 */
async function ensureCapture(firstMessage: string, modelId?: string): Promise<SessionCapture | null> {
  const existing = getActiveCapture();
  if (existing) return existing;

  // Auto-start a new dev logs session
  const title = deriveSessionTitle(firstMessage);
  const capture = await startSessionCapture(
    title,
    'VeggaAI',
    modelId || 'unknown',
    { batched: true, flushInterval: 2000 },
  );
  return capture;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  learningEnabled: true,

  fetchConversations: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/conversations`);
      const conversations = (await res.json()) as Conversation[];
      set({ conversations });
    } catch {
      console.error('Failed to fetch conversations');
    }
  },

  createConversation: async (modelId: string) => {
    const res = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId }),
    });
    const { id } = (await res.json()) as { id: string };
    await get().fetchConversations();
    await get().selectConversation(id);
    return id;
  },

  selectConversation: async (id: string) => {
    const res = await fetch(`${API_BASE}/api/conversations/${id}/messages`);
    const rawMessages = (await res.json()) as Array<{
      id: string;
      role: string;
      content: string;
      imageId?: string | null;
    }>;
    set({
      activeConversationId: id,
      messages: rawMessages.map((m) => ({
        id: m.id,
        role: m.role as ChatMessage['role'],
        content: m.content,
        imageId: m.imageId,
      })),
    });
  },

  deleteConversation: async (id: string) => {
    await fetch(`${API_BASE}/api/conversations/${id}`, { method: 'DELETE' });
    const state = get();
    if (state.activeConversationId === id) {
      set({ activeConversationId: null, messages: [] });
    }
    await get().fetchConversations();
  },

  sendMessage: (content: string, image?: ImageAttachment, systemPrompt?: string) => {
    const state = get();
    if (!state.activeConversationId) return;

    // Find conversation to get model ID
    const conv = state.conversations.find((c) => c.id === state.activeConversationId);
    const modelId = conv?.modelId;

    // Build display content for user message
    let displayContent = content;
    if (image) {
      const parts = [`[Image: ${image.description}]`];
      if (image.question) parts.push(`[Question: ${image.question}]`);
      if (content) parts.push(content);
      displayContent = parts.join('\n');
    }

    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: displayContent,
      imagePreview: image ? `data:${image.mimeType};base64,${image.data}` : undefined,
    };

    const assistantMsg: ChatMessage = {
      id: `temp-${Date.now()}-assistant`,
      role: 'assistant',
      content: '',
    };

    set({
      messages: [...state.messages, userMsg, assistantMsg],
      isStreaming: true,
    });

    // Close existing WebSocket if any
    if (ws) {
      ws.close();
    }

    ws = new WebSocket(`${WS_BASE}/api/chat`);

    ws.onopen = () => {
      const payload: Record<string, unknown> = {
        conversationId: state.activeConversationId,
        content,
      };
      if (image) {
        payload.image = {
          data: image.data,
          mimeType: image.mimeType,
          description: image.description,
          question: image.question,
          width: image.width,
          height: image.height,
          sizeBytes: image.sizeBytes,
        };
      }
      if (systemPrompt) {
        payload.systemPrompt = systemPrompt;
      }
      if (!get().learningEnabled) {
        payload.noLearn = true;
      }
      ws!.send(JSON.stringify(payload));

      // Auto-create session + capture user message in dev logs
      void ensureCapture(content, modelId).then((capture) => {
        if (capture) {
          capture.message('user', content);
        }
      });
    };

    // Track reasoning text separately
    let reasoningText = '';

    ws.onmessage = (event) => {
      const chunk = JSON.parse(event.data as string) as {
        type: string;
        textDelta?: string;
        reasoningDelta?: string;
        sources?: SearchSourceUI[];
        followUps?: string[];
        confidence?: number;
        error?: string;
      };

      if (chunk.type === 'sources' && chunk.sources) {
        // Attach sources + follow-ups + confidence to the current assistant message
        set((state) => {
          const msgs = [...state.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'assistant') {
            msgs[msgs.length - 1] = {
              ...last,
              sources: chunk.sources,
              followUps: chunk.followUps,
              confidence: chunk.confidence,
            };
          }
          return { messages: msgs };
        });
      } else if (chunk.type === 'text_delta' && chunk.textDelta) {
        get().appendToLastMessage(chunk.textDelta);
      } else if (chunk.type === 'reasoning_delta' && chunk.reasoningDelta) {
        // Accumulate reasoning text for dev logs capture
        reasoningText += chunk.reasoningDelta;
      } else if (chunk.type === 'done') {
        set({ isStreaming: false });
        // Capture assistant response + reasoning in dev logs
        const capture = getActiveCapture();
        if (capture) {
          const msgs = get().messages;
          const lastMsg = msgs[msgs.length - 1];
          if (lastMsg?.role === 'assistant' && lastMsg.content) {
            capture.message('assistant', lastMsg.content, modelId);
          }
          if (reasoningText) {
            capture.thinking(reasoningText, { label: 'Model Reasoning' });
          }
        }
        ws?.close();
        ws = null;
        // Refresh conversations to get updated titles/timestamps
        get().fetchConversations();
      } else if (chunk.type === 'error') {
        set({ isStreaming: false });
        get().appendToLastMessage(`\n\nError: ${chunk.error}`);
        // Log error in dev logs
        const capture = getActiveCapture();
        if (capture) {
          capture.error(`Chat error: ${chunk.error}`, { errorType: 'stream' });
        }
        ws?.close();
        ws = null;
      }
    };

    ws.onerror = () => {
      set({ isStreaming: false });
      get().appendToLastMessage('\n\nConnection error');
      const capture = getActiveCapture();
      if (capture) {
        capture.error('WebSocket connection error', { errorType: 'connection' });
      }
    };
  },

  stopStreaming: () => {
    if (ws) {
      ws.close();
      ws = null;
    }
    set({ isStreaming: false });
  },

  appendToLastMessage: (text: string) => {
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + text };
      }
      return { messages: msgs };
    });
  },

  setFeedback: (messageId: string, helpful: boolean) => {
    set((state) => {
      const msgs = state.messages.map(m =>
        m.id === messageId ? { ...m, feedback: helpful } : m,
      );
      return { messages: msgs };
    });
    // Fire-and-forget feedback to server
    const convId = get().activeConversationId;
    if (convId) {
      fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convId, messageId, helpful }),
      }).catch(() => { /* silent */ });
    }
  },

  setLearningEnabled: (enabled: boolean) => set({ learningEnabled: enabled }),
}));

// Expose store for demo system (injectResponse needs setState access)
(window as unknown as Record<string, unknown>).__vai_chat_store = useChatStore;
