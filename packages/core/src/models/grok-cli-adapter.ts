/**
 * Grok-CLI adapter — turns the locally-installed `grok` build TUI into a {@link ModelAdapter}
 * by shelling out to its headless single-turn mode:
 *   grok -p '<prompt>' --output-format json [--system-prompt-override <sys>] --disable-web-search
 *   → stdout: { "text": "<model output>", "stopReason": ..., ... }
 *
 * Why: Grok (hosted via the CLI) can SEE images and is a strong factual reasoner, so it makes
 * a vision-capable council member with NO local GB download and NO VRAM cost — the preferred
 * Stage C vision/fact verifier over pulling a local vision model. Measured headless latency
 * ~9s, which fits under the council's per-member timeout (a slow run is a non-blocking failure
 * handled by the council runner, exactly like any other member).
 *
 * Guardrails:
 *  - Availability is probed once (`grok` on PATH). When absent this adapter is simply not built;
 *    callers gate on {@link isGrokCliAvailable} so it's a no-op on machines without grok.
 *  - Fact-quarantine is unchanged: this adapter produces a council NOTE (intent/method/action),
 *    never a fact the user sees. Vai's own tools own every surfaced number/name.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ChatChunk, ChatRequest, ChatResponse, ModelAdapter } from './adapter.js';

let cachedAvailable: boolean | null = null;
let cachedBinPath: string | null = null;

/**
 * Resolve the grok executable. Prefers the native .exe at ~/.grok/bin (so we can spawn WITHOUT a
 * shell — on Windows a shell re-splits args that contain spaces/newlines, which breaks the
 * system-prompt + JSON prompt). Falls back to bare "grok" on PATH for non-Windows / custom installs.
 */
function resolveGrokBin(): string {
  if (cachedBinPath) return cachedBinPath;
  const candidates = process.platform === 'win32'
    ? [join(homedir(), '.grok', 'bin', 'grok.exe')]
    : [join(homedir(), '.grok', 'bin', 'grok')];
  cachedBinPath = candidates.find((p) => existsSync(p)) ?? 'grok';
  return cachedBinPath;
}

/** Probe (once, cached) whether the `grok` CLI is available. */
export function isGrokCliAvailable(): boolean {
  if (cachedAvailable !== null) return cachedAvailable;
  const bin = resolveGrokBin();
  // A resolved absolute .exe path is sufficient proof on Windows (probing spawns a slow process).
  if (bin !== 'grok' && existsSync(bin)) { cachedAvailable = true; return cachedAvailable; }
  try {
    const probe = spawnSync(bin, ['version'], { timeout: 5_000, stdio: 'ignore' });
    cachedAvailable = probe.status === 0 || (probe.error === undefined && probe.status !== null);
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

export interface GrokCliAdapterOptions {
  readonly id?: string;
  readonly displayName?: string;
  /** Hard wall-clock cap for one headless invocation (ms). Default 14_000 (under council 15s). */
  readonly timeoutMs?: number;
  /** Model id to pass to grok (`-m`), if you want a specific one. */
  readonly model?: string;
  /** Override the resolved `grok` binary path (tests). */
  readonly binPath?: string;
}

interface GrokHeadlessResult {
  readonly text?: string;
  readonly stopReason?: string;
}

/** Run grok headlessly with a single prompt + optional system-prompt override. Resolves the raw `.text`. */
function runGrokHeadless(
  prompt: string,
  systemPrompt: string | undefined,
  options: { timeoutMs: number; model?: string; binPath: string },
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'json', '--disable-web-search'];
    if (systemPrompt) args.push('--system-prompt-override', systemPrompt);
    if (options.model) args.push('-m', options.model);

    // No shell: spawn the native exe directly so args (system prompt, JSON) are passed verbatim.
    const child = spawn(options.binPath, args, { windowsHide: true });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`grok headless timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    const onAbort = () => { child.kill('SIGKILL'); reject(new Error('grok headless aborted')); };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (code !== 0 && !stdout.trim()) {
        const hint = ' (install the Grok TUI/Build so grok.exe is at %USERPROFILE%\\.grok\\bin\\grok.exe or "grok" on PATH; this enables Grok (CLI) as a vision-capable council member with no local VRAM)';
        reject(new Error(`grok exited ${code}: ${stderr.slice(0, 200)}${hint}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as GrokHeadlessResult;
        resolve((parsed.text ?? '').trim());
      } catch {
        // Some builds may print plain text; fall back to raw stdout.
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Create a Grok-CLI-backed {@link ModelAdapter}. Returns null when grok is not installed, so
 * callers can add it to a roster only when available without their own guard.
 */
export function createGrokCliAdapter(options: GrokCliAdapterOptions = {}): ModelAdapter | null {
  if (!isGrokCliAvailable()) return null;
  const id = options.id ?? 'grok-cli';
  const displayName = options.displayName ?? 'Grok (CLI)';
  const timeoutMs = options.timeoutMs ?? 14_000;
  const binPath = options.binPath ?? resolveGrokBin();

  const adapter: ModelAdapter = {
    id,
    displayName,
    provider: undefined,
    supportsStreaming: false,
    supportsToolUse: false,
    speedTier: 'slow',
    qualityTier: 'balanced',

    async chat(request: ChatRequest): Promise<ChatResponse> {
      const startedAt = Date.now();
      // Collapse the messages into a system override + a single user prompt (headless is single-turn).
      const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n') || undefined;
      const userContent = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => m.content)
        .join('\n\n');

      const text = await runGrokHeadless(userContent, system, { timeoutMs, model: options.model, binPath }, request.signal);
      return {
        message: { role: 'assistant', content: text },
        usage: { promptTokens: 0, completionTokens: 0 },
        finishReason: 'stop',
        durationMs: Date.now() - startedAt,
        modelId: id,
      };
    },

    async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
      // Headless grok is not token-streamed here; emit the full result as one delta then done.
      const res = await adapter.chat(request);
      yield { type: 'text_delta', textDelta: res.message.content } as ChatChunk;
      yield { type: 'done', modelId: id, durationMs: res.durationMs } as ChatChunk;
    },
  };
  return adapter;
}
