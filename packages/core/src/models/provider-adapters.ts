import { getModelProfile, type ModelProfile, type ProviderConfig } from '../config/index.js';
import type { ChatChunk, ChatRequest, ChatResponse, Message, ModelAdapter } from './adapter.js';

interface OpenAIChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface OpenAIChatCompletionChunk {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

function messageText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  return String(message.content ?? '');
}

function splitSystemMessages(messages: readonly Message[]): { system: string | null; conversational: Message[] } {
  const systemParts: string[] = [];
  const conversational: Message[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      const text = messageText(message).trim();
      if (text) systemParts.push(text);
      continue;
    }
    conversational.push({ ...message, content: messageText(message) });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : null,
    conversational,
  };
}

function normalizeOpenAIContent(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part.type === 'text' || !part.type ? part.text ?? '' : ''))
    .join('');
}

abstract class BaseHttpAdapter implements ModelAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly provider: ModelProfile['provider'];
  readonly supportsStreaming: boolean = false;
  readonly supportsToolUse: boolean;
  readonly capabilities: ModelProfile['capabilities'];
  readonly cost: ModelProfile['cost'];
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly speedTier: ModelProfile['speedTier'];
  readonly qualityTier: ModelProfile['qualityTier'];

  protected constructor(protected readonly profile: ModelProfile, protected readonly providerConfig: ProviderConfig) {
    this.id = profile.id;
    this.displayName = profile.displayName;
    this.provider = profile.provider;
    this.supportsToolUse = profile.capabilities.toolUse;
    this.capabilities = profile.capabilities;
    this.cost = profile.cost;
    this.contextWindow = profile.contextWindow;
    this.maxOutputTokens = profile.maxOutputTokens;
    this.speedTier = profile.speedTier;
    this.qualityTier = profile.qualityTier;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const startedAt = Date.now();
    const response = await this.performChat(request);
    return {
      ...response,
      durationMs: Date.now() - startedAt,
      modelId: this.id,
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const response = await this.chat(request);
    if (response.message.content) {
      yield {
        type: 'text_delta',
        textDelta: response.message.content,
        modelId: response.modelId,
      };
    }
    yield {
      type: 'done',
      usage: response.usage,
      durationMs: response.durationMs,
      modelId: response.modelId,
    };
  }

  protected maxTokens(request: ChatRequest): number {
    return Math.min(request.maxTokens ?? 2048, this.maxOutputTokens);
  }

  protected temperature(request: ChatRequest): number {
    return request.temperature ?? 0.7;
  }

  protected authHeaders(): HeadersInit {
    if (!this.providerConfig.apiKey) {
      throw new Error(`Provider ${this.providerConfig.id} is missing an API key`);
    }
    return {};
  }

  protected modelName(request: ChatRequest): string {
    return request.modelOverride?.trim() || this.profile.modelName;
  }

  protected abstract performChat(request: ChatRequest): Promise<ChatResponse>;
}

export class OpenAIAdapter extends BaseHttpAdapter {
  override readonly supportsStreaming = true;

  constructor(profile: ModelProfile, provider: ProviderConfig) {
    super(profile, provider);
  }

