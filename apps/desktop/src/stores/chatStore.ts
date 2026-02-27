import { create } from 'zustand';

const API_BASE = 'http://localhost:3006';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
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
  sendMessage: (content: string) => void;
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
    }>;
    set({
      activeConversationId: id,
      messages: rawMessages.map((m) => ({
        id: m.id,
        role: m.role as ChatMessage['role'],
        content: m.content,
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

  sendMessage: (content: string) => {
    const state = get();
    if (!state.activeConversationId) return;

    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
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

    ws = new WebSocket(`ws://localhost:3006/api/chat`);

    ws.onopen = () => {
      ws!.send(
        JSON.stringify({
          conversationId: state.activeConversationId,
          content,
        }),
      );
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
