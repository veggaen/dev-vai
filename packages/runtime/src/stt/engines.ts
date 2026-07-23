/**
 * Local-first speech-to-text engines for Vai dictation.
 *
 * Precedence (deterministic, code-owned — not prompt magic):
 *   1. Built-in Whisper (transformers.js v3 / onnxruntime-node) over client-decoded PCM
 *      — CPU inference (measured correct; DirectML emits garbage for Whisper),
 *      no API key, works offline. Quality tiers: base.en / distil-medium.en /
 *      large-v3-turbo(q4), all verified on this machine.
 *   2. Ollama `/v1/audio/transcriptions` or `/api/transcribe` when a transcription model is installed
 *   3. Optional cloud OpenAI audio API when the user or operator supplied a key
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { looksLikeAsrArtifactTranscript, stripNonSpeechAnnotations } from '@vai/core';

const OPENAI_AUDIO_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_CLOUD_MODEL = 'gpt-4o-mini-transcribe';

const WEB_MEDIA = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
]);

export type SttEngineSource = 'builtin' | 'ollama' | 'cloud';

export interface SttEngineChoice {
  readonly source: SttEngineSource;
  readonly engine: string;
  readonly apiKey?: string;
  readonly ollamaModel?: string;
  readonly builtinModel?: string;
}

export interface TranscribeRequestOptions {
  readonly preferOllama?: boolean;
  readonly requestedModel?: string;
}

export interface LocalBuiltinStatus {
  readonly configured: boolean;
  readonly engine: string;
  readonly model: string;
  readonly error?: string;
}

export interface LocalOllamaStatus {
  readonly configured: boolean;
  readonly engine: string | null;
  readonly model: string | null;
  readonly pullHint: string;
  readonly error?: string;
}

export interface SttStatusSnapshot {
  readonly configured: boolean;
  readonly engine: string | null;
  readonly source: SttEngineSource | null;
  readonly builtin: LocalBuiltinStatus;
  readonly ollama: LocalOllamaStatus;
  readonly cloud: {
    readonly configured: boolean;
    readonly engine: string | null;
    readonly userKeyConfigured: boolean;
    readonly envKeyConfigured: boolean;
  };
}

interface OllamaTagModel {
  readonly name: string;
  readonly capabilities?: readonly string[];
}

function localModelBaseUrl(): string {
  return (process.env.LOCAL_MODEL_URL?.trim() || 'http://localhost:11434').replace(/\/$/, '');
}

/** Default builtin model — large-v3-turbo: near large-v3 WER with a 4-layer decoder. */
const DEFAULT_BUILTIN_MODEL = 'onnx-community/whisper-large-v3-turbo';
/** Known-good small model — the safety net when turbo cannot download/load. */
const FALLBACK_BUILTIN_MODEL = 'Xenova/whisper-small.en';

function builtinWhisperModel(): string {
  return process.env.VAI_STT_BUILTIN_MODEL?.trim() || DEFAULT_BUILTIN_MODEL;
}

function resolveBuiltinModel(requested?: string): string {
  const trimmed = requested?.trim();
  // Allowlist: trusted ONNX orgs only, whisper-family models only.
  if (
    trimmed
    && /^(?:Xenova|onnx-community|distil-whisper)\/[\w.-]+$/.test(trimmed)
    && /whisper|distil/i.test(trimmed)
  ) {
    return trimmed;
  }
  return builtinWhisperModel();
}

type BuiltinDtype = string | Record<string, string>;

/**
 * Quantization per model. Turbo's int8/"quantized" decoder is known-broken
 * (garbage tokens); q4 keeps near-fp32 WER at ~1/4 the download.
 */
function dtypeForModel(model: string): BuiltinDtype {
  const override = process.env.VAI_STT_BUILTIN_DTYPE?.trim();
  if (override) return override;
  if (/large-v3-turbo/i.test(model)) {
    return { encoder_model: 'q4', decoder_model_merged: 'q4' };
  }
  // onnx-community/whisper-base.en ships q4 (verified 0.9s/utterance on CPU).
  if (/^onnx-community\/whisper-base/i.test(model)) return 'q4';
  return 'q8';
}

