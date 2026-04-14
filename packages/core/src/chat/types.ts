import type { ConversationMode } from './modes.js';

export interface ConversationRecord {
  id: string;
  title: string;
  modelId: string;
  mode: ConversationMode;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  imageId?: string | null;
  toolCalls?: string;
  toolCallId?: string;
  tokenCount?: number;
  modelId?: string;
  createdAt: Date;
}

export interface ImageRecord {
  id: string;
  conversationId?: string | null;
  sourceId?: string | null;
  filename: string;
  mimeType: string;
  data: string; // base64
  description: string;
  question?: string | null;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
  createdAt: Date;
}
