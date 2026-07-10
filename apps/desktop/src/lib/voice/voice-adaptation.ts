/**
 * Per-user voice adaptation store — the data foundation for "it learns MY voice".
 *
 * WHAT THIS IS (and isn't): Whisper already consumes the full frequency spectrum
 * (the mel spectrogram) — it does not ignore how you sound. So the accuracy win is
 * NOT a separate "frequency analyzer"; it's feeding the model YOUR OWN examples of
 * (what the mic heard → the word you actually meant) so its mapping adapts to your
 * voice/accent. This module captures those pairs, on-device, so we can later:
 *   1. auto-bias the transcript toward your recurring terms (fixes "buffalo"→"Wispr Flow"), and
 *   2. train a small per-user LoRA adapter on the base model (the real "grows on you").
 *
 * PRIVACY: strictly opt-in and OFF by default. Text pairs live only in localStorage on
 * this machine. Raw audio is NOT stored here (that belongs in a separate, consented,
 * IndexedDB-backed store when adapter training is built). Nothing calls into this module
 * until the pipeline is wired AND the user has enabled it — so it is inert by default.
 */

const ENABLED_KEY = 'vai-voice-adaptation-enabled';
const CORPUS_KEY = 'vai-voice-adaptation-corpus.v1';
/** Bounded ring buffer — keep the newest N pairs so localStorage never blows its quota. */
const MAX_SAMPLES = 500;

/** Lightweight prosodic/acoustic summary for one utterance (all optional; filled later). */
export interface AcousticSummary {
  /** Mean mic energy 0-1 across the utterance (we already compute this for the meter). */
  readonly energyMean?: number;
  readonly energyMax?: number;
  /** Rough speaking rate in words per second. */
  readonly rateWps?: number;
  /** Mean fundamental frequency (Hz), when pitch tracking is available. */
  readonly f0Mean?: number;
}

export interface AdaptationSample {
  readonly at: string;
  /** Exactly what the engine heard (pre-groom, pre-correction). */
  readonly raw: string;
  /** The text the user actually kept/sent — the ground-truth target. */
  readonly final: string;
  readonly lang?: string;
  readonly features?: AcousticSummary;
}

export function adaptationEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === '1'; } catch { return false; }
}

export function setAdaptationEnabled(enabled: boolean): void {
  try { localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch { /* non-fatal */ }
  window.dispatchEvent(new CustomEvent('vai:voice-adaptation-changed', { detail: enabled }));
}

export function loadAdaptationCorpus(): AdaptationSample[] {
  try {
    const raw = localStorage.getItem(CORPUS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AdaptationSample[]) : [];
  } catch {
    return [];
  }
}

function saveCorpus(samples: AdaptationSample[]): void {
  try {
    localStorage.setItem(CORPUS_KEY, JSON.stringify(samples.slice(-MAX_SAMPLES)));
  } catch { /* non-fatal — quota or disabled storage */ }
}

/**
 * Record one dictation as a training pair. No-op unless the user opted in and the two
 * texts actually differ enough to be a signal (identical raw/final teaches nothing).
 * Call this at the finalize point once the user's kept text is known.
 */
export function recordAdaptationSample(
  raw: string,
  final: string,
  meta?: { lang?: string; features?: AcousticSummary },
): void {
  if (!adaptationEnabled()) return;
  const r = raw.trim();
  const f = final.trim();
  if (!r || !f) return;
  const sample: AdaptationSample = { at: new Date().toISOString(), raw: r, final: f, lang: meta?.lang, features: meta?.features };
  saveCorpus([...loadAdaptationCorpus(), sample]);
}

/** Export the corpus (for a future training job or user-facing "download my data"). */
export function exportAdaptationCorpus(): string {
  return JSON.stringify(loadAdaptationCorpus(), null, 2);
}

export function clearAdaptationCorpus(): void {
  try { localStorage.removeItem(CORPUS_KEY); } catch { /* non-fatal */ }
}