/**
 * CPU by default — MEASURED on RTX 3080 Ti (2026-07): the DirectML EP produces
 * pure garbage tokens for Whisper at BOTH q4 and fp16 (onnxruntime-node DML +
 * KV-cache bug), while CPU decodes turbo q4 correctly. Opt into GPU with
 * VAI_STT_DEVICE=dml; the garbage guard below still catches broken output and
 * re-runs on CPU, so wrong text never reaches the user.
 */
function preferredSttDevice(): string {
  const configured = process.env.VAI_STT_DEVICE?.trim().toLowerCase();
  if (configured) return configured;
  return 'cpu';
}

function preferredOllamaSttModel(): string {
  return process.env.VAI_STT_OLLAMA_MODEL?.trim()
    || process.env.VAI_STT_LOCAL_MODEL?.trim()
    || 'whisper-large-v3-turbo';
}

function whisperCacheDir(): string {
  const configured = process.env.VAI_WHISPER_CACHE?.trim();
  if (configured) return configured;
  const base = process.env.LOCALAPPDATA?.trim() || join(homedir(), '.cache');
  const dir = join(base, 'vai-whisper-cache');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeMime(mimeType: string): string {
  return mimeType.toLowerCase().trim().split(';')[0];
}

function isPcmMime(mimeType: string): boolean {
  const base = normalizeMime(mimeType);
  return base === 'audio/pcm-f32le' || base === 'audio/pcm' || base === 'audio/raw';
}

function pcmSampleRate(mimeType: string): number {
  const match = /rate=(\d+)/i.exec(mimeType);
  const parsed = match ? Number(match[1]) : 16_000;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 16_000;
}

function audioExtension(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  return 'bin';
}

async function listOllamaModels(signal: AbortSignal): Promise<OllamaTagModel[]> {
  const response = await fetch(`${localModelBaseUrl()}/api/tags`, { signal });
  if (!response.ok) throw new Error(`Ollama tags ${response.status}`);
  const body = await response.json() as { models?: OllamaTagModel[] };
  return body.models ?? [];
}

function modelMatches(requested: string, installed: string): boolean {
  const a = requested.replace(/:latest$/i, '');
  const b = installed.replace(/:latest$/i, '');
  return b === a || b.startsWith(`${a}:`);
}

export async function resolveOllamaSttModel(signal: AbortSignal): Promise<string | null> {
  const preferred = preferredOllamaSttModel();
  let models: OllamaTagModel[];
  try {
    models = await listOllamaModels(signal);
  } catch {
    return null;
  }

  // Only models that advertise transcription work with Ollama's audio API.
  // Community "whisper" chat models do NOT — they cause the /api/transcribe 404 the user hit.
  const withTranscription = models.find((m) => m.capabilities?.includes('transcription'));
  if (withTranscription) return withTranscription.name;

  const preferredHit = models.find(
    (m) => modelMatches(preferred, m.name) && m.capabilities?.includes('transcription'),
  );
  return preferredHit?.name ?? null;
}

type XenovaPipeline = (
  audio: Float32Array,
  options?: {
    sampling_rate?: number;
    language?: string;
    task?: string;
    chunk_length_s?: number;
    stride_length_s?: number;
    return_timestamps?: boolean;
  },
) => Promise<{ text?: string } | Array<{ text?: string }>>;

// Pipelines are cached PER MODEL so the live-preview model (fast tier) and the
// release model (balanced/best tier) stay hot side by side. A single-slot cache
// forced a full model reload on EVERY dictation release (preview loads base.en,
// release loads distil-medium) — the main "final text takes seconds" bug.
const MAX_CACHED_PIPELINES = 3;
const builtinPipelines = new Map<string, Promise<XenovaPipeline>>();

async function createBuiltinPipeline(model: string): Promise<XenovaPipeline> {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.cacheDir = whisperCacheDir();
  const dtype = dtypeForModel(model) as never;
  const device = preferredSttDevice() as never;
  try {
    const pipe = await pipeline('automatic-speech-recognition', model, { dtype, device });
    return pipe as unknown as XenovaPipeline;
  } catch (error) {
    if ((preferredSttDevice()) === 'cpu') throw error;
    // GPU execution provider unavailable on this machine — dictation must still work.
    const pipe = await pipeline('automatic-speech-recognition', model, { dtype, device: 'cpu' as never });
    return pipe as unknown as XenovaPipeline;
  }
}

async function loadBuiltinPipeline(model: string, signal: AbortSignal): Promise<XenovaPipeline> {
  let entry = builtinPipelines.get(model);
  if (!entry) {
    entry = createBuiltinPipeline(model).catch((error) => {
      // Never cache a failed load — the next request should retry cleanly.
      builtinPipelines.delete(model);
      throw error;
    });
    // LRU-ish: drop the oldest entry when over budget (Map preserves insert order).
    while (builtinPipelines.size >= MAX_CACHED_PIPELINES) {
      const oldest = builtinPipelines.keys().next().value;
      if (oldest === undefined) break;
      builtinPipelines.delete(oldest);
    }
    builtinPipelines.set(model, entry);
  } else {
    // Refresh recency.
    builtinPipelines.delete(model);
    builtinPipelines.set(model, entry);
  }
  const pipe = await entry;
  if (signal.aborted) throw new Error('aborted');
  return pipe;
}

let warmupStarted = false;
const FAST_PTT_BUILTIN_MODEL = 'onnx-community/whisper-base.en';

export function builtinWarmupModels(configuredModel: string): string[] {
  const model = configuredModel.trim() || 'distil-whisper/distil-medium.en';
  return model === FAST_PTT_BUILTIN_MODEL
    ? [FAST_PTT_BUILTIN_MODEL]
    : [FAST_PTT_BUILTIN_MODEL, model];
}

/**
 * Pre-load the latency-critical global-PTT model first, then the desktop's
 * ordinary balanced model. Fire-and-forget; failures are silent and retried on
 * demand. Opt out with VAI_STT_WARMUP=0.
 */
export function warmBuiltinWhisper(delayMs = 3_000): void {
  if (warmupStarted || process.env.VAI_STT_WARMUP === '0') return;
  warmupStarted = true;
  const model = process.env.VAI_STT_BUILTIN_MODEL?.trim() || 'distil-whisper/distil-medium.en';
  const timer = setTimeout(() => {
    // Warm the fast game-PTT tier first, then the ordinary balanced tier.
    // Sequential loading avoids simultaneous GPU and disk pressure.
    const [fastModel, balancedModel] = builtinWarmupModels(model);
    loadBuiltinPipeline(fastModel!, new AbortController().signal)
      .then(() => balancedModel
        ? loadBuiltinPipeline(balancedModel, new AbortController().signal)
        : undefined)
      .catch(() => undefined);
  }, delayMs);
  timer.unref?.();
}

function encodePcm16Wav(pcm: Float32Array, sampleRate: number): Buffer {
  const dataSize = pcm.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcm.length; i++) {
    const sample = pcm[i] ?? 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    buffer.writeInt16LE(Math.round(clamped * 32_767), 44 + i * 2);
  }
  return buffer;
}

