/**
 * Model driver + VRAM guard for the self-improvement loop.
 *
 * CRASH-SAFETY (hard requirement — the user's PC BSODs under combined GPU+disk
 * load, memory: crash-safe-workflow):
 *   - STRICTLY SERIAL. Callers must await one call before starting the next.
 *     Nothing here starts parallel inference. This is the #1 BSOD guard.
 *   - VRAM headroom is checked BEFORE every model call via Ollama /api/ps.
 *     If loaded VRAM exceeds the budget, we wait (models self-evict on
 *     keep-alive) instead of piling on more load.
 *   - A cooldown after every call keeps the GPU+disk off sustained peak.
 */
import { WebSocket } from 'ws';

const OLLAMA = (process.env.LOCAL_MODEL_URL ?? 'http://localhost:11434').replace(/\/$/, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Total VRAM (bytes) currently pinned by loaded Ollama models. 0 if none / unreachable. */
export async function loadedVram() {
  try {
    const res = await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return 0;
    const j = await res.json();
    return (j.models ?? []).reduce((sum, m) => sum + (m.size_vram ?? 0), 0);
  } catch {
    return 0; // never let a probe failure crash the loop
  }
}

/**
 * Block until loaded VRAM is under `budgetBytes`, or `maxWaitMs` elapses.
 * Returns the VRAM reading at the moment we proceed (for the UI gauge).
 */
export async function waitForVramHeadroom(budgetBytes, { pollMs = 3000, maxWaitMs = 120_000 } = {}) {
  const deadline = Date.now() + maxWaitMs;
  let vram = await loadedVram();
  while (vram > budgetBytes && Date.now() < deadline) {
    await sleep(pollMs);
    vram = await loadedVram();
  }
  return vram;
}

/**
 * Readiness gate — called ONCE per cycle before any turn. Two infra failures cost whole
 * loop runs this session: (1) a cold model → the first WS turns `AggregateError` (every
 * connect attempt fails) until it warms; (2) the runtime HTTP not yet serving after a
 * restart. Both produced FALSE failure grades that polluted the corpus — a Verification-First
 * violation (a turn's INFRA failure must never be scored as a Vai LOGIC failure).
 *
 * So we proactively: confirm the runtime answers HTTP, then pre-warm the council/generation
 * model with one tiny generate (keep_alive long) so the first real turn hits a warm model.
 * Crash-safe: a single serial generate, no parallelism, honours the same OLLAMA endpoint.
 * Returns { ready, runtimeUp, warmed, detail } — the loop gates on `ready` and, when false,
 * SKIPS (not grades) the cycle. Never throws.
 */
export async function ensureRuntimeReady(baseUrl, {
  model = process.env.IMPROVE_GEN_MODEL ?? process.env.LOCAL_MODEL ?? 'qwen3:8b',
  keepAlive = '30m',
  warmTimeoutMs = 60_000,
  // Injectable for tests (mirrors the runtime adapters' fetchImpl pattern). Defaults to the
  // global fetch in production so real callers are unaffected.
  fetchImpl = fetch,
} = {}) {
  const httpBase = baseUrl.replace(/\/$/, '');
  let runtimeUp = false;
  try {
    const res = await fetchImpl(`${httpBase}/`, { signal: AbortSignal.timeout(5000) });
    runtimeUp = res.status > 0; // any HTTP response = process is serving
  } catch {
    runtimeUp = false;
  }
  if (!runtimeUp) {
    return { ready: false, runtimeUp: false, warmed: false, detail: `runtime not serving at ${httpBase} — start it (pnpm --filter @vai/runtime dev)` };
  }
  let warmed = false;
  try {
    await fetchImpl(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: 'ready?', stream: false, think: false, keep_alive: keepAlive, options: { num_predict: 1 } }),
      signal: AbortSignal.timeout(warmTimeoutMs),
    });
    warmed = true; // the model is now resident; cold-start AggregateError avoided
  } catch {
    warmed = false; // warm failed — caller still proceeds (runtime is up), just less hot
  }
  return { ready: true, runtimeUp: true, warmed, detail: warmed ? `runtime up · ${model} warmed` : `runtime up · ${model} warm timed out (proceeding)` };
}

/**
 * True when an error is an INFRA/connection failure (skip, don't grade), not a Vai answer.
 * Inspects the error's NAME, code, message AND aggregated sub-errors — not just .message:
 * a Node AggregateError ("all connect attempts failed", the cold-model case) carries the
 * signal in its `.name`/`.errors[]`, not its message, so a message-only check let it slip
 * through and get mis-graded as a Vai failure (the very corpus pollution this prevents).
 */
export function isInfraError(err) {
  const parts = [
    err?.name,
    err?.code,
    err?.message ?? (typeof err === 'string' ? err : ''),
    err?.cause?.code,
    err?.cause?.message,
    ...(Array.isArray(err?.errors) ? err.errors.map((e) => `${e?.code ?? ''} ${e?.message ?? ''}`) : []),
  ];
  const s = parts.filter(Boolean).join(' ');
  return /AggregateError|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|EPIPE|fetch failed|socket hang up|WebSocket|timeout/i.test(s);
}

/** Direct, low-cost Ollama generate — used for prompt generation + cheap grading. */
export async function ollamaGenerate(model, prompt, { timeoutMs = 90_000, numPredict = 512 } = {}) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model, prompt, stream: false, think: false,
      options: { num_predict: numPredict, temperature: 0.7 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const j = await res.json();
  return (j.response ?? '').trim();
}

/**
 * Run ONE prompt through the live Vai runtime over WS and harvest the answer +
 * council verdict (the same surface scripts/council-ask.mjs reads). Resolves with
 * { text, council, durationMs } or rejects on timeout/error.
 */
export function runThroughVai(baseUrl, content, { timeoutMs = 220_000, modelId = 'vai:v0', onProgress } = {}) {
  const wsUrl = `${baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '')}/api/chat?devAuthBypass=1`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const startedAt = Date.now();
    let text = '';
    let lastEmit = 0;
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('timeout')); }, timeoutMs);
    // Throttled live progress callback so the UI can show partial output / phase
    // mid-turn instead of a ~70s dead gap. Never lets a callback error kill the turn.
    const emit = (phase) => {
      if (!onProgress) return;
      const now = Date.now();
      if (phase === 'flush' || now - lastEmit > 1200) {
        lastEmit = now;
        try { onProgress({ partial: text, phase, elapsedMs: now - startedAt }); } catch {}
      }
    };
    ws.on('open', () => ws.send(JSON.stringify({
      conversationId: `improve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content, modelId, mode: 'chat', allowLearn: false,
    })));
    ws.on('message', (raw) => {
      let chunk; try { chunk = JSON.parse(raw.toString()); } catch { return; }
      if (chunk.type === 'text_delta' && chunk.textDelta) { text += chunk.textDelta; emit('streaming'); }
      if (chunk.type === 'progress' && chunk.stage) emit(`stage:${chunk.stage}`);
      if (chunk.type === 'error') { clearTimeout(timer); try { ws.close(); } catch {} reject(new Error(String(chunk.error))); }
      if (chunk.type === 'done') {
        clearTimeout(timer); try { ws.close(); } catch {}
        resolve({ text: text.trim(), council: chunk.thinking?.council ?? null, durationMs: Date.now() - startedAt });
      }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(new Error(String(err))); });
  });
}

export { sleep };
