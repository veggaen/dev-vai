/**
 * useVoiceOutput — speak text aloud via the TTS adapter (the OUTPUT half of voice; the input
 * half is useVoiceDictation). Off by default; the caller flips `enabled` (e.g. an "🔊 read aloud"
 * toggle). Serial queue, cancel on unmount. Free/local (browser speechSynthesis).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { getDefaultTtsAdapter } from '../lib/voice/web-speech-tts-adapter.js';

export function useVoiceOutput(enabled: boolean) {
  const adapter = useMemo(() => getDefaultTtsAdapter(), []);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const available = adapter.isAvailable();

  const speak = useCallback((text: string, lang?: string) => {
    if (!enabledRef.current || !text.trim()) return;
    void adapter.speak({ text, lang });
  }, [adapter]);

  const cancel = useCallback(() => adapter.cancel(), [adapter]);

  // Stop speaking if the feature is turned off or the component unmounts.
  useEffect(() => {
    if (!enabled) adapter.cancel();
    return () => adapter.cancel();
  }, [enabled, adapter]);

  return { available, speak, cancel };
}
