export interface ConversationRecord {
  id: string;
  title: string;
  modelId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: string;
  toolCallId?: string;
  tokenCount?: number;
  modelId?: string;
  createdAt: Date;
}
