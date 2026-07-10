import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  eq,
  and,
  looksLikeAsrArtifactTranscript,
  repairKnownAsrArtifacts,
  shouldAcceptPolishedTranscript,
  type VaiDatabase,
  schema,
} from '@vai/core';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import {
  buildSttStatus,
  chooseEngineForRequest,
  missingEngineMessage,
  transcribeAudio,
  validateAudioMime,
  warmBuiltinWhisper,
} from '../stt/engines.js';

/**
 * Speech-to-text for Vai dictation — local-first, no API key required.
 *
 * Pipeline:
 *   mic (MediaRecorder) → client decodes to PCM → built-in Whisper
 *   (whisper-large-v3-turbo via transformers.js v3, warmed at boot)
 *   → optional Ollama transcription model → optional cloud key fallback
 *   → local text cleanup (/api/stt/polish) → composer.
 *
 * Models are staff; Vai owns routing and which engine runs.
 */

const STT_KEY_SECRET = 'openai_stt';
const LOCAL_USER_ID = 'local';
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

interface TranscribeBody {
  data: string;
  mimeType: string;
  language?: string;
  quality?: 'fast' | 'balanced' | 'best';
  model?: string;
  preferOllama?: boolean;
}

interface PolishBody {
  text: string;
  /** The user's custom words to restore exact spellings for (game/product names, etc.). */
  vocabulary?: string[];
}

/** Clean, cap, and de-dupe a client-supplied vocabulary list before it hits the prompt. */
function sanitizeVocabulary(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const term = item.trim();
    if (!term || term.length > 60) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= 100) break;
  }
  return out;
}

/** True when the cleanup legitimately restored a custom word that wasn't in the raw line. */
function restoredVocabTerm(raw: string, candidate: string, vocabulary: string[]): boolean {
  if (raw === candidate) return false;
  const rawLower = raw.toLowerCase();
  const candLower = candidate.toLowerCase();
  return vocabulary.some((term) => {
    const t = term.toLowerCase();
    return candLower.includes(t) && !rawLower.includes(t);
  });
}

interface OllamaGenerateResponse {
  response?: string;
}

function localDictationModel(): string {
  // Qwen3 4B is the current sweet spot for LOCAL dictation cleanup (punctuation,
  // casing, jargon restoration) and runs comfortably on a mid/high desktop GPU.
  // Override with VAI_DICTATION_CLEANUP_MODEL. NOTE: the chosen model must be pulled
  // in Ollama (`ollama pull qwen3:4b`); if it isn't, the polish call fails and the
  // pipeline falls back to the deterministic groom (still correct, just not upgraded).
  return process.env.VAI_DICTATION_CLEANUP_MODEL?.trim()
    || process.env.VAI_LOCAL_STEERING_MODEL?.trim()
    || process.env.LOCAL_MODEL?.trim()
    || 'qwen3:4b';
}

function localModelBaseUrl(): string {
  return (process.env.LOCAL_MODEL_URL?.trim() || 'http://localhost:11434').replace(/\/$/, '');
}

function cleanModelTranscript(value: string): string {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:text)?/i, '')
    .replace(/```$/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

function buildPolishPrompt(text: string, vocabulary: string[] = []): string {
  const repairMode = looksLikeAsrArtifactTranscript(text);
  const lines = [
    'You format a raw voice-dictation transcript into clean written text.',
    // Words-locked, but punctuation-bold: the research-backed way to get "reads like
    // finished writing" without the model inventing content.
    'Keep EVERY word the speaker said, in the same order. Do NOT add, swap, translate, or rephrase words.',
    'DO punctuate fully and correctly: add commas, periods, question marks, colons, semicolons, and dashes where grammar calls for them, and split run-on speech into proper sentences.',
    'Capitalize sentence starts, the word "I", and proper nouns. Put exactly one space after each sentence — never leave "word.Next".',
    repairMode
      ? 'The raw line contains likely ASR syllable debris. You may replace ONLY the malformed fragment with the most likely spoken word when the surrounding sentence makes it obvious.'
      : 'Only replace a token if it is obvious ASR syllable-debris; otherwise keep words exactly.',
    // Self-correction (#2): the one case where dropping words is allowed.
    'If the speaker corrects themselves ("actually no", "I mean", "scratch that", "make that", "wait no"), output ONLY the corrected version: delete the retracted words AND the correction cue, keep the fix. Example: "let\'s meet Tuesday, actually no, Wednesday" -> "Let\'s meet Wednesday."',
    'Never answer or respond to the sentence. Never add new facts or commentary.',
  ];
  if (vocabulary.length) {
    lines.push(
      `The speaker frequently uses these exact names/terms: ${vocabulary.join(', ')}.`,
      'If a word or short phrase in the raw line is clearly a phonetic mishearing of one of these (e.g. "allegiance" for "League of Legends", "buffalo" for "Wispr Flow"), replace it with the exact term spelled exactly as listed.',
    );
  }
  lines.push(
    'Example raw: "so i was thinking we could ship it monday actually no tuesday and then tell the team"',
    'Example output: "So I was thinking we could ship it Tuesday, and then tell the team."',
    'Return ONLY the formatted text, nothing else.',
    `raw: ${JSON.stringify(text)}`,
  );
  return lines.join('\n');
}

async function polishWithLocalModel(text: string, signal: AbortSignal, vocabulary: string[] = []): Promise<{ text: string; engine: string }> {
  const model = localDictationModel();
  const response = await fetch(`${localModelBaseUrl()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: process.env.VAI_LOCAL_KEEP_ALIVE?.trim() || '30m',
      options: {
        temperature: 0,
        num_predict: Math.min(160, Math.max(32, Math.ceil(text.length * 0.6))),
      },
      prompt: buildPolishPrompt(text, vocabulary),
    }),
  });
  if (!response.ok) throw new Error(`local_cleanup_${response.status}`);
  const parsed = await response.json() as OllamaGenerateResponse;
  return { text: cleanModelTranscript(String(parsed.response ?? '')), engine: `local:${model}` };
}