  protected override authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.providerConfig.apiKey}`,
    };
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(`${this.providerConfig.baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
      },
      body: JSON.stringify({
        model: this.modelName(request),
        messages: request.messages.map((message) => ({ role: message.role, content: messageText(message) })),
        temperature: this.temperature(request),
        max_tokens: this.maxTokens(request),
        stream: false,
      }),
      signal: request.signal,
    });

    if (!res.ok) {
      throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
    }

    const payload = await res.json() as OpenAIChatCompletionResponse;
    const choice = payload.choices?.[0];
    return {
      message: {
        role: 'assistant',
        content: normalizeOpenAIContent(choice?.message?.content),
      },
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.completion_tokens ?? 0,
      },
      finishReason: choice?.finish_reason === 'length' ? 'length' : 'stop',
    };
  }

  override async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const startedAt = Date.now();
    const res = await fetch(`${this.providerConfig.baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
      },
      body: JSON.stringify({
        model: this.modelName(request),
        messages: request.messages.map((message) => ({ role: message.role, content: messageText(message) })),
        temperature: this.temperature(request),
        max_tokens: this.maxTokens(request),
        stream: true,
      }),
      signal: request.signal,
    });

    if (!res.ok) {
      throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
    }

    if (!res.body) {
      const response = await this.chat(request);
      if (response.message.content) {
        yield {
          type: 'text_delta',
          textDelta: response.message.content,
          modelId: response.modelId,
        };
      }
      yield {
        type: 'done',
        usage: response.usage,
        durationMs: response.durationMs,
        modelId: response.modelId,
      };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason: ChatResponse['finishReason'] = 'stop';
    let usage = { promptTokens: 0, completionTokens: 0 };

    const handleEvent = (rawEvent: string): ChatChunk[] => {
      const data = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');

      if (!data || data === '[DONE]') return [];

      let payload: OpenAIChatCompletionChunk;
      try {
        payload = JSON.parse(data) as OpenAIChatCompletionChunk;
      } catch {
        return [];
      }

      if (payload.usage) {
        usage = {
          promptTokens: payload.usage.prompt_tokens ?? usage.promptTokens,
          completionTokens: payload.usage.completion_tokens ?? usage.completionTokens,
        };
      }

      const choice = payload.choices?.[0];
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason === 'length' ? 'length' : 'stop';
      }

      const textDelta = normalizeOpenAIContent(choice?.delta?.content);
      if (!textDelta) return [];

      return [{
        type: 'text_delta',
        textDelta,
        modelId: this.id,
      }];
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done }).replace(/\r/g, '');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const chunk of handleEvent(rawEvent)) {
          yield chunk;
        }
        boundary = buffer.indexOf('\n\n');
      }

      if (done) break;
    }

    if (buffer.trim().length > 0) {
      for (const chunk of handleEvent(buffer)) {
        yield chunk;
      }
    }

    yield {
      type: 'done',
      usage,
      durationMs: Date.now() - startedAt,
      modelId: this.id,
    };
  }
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class AnthropicAdapter extends BaseHttpAdapter {
  constructor(profile: ModelProfile, provider: ProviderConfig) {
    super(profile, provider);
  }

  protected override authHeaders(): HeadersInit {
    return {
      'x-api-key': this.providerConfig.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    };
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    const { system, conversational } = splitSystemMessages(request.messages);
    const res = await fetch(`${this.providerConfig.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
      },
      body: JSON.stringify({
        model: this.profile.modelName,
        max_tokens: this.maxTokens(request),
        temperature: this.temperature(request),
        system: system ?? undefined,
        messages: conversational.map((message) => ({ role: message.role, content: messageText(message) })),
      }),
      signal: request.signal,
    });

    if (!res.ok) {
      throw new Error(`Anthropic request failed: ${res.status} ${await res.text()}`);
    }

    const payload = await res.json() as AnthropicResponse;
    return {
      message: {
        role: 'assistant',
        content: (payload.content ?? []).map((block) => block.text ?? '').join(''),
      },
      usage: {
        promptTokens: payload.usage?.input_tokens ?? 0,
        completionTokens: payload.usage?.output_tokens ?? 0,
      },
      finishReason: payload.stop_reason === 'max_tokens' ? 'length' : 'stop',
    };
  }
}

interface GoogleResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export class GoogleAdapter extends BaseHttpAdapter {
  constructor(profile: ModelProfile, provider: ProviderConfig) {
    super(profile, provider);
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    const { system, conversational } = splitSystemMessages(request.messages);
    const baseUrl = this.providerConfig.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${baseUrl}/models/${this.profile.modelName}:generateContent?key=${encodeURIComponent(this.providerConfig.apiKey ?? '')}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: system
          ? { role: 'system', parts: [{ text: system }] }
          : undefined,
        contents: conversational.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: messageText(message) }],
        })),
        generationConfig: {
          temperature: this.temperature(request),
          maxOutputTokens: this.maxTokens(request),
        },
      }),
      signal: request.signal,
    });

    if (!res.ok) {
      throw new Error(`Google request failed: ${res.status} ${await res.text()}`);
    }

    const payload = await res.json() as GoogleResponse;
    const candidate = payload.candidates?.[0];
    return {
      message: {
        role: 'assistant',
        content: (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join(''),
      },
      usage: {
        promptTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
      },
      finishReason: candidate?.finishReason === 'MAX_TOKENS' ? 'length' : 'stop',
    };
  }
}

