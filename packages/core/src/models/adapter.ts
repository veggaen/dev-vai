export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResponse {
  message: Message;
  usage: { promptTokens: number; completionTokens: number };
  finishReason: 'stop' | 'tool_calls' | 'length';
}

export interface ChatChunk {
  type: 'text_delta' | 'reasoning_delta' | 'tool_call_delta' | 'done';
  textDelta?: string;
  reasoningDelta?: string;
  toolCallDelta?: { id: string; name: string; argumentsDelta: string };
  usage?: { promptTokens: number; completionTokens: number };
}

export interface ModelAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly supportsStreaming: boolean;
  readonly supportsToolUse: boolean;

  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): AsyncIterable<ChatChunk>;
}

export class ModelRegistry {
  private adapters = new Map<string, ModelAdapter>();

  register(adapter: ModelAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ModelAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Model adapter not found: ${id}`);
    }
    return adapter;
  }

  list(): ModelAdapter[] {
    return Array.from(this.adapters.values());
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }
}