export async function probeBuiltinWhisper(_signal: AbortSignal): Promise<LocalBuiltinStatus> {
  const model = builtinWhisperModel();
  try {
    await import('@huggingface/transformers');
    return { configured: true, engine: `builtin:${model}`, model };
  } catch (error) {
    return {
      configured: false,
      engine: `builtin:${model}`,
      model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeOllamaStt(signal: AbortSignal): Promise<LocalOllamaStatus> {
  const pullHint = `ollama pull ${preferredOllamaSttModel()}`;
  try {
    const model = await resolveOllamaSttModel(signal);
    if (!model) {
      return {
        configured: false,
        engine: null,
        model: null,
        pullHint,
        error: 'No Ollama transcription model is installed yet.',
      };
    }
    return {
      configured: true,
      engine: `ollama:${model}`,
      model,
      pullHint,
    };
  } catch (error) {
    return {
      configured: false,
      engine: null,
      model: null,
      pullHint,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function buildSttStatus(
  cloudConfigured: boolean,
  cloudMeta: { userKeyConfigured: boolean; envKeyConfigured: boolean },
  signal: AbortSignal,
): Promise<SttStatusSnapshot> {
  const [builtin, ollama] = await Promise.all([
    probeBuiltinWhisper(signal),
    probeOllamaStt(signal),
  ]);

  const source: SttEngineSource | null = builtin.configured
    ? 'builtin'
    : ollama.configured
      ? 'ollama'
      : cloudConfigured
        ? 'cloud'
        : null;

  const engine = source === 'builtin'
    ? builtin.engine
    : source === 'ollama'
      ? ollama.engine
      : source === 'cloud'
        ? (process.env.VAI_STT_MODEL?.trim() || DEFAULT_CLOUD_MODEL)
        : null;

  return {
    configured: Boolean(source),
    engine,
    source,
    builtin,
    ollama,
    cloud: {
      configured: cloudConfigured,
      engine: cloudConfigured ? (process.env.VAI_STT_MODEL?.trim() || DEFAULT_CLOUD_MODEL) : null,
      userKeyConfigured: cloudMeta.userKeyConfigured,
      envKeyConfigured: cloudMeta.envKeyConfigured,
    },
  };
}

export function chooseEngineForRequest(
  status: SttStatusSnapshot,
  mimeType: string,
  hasCloudKey: boolean,
  options?: TranscribeRequestOptions,
): SttEngineChoice | null {
  const builtinModel = resolveBuiltinModel(options?.requestedModel);
  if (options?.preferOllama && status.ollama.configured && status.ollama.model) {
    return {
      source: 'ollama',
      engine: status.ollama.engine ?? `ollama:${status.ollama.model}`,
      ollamaModel: status.ollama.model,
      builtinModel,
    };
  }
  // Built-in Whisper is the default local path for PCM — only when the probe succeeded.
  if (isPcmMime(mimeType) && status.builtin.configured) {
    return { source: 'builtin', engine: `builtin:${builtinModel}`, builtinModel };
  }
  if (status.ollama.configured && status.ollama.model) {
    return { source: 'ollama', engine: status.ollama.engine ?? `ollama:${status.ollama.model}`, ollamaModel: status.ollama.model };
  }
  if (hasCloudKey) {
    return {
      source: 'cloud',
      engine: `cloud:${process.env.VAI_STT_MODEL?.trim() || DEFAULT_CLOUD_MODEL}`,
      apiKey: 'present',
    };
  }
  return null;
}

/**
 * Deterministic broken-decode detector. A faulty GPU execution provider does
 * not error — it emits confident junk (`!!!!`, mixed-script soup, massive
 * repetition). Real dictation, even mumbled, never looks like this.
 */
export function looksLikeGarbageTranscript(text: string, audioSeconds: number): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // 1. Absurd verbosity: > 8 words per second of audio is beyond human speech.
  const words = trimmed.split(/\s+/);
  if (audioSeconds > 0.5 && words.length / audioSeconds > 8) return true;
  // 2. Symbol/replacement-char storms.
  const junkChars = (trimmed.match(/[!�@#$%^*)(]{2,}/g) ?? []).join('').length;
  if (junkChars / trimmed.length > 0.05) return true;
  // 3. Mixed-script soup (Latin + ≥2 other scripts) — impossible for one dictation.
  const scripts = [/[\u0400-\u04FF]/, /[\u4E00-\u9FFF]/, /[\uAC00-\uD7AF]/, /[\u0370-\u03FF]/, /[\u3040-\u30FF]/]
    .filter((re) => re.test(trimmed)).length;
  if (scripts >= 2 && /[a-z]/i.test(trimmed)) return true;
  // 4. Heavy immediate word repetition (broken KV cache signature).
  let repeats = 0;
  for (let i = 1; i < words.length; i++) if (words[i] === words[i - 1]) repeats++;
  return words.length >= 12 && repeats / words.length > 0.2;
}

/**
 * True when a transcript from a small/fast model deserves a second opinion from
 * the top-tier model. Two triggers:
 *   1. ASR syllable-debris artifacts (existing detector), and
 *   2. implausible sparsity — the client trims silence before upload, so ≥3s of
 *      kept audio yielding under ~0.5 words/sec means the small model dropped
 *      words rather than the user pausing.
 */
export function transcriptDeservesEscalation(text: string, audioSeconds: number): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (looksLikeAsrArtifactTranscript(trimmed)) return true;
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  return audioSeconds >= 3 && words / audioSeconds < 0.5;
}

async function decodeOnce(
  transcriber: XenovaPipeline,
  pcm: Float32Array,
  mimeType: string,
  language: string | undefined,
  modelId: string,
): Promise<string> {
  // English-only checkpoints reject language/task decode options.
  const englishOnly = /[.-]en$/i.test(modelId);
  const lang = language?.split('-')[0];
  const result = await transcriber(pcm, {
    sampling_rate: pcmSampleRate(mimeType),
    ...(englishOnly ? {} : { language: lang, task: 'transcribe' }),
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: false,
  });
  const text = Array.isArray(result) ? result[0]?.text : result.text;
  return (text ?? '').trim();
}

async function transcribeBuiltinPcm(
  audio: Buffer,
  mimeType: string,
  language: string | undefined,
  signal: AbortSignal,
  model?: string,
): Promise<string> {
  if (audio.byteLength % 4 !== 0) throw new Error('PCM payload length is not float32-aligned');
  const pcm = new Float32Array(audio.buffer, audio.byteOffset, audio.byteLength / 4);
  if (pcm.length < 1_600) return '';
  const resolvedModel = resolveBuiltinModel(model);
  let transcriber: XenovaPipeline;
  let modelId = resolvedModel;
  try {
    transcriber = await loadBuiltinPipeline(resolvedModel, signal);
  } catch (error) {
    // Turbo failed to download/load (offline first run, disk, EP bug) — dictation
    // must still produce text, so drop to the known-good small model.
    if (resolvedModel === FALLBACK_BUILTIN_MODEL) throw error;
    transcriber = await loadBuiltinPipeline(FALLBACK_BUILTIN_MODEL, signal);
    modelId = FALLBACK_BUILTIN_MODEL;
  }
  const audioSeconds = pcm.length / pcmSampleRate(mimeType);
  let text: string;
  try {
    text = await decodeOnce(transcriber, pcm, mimeType, language, modelId);
  } catch (error) {
    // A broken GPU EP can also throw mid-decode (empty token_ids). Retry on CPU.
    if (preferredSttDevice() === 'cpu') throw error;
    transcriber = await recreatePipelineOnCpu(modelId, signal);
    text = await decodeOnce(transcriber, pcm, mimeType, language, modelId);
  }
  if (looksLikeGarbageTranscript(text, audioSeconds) && preferredSttDevice() !== 'cpu') {
    // GPU EP emitted junk without erroring — the exact failure mode DirectML
    // shows for Whisper. Rebuild on CPU; wrong text must never reach the user.
    transcriber = await recreatePipelineOnCpu(modelId, signal);
    text = await decodeOnce(transcriber, pcm, mimeType, language, modelId);
  }
  if (
    text
    && transcriptDeservesEscalation(text, audioSeconds)
    && !/large-v3-turbo/i.test(modelId)
    && !signal.aborted
  ) {
    try {
      const bestTranscriber = await loadBuiltinPipeline(DEFAULT_BUILTIN_MODEL, signal);
      const bestText = await decodeOnce(bestTranscriber, pcm, mimeType, language, DEFAULT_BUILTIN_MODEL);
      if (
        bestText
        && !looksLikeGarbageTranscript(bestText, audioSeconds)
        && !looksLikeAsrArtifactTranscript(bestText)
      ) {
        text = bestText;
      }
    } catch {
      // Keep the first transcript; the guarded cleanup layer still gets a chance.
    }
  }
  return text;
}

/** Drop the cached (broken) GPU pipelines and rebuild the same model on CPU. */
async function recreatePipelineOnCpu(model: string, signal: AbortSignal): Promise<XenovaPipeline> {
  process.env.VAI_STT_DEVICE = 'cpu';
  builtinPipelines.clear();
  return loadBuiltinPipeline(model, signal);
}

/**
 * Whisper-style decode prompt from the user's custom vocabulary. Listing the
 * exact spellings in the prompt biases OpenAI-compatible engines toward them
 * ("League of Legends" instead of "allegiance") — decode-time biasing, which
 * beats post-hoc correction. The builtin transformers.js path can't take a
 * prompt (prompt_ids is unimplemented there), so it keeps the cleanup-layer
 * restoration instead.
 */
function vocabularyPrompt(vocabulary: readonly string[] | undefined): string | null {
  if (!vocabulary?.length) return null;
  return `Glossary: ${vocabulary.slice(0, 60).join(', ')}.`;
}

async function transcribeOllamaBuffer(
  audio: Buffer,
  mimeType: string,
  language: string | undefined,
  model: string,
  signal: AbortSignal,
  vocabulary?: readonly string[],
): Promise<string> {
  const ext = audioExtension(mimeType);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `dictation.${ext}`);
  form.append('model', model);
  if (language) form.append('language', language.split('-')[0]);
  const prompt = vocabularyPrompt(vocabulary);
  if (prompt) form.append('prompt', prompt);

  const headers = { Authorization: 'Bearer ollama' };
  const endpoints = ['/v1/audio/transcriptions', '/api/transcribe'];
  let lastError = 'Ollama transcription failed';

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${localModelBaseUrl()}${endpoint}`, {
        method: 'POST',
        headers,
        body: form,
        signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        lastError = `Ollama ${endpoint} ${response.status}: ${detail.slice(0, 240)}`;
        continue;
      }
      const parsed = await response.json() as { text?: string };
      const text = (parsed.text ?? '').trim();
      if (text) return text;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError);
}

async function transcribeCloudBuffer(
  audio: Buffer,
  mimeType: string,
  language: string | undefined,
  apiKey: string,
  signal: AbortSignal,
  vocabulary?: readonly string[],
): Promise<string> {
  const form = new FormData();
  const ext = audioExtension(mimeType);
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `dictation.${ext}`);
  form.append('model', process.env.VAI_STT_MODEL?.trim() || DEFAULT_CLOUD_MODEL);
  if (language) form.append('language', language.split('-')[0]);
  const prompt = vocabularyPrompt(vocabulary);
  if (prompt) form.append('prompt', prompt);

  const response = await fetch(OPENAI_AUDIO_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Cloud STT ${response.status}: ${detail.slice(0, 300)}`);
  }
  const parsed = await response.json() as { text?: string };
  return (parsed.text ?? '').trim();
}

export function validateAudioMime(mimeType: string): boolean {
  const base = normalizeMime(mimeType);
  return isPcmMime(mimeType) || WEB_MEDIA.has(base);
}

export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
  language: string | undefined,
  choice: SttEngineChoice,
  apiKey: string | null,
  signal: AbortSignal,
  vocabulary?: readonly string[],
): Promise<string> {
  if (choice.source === 'builtin') {
    // Whisper emits "[BLANK_AUDIO]"/"[Music]" style annotations for silence and
    // noise — strip them HERE so no client ever flashes them at the user.
    const text = await transcribeBuiltinPcm(audio, mimeType, language, signal, choice.builtinModel);
    return stripNonSpeechAnnotations(text);
  }
  if (choice.source === 'ollama' && choice.ollamaModel) {
    if (isPcmMime(mimeType)) {
      const pcm = new Float32Array(audio.buffer, audio.byteOffset, audio.byteLength / 4);
      const wav = encodePcm16Wav(pcm, pcmSampleRate(mimeType));
      return transcribeOllamaBuffer(wav, 'audio/wav', language, choice.ollamaModel, signal, vocabulary);
    }
    return transcribeOllamaBuffer(audio, mimeType, language, choice.ollamaModel, signal, vocabulary);
  }
  if (choice.source === 'cloud' && apiKey) {
    return transcribeCloudBuffer(audio, mimeType, language, apiKey, signal, vocabulary);
  }
  throw new Error('No speech engine is available for this request.');
}

export function missingEngineMessage(status: SttStatusSnapshot): string {
  if (!status.builtin.configured && !status.ollama.configured) {
    return [
      'Audio was captured, but local speech-to-text is still starting up.',
      'Vai uses your own models: built-in Whisper loads on first use, or install an Ollama transcription model',
      `(${status.ollama.pullHint}).`,
      'Local AI cleanup is ready once raw text exists.',
      status.builtin.error ? `Builtin: ${status.builtin.error}` : '',
    ].filter(Boolean).join(' ');
  }
  return [
    'Audio was captured, but the desktop could not decode it for local Whisper.',
    'Hold the mic a little longer, then retry. Built-in Whisper is the default engine.',
    status.builtin.error ? `Builtin: ${status.builtin.error}` : '',
  ].filter(Boolean).join(' ');
}