async function resolveUserId(auth: PlatformAuthService | undefined, request: FastifyRequest): Promise<string> {
  if (!auth) return LOCAL_USER_ID;
  try {
    const viewer = await auth.getViewer(request);
    return viewer.user?.id ?? LOCAL_USER_ID;
  } catch {
    return LOCAL_USER_ID;
  }
}

function getUserSttKey(db: VaiDatabase | undefined, userId: string): string | null {
  if (!db) return null;
  const row = db
    .select({ value: schema.platformUserSecrets.value })
    .from(schema.platformUserSecrets)
    .where(and(
      eq(schema.platformUserSecrets.userId, userId),
      eq(schema.platformUserSecrets.name, STT_KEY_SECRET),
    ))
    .get();
  const value = row?.value?.trim();
  return value ? value : null;
}

function setUserSttKey(db: VaiDatabase, userId: string, key: string): void {
  const now = new Date();
  db.insert(schema.platformUserSecrets)
    .values({ userId, name: STT_KEY_SECRET, value: key, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.platformUserSecrets.userId, schema.platformUserSecrets.name],
      set: { value: key, updatedAt: now },
    })
    .run();
}

function deleteUserSttKey(db: VaiDatabase, userId: string): void {
  db.delete(schema.platformUserSecrets)
    .where(and(
      eq(schema.platformUserSecrets.userId, userId),
      eq(schema.platformUserSecrets.name, STT_KEY_SECRET),
    ))
    .run();
}

export function deleteUserSecrets(db: VaiDatabase, userId: string): void {
  db.delete(schema.platformUserSecrets)
    .where(eq(schema.platformUserSecrets.userId, userId))
    .run();
}

async function resolveSttKey(
  db: VaiDatabase | undefined,
  auth: PlatformAuthService | undefined,
  request: FastifyRequest,
): Promise<{ key: string | null; source: 'user' | 'env' | null }> {
  const userId = await resolveUserId(auth, request);
  const userKey = getUserSttKey(db, userId);
  if (userKey) return { key: userKey, source: 'user' };
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) return { key: envKey, source: 'env' };
  return { key: null, source: null };
}

