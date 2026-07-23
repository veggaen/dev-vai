import { describe, expect, it } from 'vitest';
import {
  builtinWarmupModels,
  chooseEngineForRequest,
  looksLikeGarbageTranscript,
  transcriptDeservesEscalation,
  validateAudioMime,
  type SttStatusSnapshot,
} from './engines.js';

describe('builtinWarmupModels', () => {
  it('warms the latency-critical game PTT model before the balanced model', () => {
    expect(builtinWarmupModels('distil-whisper/distil-medium.en')).toEqual([
      'onnx-community/whisper-base.en',
      'distil-whisper/distil-medium.en',
    ]);
  });

  it('does not load base.en twice when it is already configured', () => {
    expect(builtinWarmupModels('onnx-community/whisper-base.en')).toEqual([
      'onnx-community/whisper-base.en',
    ]);
  });
});

function mockStatus(overrides: Partial<SttStatusSnapshot> = {}): SttStatusSnapshot {
  return {
    configured: true,
    engine: 'builtin:Xenova/whisper-small.en',
    source: 'builtin',
    builtin: {
      configured: true,
      engine: 'builtin:Xenova/whisper-small.en',
      model: 'Xenova/whisper-small.en',
    },
    ollama: {
      configured: false,
      engine: null,
      model: null,
      pullHint: 'ollama pull whisper-large-v3-turbo',
    },
    cloud: {
      configured: false,
      engine: null,
      userKeyConfigured: false,
      envKeyConfigured: false,
    },
    ...overrides,
  };
}

describe('validateAudioMime', () => {
  it('accepts pcm and webm payloads', () => {
    expect(validateAudioMime('audio/pcm-f32le;rate=16000')).toBe(true);
    expect(validateAudioMime('audio/webm;codecs=opus')).toBe(true);
    expect(validateAudioMime('audio/midi')).toBe(false);
  });
});

describe('chooseEngineForRequest', () => {
  it('prefers builtin whisper for pcm without any api key', () => {
    const choice = chooseEngineForRequest(mockStatus(), 'audio/pcm-f32le;rate=16000', false);
    expect(choice?.source).toBe('builtin');
  });

  it('falls back to cloud only when local engines are unavailable', () => {
    const status = mockStatus({
      source: 'cloud',
      builtin: { configured: false, engine: 'builtin:Xenova/whisper-small.en', model: 'Xenova/whisper-small.en' },
      ollama: { configured: false, engine: null, model: null, pullHint: 'ollama pull whisper-large-v3-turbo' },
      cloud: { configured: true, engine: 'gpt-4o-mini-transcribe', userKeyConfigured: true, envKeyConfigured: false },
    });
    const choice = chooseEngineForRequest(status, 'audio/webm', true);
    expect(choice?.source).toBe('cloud');
  });

  it('does not pick unconfigured builtin for pcm', () => {
    const status = mockStatus({
      configured: false,
      source: null,
      engine: null,
      builtin: { configured: false, engine: 'builtin:Xenova/whisper-small.en', model: 'Xenova/whisper-small.en', error: 'sharp missing' },
      ollama: { configured: false, engine: null, model: null, pullHint: 'ollama pull whisper-large-v3-turbo' },
    });
    const choice = chooseEngineForRequest(status, 'audio/pcm-f32le;rate=16000', false);
    expect(choice).toBeNull();
  });

  it('does not route pcm into ollama when builtin is available', () => {
    const status = mockStatus({
      ollama: {
        configured: true,
        engine: 'ollama:karanchopda333/whisper',
        model: 'karanchopda333/whisper',
        pullHint: 'ollama pull whisper-large-v3-turbo',
      },
    });
    const choice = chooseEngineForRequest(status, 'audio/pcm-f32le;rate=16000', false);
    expect(choice?.source).toBe('builtin');
  });
});

describe('transcriptDeservesEscalation', () => {
  it('accepts a normal-density transcript', () => {
    // ~2 words/sec — typical dictation over silence-trimmed audio.
    expect(transcriptDeservesEscalation('Add a dark mode toggle to the settings panel please', 5)).toBe(false);
  });

  it('flags implausibly sparse output from long audio (dropped words)', () => {
    // 8 seconds of kept (silence-trimmed) speech producing two words means the
    // small model dropped most of the utterance.
    expect(transcriptDeservesEscalation('Add toggle', 8)).toBe(true);
  });

  it('leaves short utterances alone', () => {
    expect(transcriptDeservesEscalation('Stop', 1.2)).toBe(false);
    expect(transcriptDeservesEscalation('Undo that', 2.4)).toBe(false);
  });

  it('never escalates empty text (no-speech handling owns that)', () => {
    expect(transcriptDeservesEscalation('', 6)).toBe(false);
    expect(transcriptDeservesEscalation('   ', 6)).toBe(false);
  });
});

describe('looksLikeGarbageTranscript', () => {
  it('accepts real dictation, including fillers and repeats', () => {
    expect(looksLikeGarbageTranscript('Add a dark mode toggle to the settings panel.', 3.2)).toBe(false);
    expect(looksLikeGarbageTranscript('Okay so basically what I want is, um, take the chat window and make the composer sticky.', 6.5)).toBe(false);
    expect(looksLikeGarbageTranscript('no no no wait, undo that', 2.5)).toBe(false);
    expect(looksLikeGarbageTranscript('', 3)).toBe(false);
  });

  it('flags the exact DirectML garbage captured live (2026-07)', () => {
    const dmlGarbage = 'Add colder# Bes UM!ram%% matar festa festa Theam! resumeswlishops resumes лож vidare vidare лож приш Strong Rawоронakteakte rippednak clipping cracked première segregated результат until until Muslim cup verk 주고 テスト!!!!!!';
    expect(looksLikeGarbageTranscript(dmlGarbage, 3.2)).toBe(true);
  });

  it('flags symbol storms and absurd verbosity', () => {
    expect(looksLikeGarbageTranscript('!!!!!@@@@!!!! word !!!!! more !!!!!', 5)).toBe(true);
    const flood = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    expect(looksLikeGarbageTranscript(flood, 3)).toBe(true);
  });

  it('flags heavy immediate repetition (broken KV cache signature)', () => {
    const repeated = 'homeless homeless homeless homeless homeless homeless compliance asteroids asteroids Bier Bier dale dale garbage garbage';
    expect(looksLikeGarbageTranscript(repeated, 10)).toBe(true);
  });
});
