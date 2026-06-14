/**
 * Grok-CLI-backed vision adapter (Stage C).
 *
 * Reads image pixels by sending them to the locally-installed `grok` build TUI as ACP content
 * blocks via headless `--prompt-json`:
 *   grok --prompt-json '[{"type":"text","text":"..."},{"type":"image","data":"<b64>","mimeType":"image/png"}]'
 *        --output-format json --disable-web-search
 *   → stdout: { "text": "<grok's reading>", ... }
 *
 * The ACP block shape ({type:"image", data, mimeType}) and the proxy's 512-pixel minimum were
 * verified live before this was written — a 32x32 red PNG returns "red" in ~6.6s. Grok thus gives
 * Vai real image understanding with NO local GB vision model and NO VRAM.
 *
 * Guardrails: availability is gated on `isGrokCliAvailable`; absent grok → returns null (caller
 * declines honestly). The reading is VISUAL EVIDENCE for the council to review/correct, never a
 * fact handed straight to the user — Vai's grounded tools own the final number.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { VisionAdapter, VisionDescribeInput, VisionDescription } from './adapter.js';
import { isGrokCliAvailable } from '../models/grok-cli-adapter.js';

function resolveGrokBin(): string {
  const candidates = process.platform === 'win32'
    ? [join(homedir(), '.grok', 'bin', 'grok.exe')]
    : [join(homedir(), '.grok', 'bin', 'grok')];
  return candidates.find((p) => existsSync(p)) ?? 'grok';
}

export interface GrokVisionOptions {
  readonly id?: string;
  /** Wall-clock cap for one describe call (ms). Default 20_000 (vision is slower than text). */
  readonly timeoutMs?: number;
  readonly binPath?: string;
  readonly model?: string;
}

interface GrokResult { readonly text?: string }

function runGrokVision(
  blocks: unknown,
  opts: { timeoutMs: number; binPath: string; model?: string },
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['--prompt-json', JSON.stringify(blocks), '--output-format', 'json', '--disable-web-search'];
    if (opts.model) args.push('-m', opts.model);
    const child = spawn(opts.binPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`grok vision timed out after ${opts.timeoutMs}ms`)); }, opts.timeoutMs);
    const onAbort = () => { child.kill('SIGKILL'); reject(new Error('grok vision aborted')); };
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
      if (code !== 0 && !stdout.trim()) { reject(new Error(`grok vision exited ${code}: ${stderr.slice(0, 200)}`)); return; }
      try {
        const parsed = JSON.parse(stdout.trim()) as GrokResult;
        resolve((parsed.text ?? '').trim());
      } catch {
        resolve(stdout.trim());
      }
    });
  });
}

/** Heuristic: a reply that admits it couldn't see the image should not count as a real reading. */
function isNonReading(text: string): boolean {
  return !text || /image (?:not received|bytes are truncated|failed)|cannot (?:see|view|read) (?:the|this) image|no image/i.test(text);
}

/** Create a Grok-CLI vision adapter, or null when grok is unavailable. */
export function createGrokVisionAdapter(options: GrokVisionOptions = {}): VisionAdapter | null {
  if (!isGrokCliAvailable()) return null;
  const id = options.id ?? 'vision:grok-cli';
  const timeoutMs = options.timeoutMs ?? 20_000;
  const binPath = options.binPath ?? resolveGrokBin();

  return {
    id,
    canSee: true,
    async describe(input: VisionDescribeInput): Promise<VisionDescription | null> {
      const question = input.question?.trim()
        || 'Describe exactly what this image shows. If it contains any numbers, prices, or text, transcribe them verbatim.';
      const blocks = [
        { type: 'text', text: question },
        { type: 'image', data: input.dataBase64, mimeType: input.mime || 'image/png' },
      ];
      try {
        const text = await runGrokVision(blocks, { timeoutMs, binPath, model: options.model }, input.signal);
        if (isNonReading(text)) return null;
        return { text, confidence: 0.7, source: id };
      } catch {
        return null; // an unreadable image declines honestly; never throws into the turn
      }
    },
  };
}
