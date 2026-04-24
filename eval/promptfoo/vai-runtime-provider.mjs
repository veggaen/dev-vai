/**
 * Promptfoo provider — calls Vai runtime HTTP chat (non-streaming).
 *
 * Env:
 *   VAI_PROMPTFOO_BASE   — default http://localhost:3006
 *   VAI_PROMPTFOO_MODEL  — default vai:v0
 *   VAI_PROMPTFOO_FETCH_TIMEOUT_MS — per-request timeout (default 30000)
 *
 * Requires platform auth disabled for anonymous POST /api/conversations (typical local dev).
 */

export default class VaiRuntimeProvider {
  constructor(options) {
    this.options = options ?? {};
    this.base = (process.env.VAI_PROMPTFOO_BASE?.trim() || 'http://localhost:3006').replace(/\/$/, '');
    this.modelId = process.env.VAI_PROMPTFOO_MODEL?.trim() || 'vai:v0';
    const rawMs = process.env.VAI_PROMPTFOO_FETCH_TIMEOUT_MS;
    this.fetchTimeoutMs = Math.max(1000, Number.parseInt(rawMs ?? '30000', 10) || 30000);
  }

  id() {
    return this.options.id ?? 'vai-runtime-http';
  }

  async callApi(prompt, _context) {
    const content = typeof prompt === 'string' ? prompt : String(prompt?.raw ?? prompt ?? '');

    try {
      return await this.#callApiInner(content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        output: '',
        error: msg.includes('AbortError') || msg.includes('aborted')
          ? `Request timed out after ${this.fetchTimeoutMs}ms (${this.base}). Is the runtime running?`
          : msg,
      };
    }
  }

  async #callApiInner(content) {
    const started = Date.now();
    const signal = AbortSignal.timeout(this.fetchTimeoutMs);

    const r1 = await fetch(`${this.base}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        modelId: this.modelId,
        mode: 'chat',
        title: `promptfoo-${Date.now()}`,
      }),
    });

    if (!r1.ok) {
      const t = await r1.text();
      return {
        output: '',
        error: `POST /api/conversations failed ${r1.status}: ${t.slice(0, 500)}`,
        latencyMs: Date.now() - started,
      };
    }

    const { id: conversationId } = await r1.json();

    const r2 = await fetch(`${this.base}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.fetchTimeoutMs),
      body: JSON.stringify({
        content,
        // Deterministic eval: skip repo-native prompt hardening (can hijack short prompts).
        skipPromptRewrite: true,
      }),
    });

    if (!r2.ok) {
      const t = await r2.text();
      return {
        output: '',
        error: `POST .../messages failed ${r2.status}: ${t.slice(0, 500)}`,
        latencyMs: Date.now() - started,
      };
    }

    const data = await r2.json();
    const u = data.usage || {};
    const text = typeof data.content === 'string' ? data.content : '';

    return {
      output: text,
      latencyMs: Date.now() - started,
      tokenUsage: {
        total: (u.promptTokens || 0) + (u.completionTokens || 0),
        prompt: u.promptTokens,
        completion: u.completionTokens,
      },
    };
  }
}
