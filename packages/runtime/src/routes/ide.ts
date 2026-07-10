/**
 * Council-IDE routes — local-model code editing.
 *
 *   POST /api/ide/propose   — one coder model applies a task to a file (single proposal).
 *   POST /api/ide/council   — several role-specialists each propose (Odysseus-style
 *                             "Compare"), then a judge model picks the best. You review
 *                             all candidates side by side and approve one.
 *
 * Everything runs on the user's LOCAL models (Ollama /api/generate). Members run
 * SEQUENTIALLY on purpose — local council models share one GPU, and running them in
 * parallel thrashes VRAM (the same lesson baked into the chat council). The endpoint never
 * touches the filesystem; the desktop passes content in and writes approved diffs itself.
 */

import type { FastifyInstance } from 'fastify';

interface OllamaGenerateResponse {
  readonly response?: string;
}

const PROPOSE_TIMEOUT_MS = 90_000;

function localModelBaseUrl(): string {
  return (process.env.LOCAL_MODEL_URL?.trim() || 'http://localhost:11434').replace(/\/$/, '');
}

function coderModel(): string {
  return process.env.VAI_IDE_CODER_MODEL?.trim()
    || process.env.VAI_DICTATION_CLEANUP_MODEL?.trim()
    || 'qwen2.5-coder:7b';
}

/** Model that arbitrates between council candidates (defaults to the coder model). */
function judgeModel(): string {
  return process.env.VAI_IDE_JUDGE_MODEL?.trim() || coderModel();
}

/** Models we should never send a coding task to (embeddings / speech / vision-only). */
const IDE_MODEL_DENY = /embed|whisper|nomic|bge|minilm|clip|reranker|rerank|tts|piper/i;
/** Prefer these — coding-capable general LLMs — when spreading work across the council. */
const IDE_MODEL_PREFER = /coder|code|qwen|llama|deepseek|mistral|codestral|gemma|phi|command|granite|starcoder|yi/i;

/**
 * List distinct installed Ollama models suitable for coding, best-first. This is what lets
 * the council use ALL your local models — a different model per member, not one model in
 * different hats. Falls back to just the configured coder model if discovery fails.
 */
async function listCouncilModels(signal: AbortSignal): Promise<string[]> {
  try {
    const res = await fetch(`${localModelBaseUrl()}/api/tags`, { signal });
    if (!res.ok) return [coderModel()];
    const body = (await res.json()) as { models?: { name?: string }[] };
    const names = (body.models ?? [])
      .map((m) => (typeof m.name === 'string' ? m.name : ''))
      .filter((n) => n && !IDE_MODEL_DENY.test(n));
    // Coding-capable first, then the rest; dedupe.
    const ranked = [...names].sort((a, b) => Number(IDE_MODEL_PREFER.test(b)) - Number(IDE_MODEL_PREFER.test(a)));
    const seen = new Set<string>();
    const out = ranked.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
    return out.length ? out : [coderModel()];
  } catch {
    return [coderModel()];
  }
}

function unwrapFile(raw: string): string {
  let t = raw.trim();
  const fence = t.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/);
  if (fence) t = fence[1];
  return t.replace(/\r\n/g, '\n');
}

const ROLE_HINTS: Record<string, string> = {
  coder: 'You are a pragmatic generalist engineer.',
  frontend: 'You specialise in UI/UX, components, styling and accessibility.',
  backend: 'You specialise in server logic, data, APIs and correctness.',
  animation: 'You specialise in motion, transitions and perceived performance.',
  'human-sim': 'You act as a demanding user/QA, hardening edge cases and clarity.',
};

function buildEditPrompt(task: string, path: string, content: string, role?: string): string {
  const hint = role && ROLE_HINTS[role] ? ` ${ROLE_HINTS[role]}` : '';
  return [
    `You are an expert software engineer.${hint}`,
    'Apply the requested change to the file below.',
    'Return ONLY the COMPLETE updated file contents — no explanations, no markdown fences.',
    'Preserve unrelated code exactly. If the change does not apply, return the file unchanged.',
    '',
    `Task: ${task}`,
    '',
    `File: ${path}`,
    '---',
    content,
  ].join('\n');
}

interface RunResult {
  readonly ok: boolean;
  readonly text?: string;
  readonly status?: number;
  readonly error?: string;
}