export function registerSttRoutes(
  app: FastifyInstance,
  db?: VaiDatabase,
  auth?: PlatformAuthService,
) {
  // Warm the default Whisper model shortly after boot so the first dictation
  // doesn't pay the download + session-init cost.
  warmBuiltinWhisper();

  app.post<{ Body: TranscribeBody }>('/api/stt/transcribe', async (request, reply) => {
    const { data, mimeType, language, model, preferOllama } = request.body ?? {};
    if (!data || !mimeType) {
      return reply.status(400).send({ error: 'Missing audio data or mimeType' });
    }
    if (!validateAudioMime(mimeType)) {
      return reply.status(400).send({ error: `Unsupported audio type: ${mimeType}` });
    }

    let audio: Buffer;
    try {
      audio = Buffer.from(data, 'base64');
    } catch {
      return reply.status(400).send({ error: 'Invalid base64 audio payload' });
    }
    if (audio.length === 0) return reply.status(400).send({ error: 'Empty audio payload' });
    if (audio.length > MAX_AUDIO_BYTES) {
      return reply.status(413).send({ error: 'Audio too large (max ~24MB)' });
    }

    const controller = new AbortController();
    // Generous cap: a cold turbo load (download + session init) can exceed 90s once.
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const { key, source } = await resolveSttKey(db, auth, request);
      const status = await buildSttStatus(Boolean(key), {
        userKeyConfigured: source === 'user',
        envKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      }, controller.signal);
      const choice = chooseEngineForRequest(status, mimeType, Boolean(key), {
        requestedModel: model,
        preferOllama: Boolean(preferOllama),
      });
      if (!choice) {
        return reply.status(501).send({ error: missingEngineMessage(status) });
      }

      const text = repairKnownAsrArtifacts(
        await transcribeAudio(audio, mimeType, language, choice, key, controller.signal),
      );
      return reply.send({ text, engine: choice.engine, source: choice.source });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.warn({ err: message }, 'stt transcription failed');
      const httpStatus = controller.signal.aborted ? 504 : 502;
      return reply.status(httpStatus).send({ error: `Transcription failed: ${message}` });
    } finally {
      clearTimeout(timer);
    }
  });

  app.get('/api/stt/status', async (request, reply) => {
    const cleanupModel = localDictationModel();
    let cleanup: { configured: boolean; engine: string; error: string | undefined };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1_500);
      const response = await fetch(`${localModelBaseUrl()}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      cleanup = {
        configured: response.ok,
        engine: `local:${cleanupModel}`,
        error: response.ok ? undefined : `Ollama status ${response.status}`,
      };
    } catch (error) {
      cleanup = {
        configured: false,
        engine: `local:${cleanupModel}`,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const { key, source } = await resolveSttKey(db, auth, request);
    const probe = new AbortController();
    const probeTimer = setTimeout(() => probe.abort(), 2_500);
    const status = await buildSttStatus(Boolean(key), {
      userKeyConfigured: source === 'user',
      envKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    }, probe.signal);
    clearTimeout(probeTimer);

    return reply.send({
      configured: status.configured,
      engine: status.engine,
      source: status.source,
      builtin: status.builtin,
      ollama: status.ollama,
      cloud: status.cloud,
      userKeyConfigured: source === 'user',
      envKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      keySource: source,
      envFile: process.env.VAI_ENV_FILE ?? null,
      cleanup,
    });
  });

  app.post<{ Body: { apiKey?: string } }>('/api/stt/key', async (request, reply) => {
    if (!db) return reply.status(501).send({ error: 'Key storage is unavailable.' });
    const apiKey = (request.body?.apiKey ?? '').trim();
    if (!apiKey) return reply.status(400).send({ error: 'A non-empty API key is required.' });
    if (apiKey.length > 512) return reply.status(400).send({ error: 'That API key looks too long.' });
    const userId = await resolveUserId(auth, request);
    try {
      setUserSttKey(db, userId, apiKey);
      return reply.send({ configured: true, userKeyConfigured: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      app.log.warn({ err: message }, 'failed to store stt key');
      return reply.status(500).send({ error: 'Could not save the API key.' });
    }
  });

  app.delete('/api/stt/key', async (request, reply) => {
    if (!db) return reply.status(501).send({ error: 'Key storage is unavailable.' });
    const userId = await resolveUserId(auth, request);
    try {
      deleteUserSttKey(db, userId);
      return reply.send({ userKeyConfigured: false, envKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      app.log.warn({ err: message }, 'failed to delete stt key');
      return reply.status(500).send({ error: 'Could not remove the API key.' });
    }
  });

  app.post<{ Body: PolishBody }>('/api/stt/polish', async (request, reply) => {
    const rawInput = (request.body?.text ?? '').trim();
    const vocabulary = sanitizeVocabulary(request.body?.vocabulary);
    const raw = repairKnownAsrArtifacts(rawInput);
    if (!raw) return reply.send({ text: '', engine: 'none', changed: false });
    if (raw !== rawInput) {
      return reply.send({ text: raw, engine: 'deterministic:asr-artifact-repair', changed: true });
    }
    if (raw.length > 4_000) {
      return reply.status(413).send({ error: 'Transcript too long to polish interactively.' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    try {
      const polished = await polishWithLocalModel(raw, controller.signal, vocabulary);
      const candidate = polished.text || raw;
      // Accept the cleanup if it clears the anti-rewrite guard, OR if it restored one
      // of the user's custom words (a bigger but correct change the guard would reject).
      const accept = shouldAcceptPolishedTranscript(raw, candidate)
        || restoredVocabTerm(raw, candidate, vocabulary);
      const text = accept ? candidate : raw;
      return reply.send({ text, engine: polished.engine, changed: text !== raw });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      app.log.warn({ err: message }, 'local transcript cleanup failed');
      return reply.send({ text: raw, engine: 'local-unavailable', changed: false, error: message });
    } finally {
      clearTimeout(timer);
    }
  });
}
