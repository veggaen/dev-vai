/**
 * Decode recorded mic blobs into 16 kHz mono float32 PCM for local Whisper.
 * Runs in the WebView (Chromium decodeAudioData) so the runtime never needs ffmpeg.
 */

function mixToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const out = new Float32Array(length);
  const channels = buffer.numberOfChannels;
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i] += data[i] / channels;
  }
  return out;
}

async function renderAt16k(buffer: AudioBuffer): Promise<Float32Array> {
  const targetRate = 16_000;
  const frames = Math.max(1, Math.ceil(buffer.duration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const mono = offline.createBuffer(1, buffer.length, buffer.sampleRate);
  const mixed = mixToMono(buffer);
  mono.copyToChannel(new Float32Array(mixed), 0);
  const source = offline.createBufferSource();
  source.buffer = mono;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

export function trimPcmSilence(
  pcm: Float32Array,
  sampleRate = 16_000,
  opts: { threshold?: number; padMs?: number } = {},
): Float32Array {
  if (pcm.length === 0) return pcm;
  const threshold = opts.threshold ?? 0.006;
  const padSamples = Math.max(0, Math.round((opts.padMs ?? 120) * sampleRate / 1000));
  const frameSize = Math.max(1, Math.floor(sampleRate * 0.02));

  const frameHasSpeech = (frame: number): boolean => {
    const start = frame * frameSize;
    const end = Math.min(pcm.length, start + frameSize);
    for (let i = start; i < end; i += 1) {
      if (Math.abs(pcm[i] ?? 0) >= threshold) return true;
    }
    return false;
  };

  const frames = Math.ceil(pcm.length / frameSize);
  let first = -1;
  for (let frame = 0; frame < frames; frame += 1) {
    if (frameHasSpeech(frame)) { first = frame; break; }
  }
  if (first < 0) return pcm;

  let last = first;
  for (let frame = frames - 1; frame >= first; frame -= 1) {
    if (frameHasSpeech(frame)) { last = frame; break; }
  }

  const start = Math.max(0, first * frameSize - padSamples);
  const end = Math.min(pcm.length, (last + 1) * frameSize + padSamples);
  if (start === 0 && end === pcm.length) return pcm;
  return pcm.slice(start, end);
}

function float32ToBase64(pcm: Float32Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface PcmPayload {
  readonly data: string;
  readonly mimeType: string;
}

/**
 * Decode mic audio for built-in Whisper. We intentionally do NOT fall back to raw
 * webm here — that used to route into broken community Ollama "whisper" models.
 */
export async function prepareTranscribePayload(blob: Blob, _mimeType: string): Promise<PcmPayload> {
  const decodeCtx = new AudioContext();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
    const pcm = trimPcmSilence(await renderAt16k(decoded), 16_000);
    if (pcm.length < 1_600) {
      throw new Error('Too little audio was captured — hold the mic longer while speaking.');
    }
    return {
      data: float32ToBase64(pcm),
      mimeType: 'audio/pcm-f32le;rate=16000',
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw {
      code: 'unsupported',
      message: `Could not prepare audio for local Whisper: ${detail}`,
    };
  } finally {
    await decodeCtx.close().catch(() => undefined);
  }
}

