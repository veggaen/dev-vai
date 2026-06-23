import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSpeechTtsAdapter } from './web-speech-tts-adapter.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('WebSpeechTtsAdapter', () => {
  it('reports unavailable without speechSynthesis', () => {
    vi.stubGlobal('window', {});
    expect(new WebSpeechTtsAdapter().isAvailable()).toBe(false);
  });

  it('resolves immediately for empty text and never calls the engine', async () => {
    const speak = vi.fn();
    vi.stubGlobal('window', { speechSynthesis: { speak, cancel: vi.fn() } });
    vi.stubGlobal('SpeechSynthesisUtterance', class { onend: any; onerror: any; constructor(public text: string) {} });
    await new WebSpeechTtsAdapter().speak({ text: '   ' });
    expect(speak).not.toHaveBeenCalled();
  });

  it('speaks non-empty text and resolves on the utterance end event', async () => {
    let utter: any;
    const speak = vi.fn((u) => { utter = u; queueMicrotask(() => u.onend?.()); });
    vi.stubGlobal('window', { speechSynthesis: { speak, cancel: vi.fn() } });
    vi.stubGlobal('SpeechSynthesisUtterance', class { onend: any; onerror: any; lang = ''; rate = 1; constructor(public text: string) {} });
    await new WebSpeechTtsAdapter().speak({ text: 'hello', lang: 'en-US' });
    expect(speak).toHaveBeenCalledOnce();
    expect(utter.text).toBe('hello');
  });

  it('cancel clears the engine queue', () => {
    const cancel = vi.fn();
    vi.stubGlobal('window', { speechSynthesis: { speak: vi.fn(), cancel } });
    new WebSpeechTtsAdapter().cancel();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