interface OllamaChatResponse {
  message?: {
    content?: string;
    thinking?: string;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Local-daemon runtime knobs (measured on RTX 3080 Ti, qwen3:8b):
 *
 * - `numCtx`: Ollama defaults to a 4096-token context regardless of what the
 *   model supports. Vai's system stack (mode charter + contract ledger + turn
 *   hints + web evidence + history) regularly exceeds that, and the daemon
 *   silently drops the oldest tokens — the model loses its own instructions
 *   or the start of the conversation. Default to 16384 (capped by the model's
 *   real window); override via VAI_LOCAL_NUM_CTX.
 * - `keepAlive`: the daemon unloads models after ~5 idle minutes, so the next
 *   turn pays a multi-second reload. Keep the chat model resident for 30m by
 *   default; override via VAI_LOCAL_KEEP_ALIVE (e.g. '-1' = never unload).
 */
export function resolveLocalRuntimeOptions(
  contextWindow: number,
  env: NodeJS.ProcessEnv = process.env,
): { numCtx: number; keepAlive: string } {
  const requested = Number(env.VAI_LOCAL_NUM_CTX?.trim());
  const numCtx = Math.min(
    contextWindow,
    Number.isFinite(requested) && requested > 0 ? requested : 16384,
  );
  return {
    numCtx,
    keepAlive: env.VAI_LOCAL_KEEP_ALIVE?.trim() || '30m',
  };
}

/**
 * Thinking-family models (qwen3, deepseek-r1, …) may interleave reasoning as
 * `<think>…</think>` blocks in `message.content` depending on daemon version
 * and the `think` request flag. The user-facing answer must never contain raw
 * reasoning markup, so strip closed blocks and any unterminated opener.
 */
export function stripThinkingBlocks(content: string): string {
  if (!content.includes('<think>')) return content;
  return content
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .trim();
}

export class LocalOpenAICompatibleAdapter extends BaseHttpAdapter {
  constructor(profile: ModelProfile, provider: ProviderConfig) {
    super(profile, provider);
  }

  protected async performChat(request: ChatRequest): Promise<ChatResponse> {
    const runtime = resolveLocalRuntimeOptions(this.profile.contextWindow);
    const body: Record<string, unknown> = {
      model: this.profile.modelName,
      messages: request.messages.map((message) => ({ role: message.role, content: messageText(message) })),
      stream: false,
      // Per-call residency override wins (council members pass a short keep_alive so each
      // model is evicted promptly → only one council model resident at a time on a single
      // GPU). Falls back to the adapter default (30m) for the hot-path chat model.
      keep_alive: request.keepAlive ?? runtime.keepAlive,
      options: {
        temperature: this.temperature(request),
        num_predict: this.maxTokens(request),
        num_ctx: runtime.numCtx,
      },
    };
    // Chat latency contract: thinking-capable local models default to thinking
    // OFF (a chat turn should answer in seconds, not minutes); opt back in via
    // VAI_LOCAL_THINK=1. A per-request `think` ALWAYS wins (the council sets it true
    // for reasoning models so their CoT goes to a separate field and `content` stays
    // clean JSON — see ChatRequest.think). The flag is only sent to models discovered
    // as thinking-capable — daemons reject it for non-thinking models.
    if (this.profile.capabilities.extendedThinking) {
      body.think = request.think ?? (process.env.VAI_LOCAL_THINK === '1');
    }
    const res = await fetch(`${this.providerConfig.baseUrl ?? 'http://localhost:11434'}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!res.ok) {
      throw new Error(`Local model request failed: ${res.status} ${await res.text()}`);
    }

    const payload = await res.json() as OllamaChatResponse;
    return {
      message: {
        role: 'assistant',
        content: stripThinkingBlocks(payload.message?.content ?? ''),
      },
      usage: {
        promptTokens: payload.prompt_eval_count ?? 0,
        completionTokens: payload.eval_count ?? 0,
      },
      finishReason: 'stop',
    };
  }
}

export function createAdapterForProfile(profileId: string, provider: ProviderConfig): ModelAdapter | null {
  const profile = getModelProfile(profileId);
  if (!profile) return null;

  if (profile.provider === 'openai') return new OpenAIAdapter(profile, provider);
  if (profile.provider === 'anthropic') return new AnthropicAdapter(profile, provider);
  if (profile.provider === 'google') return new GoogleAdapter(profile, provider);
  if (profile.provider === 'local') return new LocalOpenAICompatibleAdapter(profile, provider);
  return null;
}
