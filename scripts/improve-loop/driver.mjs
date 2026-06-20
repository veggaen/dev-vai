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