/** One local-model generation. Never throws — returns a tagged result. */
async function runLocalModel(
  model: string,
  prompt: string,
  numPredict: number,
  signalMs: number,
): Promise<RunResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), signalMs);
  try {
    const response = await fetch(`${localModelBaseUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: process.env.VAI_LOCAL_KEEP_ALIVE?.trim() || '30m',
        options: { temperature: 0.1, num_predict: numPredict },
        prompt,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, status: response.status, error: detail.slice(0, 240) };
    }
    const parsed = (await response.json()) as OllamaGenerateResponse;
    return { ok: true, text: String(parsed.response ?? '') };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function editNumPredict(contentLen: number): number {
  return Math.min(8192, Math.max(512, Math.ceil(contentLen / 2)));
}

interface Candidate {
  readonly role: string;
  readonly after: string;
  readonly model: string;
  readonly changed: boolean;
}

/** Ask the judge which candidate is best. Returns a 0-based index (clamped) + rationale. */
async function judgeCandidates(
  task: string,
  path: string,
  candidates: Candidate[],
): Promise<{ pick: number; rationale: string }> {
  if (candidates.length <= 1) return { pick: 0, rationale: 'Only one candidate.' };
  const listed = candidates
    .map((c, i) => `### Option ${i} (${c.role})\n${c.after.slice(0, 1500)}`)
    .join('\n\n');
  const prompt = [
    'You are a senior engineer reviewing candidate edits to the same file.',
    `Task: ${task}`,
    `File: ${path}`,
    '',
    'Pick the SINGLE best option: correct, minimal, and faithful to the task.',
    'Reply with ONLY the option number, then a dash and a short reason. Example: "1 - clearest and safest".',
    '',
    listed,
  ].join('\n');
  const res = await runLocalModel(judgeModel(), prompt, 120, 30_000);
  if (!res.ok || !res.text) return { pick: 0, rationale: 'Judge unavailable — defaulting to first.' };
  const match = res.text.match(/\d+/);
  const idx = match ? Number(match[0]) : 0;
  const pick = Number.isFinite(idx) ? Math.max(0, Math.min(candidates.length - 1, idx)) : 0;
  const rationale = res.text.trim().slice(0, 200);
  return { pick, rationale };
}

export function registerIdeRoutes(app: FastifyInstance) {
  app.post<{
    Body: { task?: string; path?: string; content?: string; role?: string };
  }>('/api/ide/propose', async (request, reply) => {
    const { task, path, content, role } = request.body ?? {};
    if (!task?.trim() || typeof path !== 'string' || typeof content !== 'string') {
      return reply.status(400).send({ error: 'task, path and content are required' });
    }
    if (content.length > 200_000) {
      return reply.status(413).send({ error: 'File too large for a single-shot edit.' });
    }
    const model = coderModel();
    const res = await runLocalModel(
      model,
      buildEditPrompt(task.trim(), path, content, role),
      editNumPredict(content.length),
      PROPOSE_TIMEOUT_MS,
    );
    if (!res.ok || !res.text) {
      return reply.status(502).send({
        error: `Local coder model unavailable${res.status ? ` (HTTP ${res.status})` : ''}. Install one with \`ollama pull ${model}\`.`,
        detail: res.error,
      });
    }
    const after = unwrapFile(res.text);
    if (!after) return reply.status(502).send({ error: 'The coder model returned nothing.' });
    return reply.send({ path, after, model, changed: after !== content });
  });

  app.post<{
    Body: { task?: string; path?: string; content?: string; roles?: string[] };
  }>('/api/ide/council', async (request, reply) => {
    const { task, path, content, roles } = request.body ?? {};
    if (!task?.trim() || typeof path !== 'string' || typeof content !== 'string') {
      return reply.status(400).send({ error: 'task, path and content are required' });
    }
    if (content.length > 120_000) {
      return reply.status(413).send({ error: 'File too large for a council edit.' });
    }
    // Bound the panel: at most 4 members, dedup, known roles only.
    const chosen = (Array.isArray(roles) && roles.length ? roles : ['coder', 'backend', 'human-sim'])
      .filter((r) => r in ROLE_HINTS)
      .slice(0, 4);
    if (chosen.length === 0) chosen.push('coder');

    // Spread the council across ALL your distinct installed models — a different model per
    // member where possible (round-robin), so it's a real multi-model panel, not one model
    // in different hats. If you only have one model, everyone uses it (still distinct roles).
    const controller = new AbortController();
    const discoverTimer = setTimeout(() => controller.abort(), 4_000);
    const pool = await listCouncilModels(controller.signal).catch(() => [coderModel()]);
    clearTimeout(discoverTimer);

    const numPredict = editNumPredict(content.length);
    const candidates: Candidate[] = [];
    // Sequential — local members share one GPU; running them in parallel thrashes VRAM.
    for (let i = 0; i < chosen.length; i += 1) {
      const role = chosen[i];
      const model = pool[i % pool.length] ?? coderModel();
      const res = await runLocalModel(model, buildEditPrompt(task.trim(), path, content, role), numPredict, PROPOSE_TIMEOUT_MS);
      if (!res.ok || !res.text) continue;
      const after = unwrapFile(res.text);
      if (after) candidates.push({ role, after, model, changed: after !== content });
    }
    if (candidates.length === 0) {
      return reply.status(502).send({
        error: `No council member produced an edit. Ensure a local coder model is installed (\`ollama pull ${coderModel()}\`).`,
      });
    }
    const judge = await judgeCandidates(task.trim(), path, candidates);
    return reply.send({ path, candidates, judge, models: pool.slice(0, chosen.length) });
  });
}
