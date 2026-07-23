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

/**
 * Condition mic PCM for Whisper: remove DC offset and normalize quiet input.
 *
 * Low-level mic signals are a top real-world cause of Whisper misrecognition —
 * the log-mel features compress badly when speech peaks sit far below full
 * scale. This boosts quiet recordings toward a target RMS (~-20 dBFS) with a
 * hard peak ceiling and a max-gain clamp so silence/noise is never amplified
 * into fake speech. Deterministic and safe to run on every capture.
 */
export function conditionPcm(pcm: Float32Array): Float32Array {
  if (pcm.length === 0) return pcm;

  // 1. DC offset — cheap mean removal (an offset skews mel features and the
  //    silence-trim threshold below).
  let mean = 0;
  for (let i = 0; i < pcm.length; i += 1) mean += pcm[i] ?? 0;
  mean /= pcm.length;

  // 2. Peak + RMS on the offset-corrected signal.
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    const v = (pcm[i] ?? 0) - mean;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSquares += v * v;
  }
  const rms = Math.sqrt(sumSquares / pcm.length);

  // 3. Gain: lift quiet speech toward -20 dBFS RMS. Never boost more than 8×
  //    (a near-silent capture is noise, not speech) and never push the peak
  //    past 0.95 (no clipping).
  const TARGET_RMS = 0.1;
  const MAX_GAIN = 8;
  let gain = 1;
  if (rms > 1e-5 && rms < TARGET_RMS) gain = Math.min(TARGET_RMS / rms, MAX_GAIN);
  if (peak * gain > 0.95) gain = 0.95 / peak;

  // No meaningful correction needed — return the input untouched.
  if (Math.abs(mean) < 1e-4 && Math.abs(gain - 1) < 1e-3) return pcm;

  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) out[i] = ((pcm[i] ?? 0) - mean) * gain;
  return out;
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

/**
 * Reject electrical noise and near-silence before Whisper can hallucinate words.
 * This intentionally examines the un-normalized signal: conditioning boosts quiet
 * speech, but must never turn a silent microphone's noise floor into fake speech.
 */
export function hasSpeechEnergy(pcm: Float32Array, sampleRate = 16_000): boolean {
  if (pcm.length < Math.round(sampleRate * 0.1)) return false;

  let mean = 0;
  for (let i = 0; i < pcm.length; i += 1) mean += pcm[i] ?? 0;
  mean /= pcm.length;

  const frameSize = Math.max(1, Math.round(sampleRate * 0.02));
  let activeFrames = 0;
  let peak = 0;
  let totalSquares = 0;
  for (let start = 0; start < pcm.length; start += frameSize) {
    const end = Math.min(pcm.length, start + frameSize);
    let frameSquares = 0;
    for (let i = start; i < end; i += 1) {
      const value = (pcm[i] ?? 0) - mean;
      const abs = Math.abs(value);
      if (abs > peak) peak = abs;
      frameSquares += value * value;
      totalSquares += value * value;
    }
    const frameRms = Math.sqrt(frameSquares / Math.max(1, end - start));
    if (frameRms >= 0.008) activeFrames += 1;
  }

  const overallRms = Math.sqrt(totalSquares / pcm.length);
  return peak >= 0.02 && overallRms >= 0.0025 && activeFrames >= 2;
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
    const rawPcm = await renderAt16k(decoded);
    if (!hasSpeechEnergy(rawPcm, 16_000)) {
      throw { code: 'no-speech', message: 'No speech energy was detected.' };
    }
    // Condition BEFORE trimming: normalizing quiet input first means the
    // silence-trim threshold sees speech at a predictable level.
    const pcm = trimPcmSilence(conditionPcm(rawPcm), 16_000);
    if (pcm.length < 1_600) {
      throw new Error('Too little audio was captured — hold the mic longer while speaking.');
    }
    return {
      data: float32ToBase64(pcm),
      mimeType: 'audio/pcm-f32le;rate=16000',
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw {
      code: 'unsupported',
      message: `Could not prepare audio for local Whisper: ${detail}`,
    };
  } finally {
    await decodeCtx.close().catch(() => undefined);
  }
}
