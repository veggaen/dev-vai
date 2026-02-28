import { create } from 'zustand';
import { API_BASE, WS_BASE } from '../lib/api.js';

interface ImageAttachment {
  data: string;
  mimeType: string;
  description: string;
  question?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  imageId?: string | null;
  imagePreview?: string; // temp data URL for display before server-side storage
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

  fetchConversations: () => Promise<void>;
  createConversation: (modelId: string) => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (content: string, image?: ImageAttachment) => void;
  appendToLastMessage: (text: string) => void;
}

let ws: WebSocket | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,

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

  sendMessage: (content: string, image?: ImageAttachment) => {
    const state = get();
    if (!state.activeConversationId) return;

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
      ws!.send(JSON.stringify(payload));
    };

    ws.onmessage = (event) => {
      const chunk = JSON.parse(event.data as string) as {
        type: string;
        textDelta?: string;
        error?: string;
      };

      if (chunk.type === 'text_delta' && chunk.textDelta) {
        get().appendToLastMessage(chunk.textDelta);
      } else if (chunk.type === 'done') {
        set({ isStreaming: false });
        ws?.close();
        ws = null;
        // Refresh conversations to get updated titles/timestamps
        get().fetchConversations();
      } else if (chunk.type === 'error') {
        set({ isStreaming: false });
        get().appendToLastMessage(`\n\nError: ${chunk.error}`);
        ws?.close();
        ws = null;
      }
    };

    ws.onerror = () => {
      set({ isStreaming: false });
      get().appendToLastMessage('\n\nConnection error');
    };
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
}));
