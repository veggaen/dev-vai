export type MicTriggerMode = 'hold' | 'toggle';

const KEY = 'vai-voice-mic-mode';

export function loadMicTriggerMode(): MicTriggerMode {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'toggle' ? 'toggle' : 'hold';
  } catch {
    return 'hold';
  }
}

export function saveMicTriggerMode(mode: MicTriggerMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch { /* non-fatal */ }
  window.dispatchEvent(new CustomEvent('vai:voice-mic-mode-changed', { detail: mode }));
}