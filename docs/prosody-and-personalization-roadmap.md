# Prosody-Aware & Personalized Dictation — Design Roadmap

Status: draft / vision. Author: Vai voice team. Last updated: 2026-07.

This document extends Vai dictation from "words in, words out" toward a system that
(1) learns each user's voice over time and (2) reads *how* something is said — loudness,
pitch, pace, pauses — and turns that into formatting. It also covers the edge cases and
the legal guardrails, because the naive version of this idea is a compliance landmine.

> **Priority note (2026-07):** the prosody→formatting / "emotion" feature (§1–§2) is
> **deprioritized** — kept here for reference, but not on the near-term path. The active
> goal is **per-user acoustic adaptation to improve WORD accuracy** (§3–§4): using each
> speaker's own voice + corrections so the model predicts their words more reliably.

---

## 0. Where we are today

Pipeline: mic → `MediaRecorder` → local Whisper (`/api/stt/transcribe`, tiers
base.en / distil-medium.en / large-v3-turbo) → deterministic groom (`prettifyTranscript`)
→ per-user correction rules (`speech-profile.ts`) → optional local-LLM polish
(`/api/stt/polish`, now `qwen3:4b`). Personalization exists only at the **text layer**
(word-substitution rules + a custom-vocabulary list). The acoustic model never adapts.

Two things just shipped alongside this doc:
- The deterministic groom now runs **after** the LLM polish, so the model can't
  reintroduce spacing/casing errors (the "engineer.Currently" bug).
- Local cleanup default upgraded to **Qwen3 4B** (`ollama pull qwen3:4b`).

---

## 1. The core new idea: prosody → formatting

Speech carries a *paralinguistic* channel on top of the words. We already compute mic
energy for the level meter (`recorder-stt-adapter.ts`); that same signal, plus a couple
more, becomes structured formatting intent.

### Features to extract (cheap, real-time, from audio we already capture)
- **Energy / loudness** (RMS) — already computed for the meter.
- **Pitch (F0)** and its contour — rising vs falling at phrase end.
- **Speaking rate** — syllables/words per second, and elongation (drawn-out vowels).
- **Pauses** — silence gaps and their length.

### Voice-to-text mapping (intent, not "emotion")
| What we hear | Formatting intent |
|---|---|
| Sustained high energy on a word/phrase | emphasis → **bold**, or *caps* if very high |
| Rising F0 at end of phrase | `?` |
| Falling energy + trailing pause | `.` and/or paragraph break |
| Long mid-sentence pause | comma or sentence break |
| Drawn-out / slowed word | emphasis or `…` |
| Short punchy high-energy utterance | `!` |

Frame this as **prosody → punctuation/emphasis**, *not* "emotion recognition." That
distinction is legally load-bearing (see §5).

### Text-to-speech inverse (for the TTS side)
The same map runs backwards: **CAPS/bold → louder + emphatic**, `!` → higher energy,
`…` / italics → slower, `?` → rising terminal pitch, paragraph breaks → longer pauses.
This makes Vai's spoken output expressive in a way that round-trips with how the user
dictated it.

---

## 2. Edge cases (this is where the idea lives or dies)

Absolute acoustic thresholds are useless. Everything below forces the design toward
**per-user, relative, calibrated** signals.

**Calibration / normalization**
- Mic gain, distance, and OS auto-gain (AGC) make absolute dB meaningless. Normalize to
  the user's **own rolling baseline**, per session and long-term.
- A naturally loud speaker must not get everything in CAPS; a soft speaker must still get
  emphasis. Emphasis = deviation from *their* mean, not a global threshold.
- Whispering in a quiet room ≠ calm; it may be "quiet environment," not low arousal.

**Environment & attribution**
- Background noise, TV, other people talking — never attribute others' loudness to the
  user. Gate prosody on voice-activity + (ideally) the user's own speaker profile.
- Non-speech events: coughs, laughs, sneezes, doorbells → must not become `!` or CAPS.

**Language & physiology**
- **Tonal languages** (Mandarin, Vietnamese, Thai): pitch encodes *lexical tone*, not
  emotion. Pitch→punctuation mapping must be language-aware or disabled for these.
- **Speech differences** (stutter, dysarthria, ADHD-fast speech, second-language pacing):
  "slow" or "dragging" is not emotion and must never be pathologized or mis-formatted.
  This is an accessibility red line.

**Semantic ambiguity**
- Loud can be *excited* or *angry* — arousal is clear, valence isn't. Don't claim to know
  the emotion; only act on the safe, ambiguous-proof signal (emphasis, breaks, questions).
- Sarcasm/irony can invert intent. Don't try to detect it; don't auto-rewrite.

**Product safety**
- Auto-CAPS is easy to get embarrassingly wrong (yelling → ALL-CAPS work email). Require a
  **confidence threshold**, a global toggle (default conservative), a one-keystroke undo,
  and visible/subtle formatting (prefer bold over CAPS by default).
- **Determinism**: the same phrase said the same way must format the same way, or users
  stop trusting it. Prefer a small number of high-precision rules over many fuzzy ones.

**Performance**
- Feature extraction must be sub-frame cheap and never stall the recorder loop (that loop
  already trips the chord watchdog if blocked — see the dictation fixes).

---

## 3. Cohorts & "geolocation" — the privacy-safe version

The instinct ("people nearby may speak alike, warm-start them") maps to **accent/dialect
adaptation** and is real and valuable. But **voice + precise location, linked** is one of
the most heavily regulated data combinations there is, and voiceprints are invertible
(re-identifiable). So do the version that keeps the upside and sheds the liability:

- **Cluster on the audio, not on location.** Group users by how their voice *sounds*
  (unsupervised acoustic clustering) and use an anonymous cluster ID as a feature. The
  fairness literature explicitly avoids zip codes / raw embeddings for exactly this reason.
- **Region is at most a coarse, optional prior** (country/timezone), never precise GPS.
- **Adapt on-device by default.** Each user's own (audio → corrected-text) pairs train a
  personal profile that never leaves their machine.
- **Cross-user learning via federated learning** — devices share *model updates*, not raw
  voice — and only under explicit opt-in.

Result: the "it grows on everyone the more they use it" network effect, without a central
store of voiceprints tied to locations.

---

## 4. Data & architecture — incremental phases

- **Phase 0 — Capture (foundation).** Persist, on-device and with consent, per-utterance:
  raw audio, final corrected transcript, and the prosodic feature vector (energy/F0/rate/
  pauses). This is the asset that powers everything; today we throw the audio away.
- **Phase 1 — Baseline calibration.** Maintain rolling per-user stats (loudness/pitch/rate
  distributions) so all prosody is relative to the speaker.
- **Phase 2 — Prosody → formatting (V2T).** Ship the high-precision subset (emphasis,
  question, sentence/paragraph breaks) behind a toggle + confidence gate + undo.
- **Phase 3 — Formatting → prosody (T2V).** Inverse map for expressive TTS.
- **Phase 4 — Personal acoustic adapter.** Train a per-user **LoRA/AdaLoRA** adapter on the
  Phase-0 pairs; load it at decode. Adapts the acoustic model to their accent/voice.
- **Phase 5 — Cohort warm-start (optional, consented, federated).** Acoustic-cluster priors
  so new users inherit a head start from similar-sounding speakers.

Decode-time biasing is a parallel quick win: route the final pass through faster-whisper or
whisper.cpp (which accept `hotwords`/`initial_prompt`) and seed it with the user's
vocabulary + recent corrections (highest-value terms last, ≤224 tokens).

---

## 5. Legal & ethical guardrails (non-negotiable)

- **EU AI Act, Art. 5(1)(f):** inferring emotions from **biometric data** (incl. voice) in
  **workplace and education** contexts is **prohibited** as of 2 Feb 2025, with narrow
  medical/safety exceptions. Fines up to €35M or 7% of global turnover. Dictation is used
  heavily at work — so **do not build a voice "emotion" classifier.** Build a
  **prosody → formatting** feature (punctuation/emphasis), keep it framed and implemented
  as such, and never surface or store an "emotion" label. Notably, emotional content in the
  *written text* is not covered — only biometric inference is.
- **Biometric consent (GDPR / Illinois BIPA, etc.):** voiceprints and stored audio are
  biometric/sensitive data. Explicit opt-in, clear retention limits, easy deletion,
  on-device by default.
- **Accessibility:** never treat atypical prosody (disfluency, dysarthria, non-native pace)
  as signal about the person. No diagnosis, no pathologizing.
- **Transparency & control:** user-visible toggle, conservative defaults, one-keystroke
  undo, and a plain-language explanation of what's captured and where it lives.

---

## 6. Recommended next steps

1. **(done)** Groom-after-polish fix + Qwen3 4B cleanup default.
2. Phase 0 capture: opt-in on-device store of (audio, corrected text, prosody vector).
3. Decode-time biasing via faster-whisper hotwords seeded from vocabulary + corrections.
4. Phase 2 prosody→formatting: ship only emphasis + question + breaks, behind a toggle.
5. Phase 4 personal LoRA adapter once enough pairs exist.

---

### Sources
- EU AI Act Art. 5 prohibited practices — https://artificialintelligenceact.eu/article/5/
- FPF, emotion-recognition prohibition (workplace/education) — https://fpf.org/blog/red-lines-under-eu-ai-act-unpacking-the-prohibition-of-emotion-recognition-in-the-workplace-and-education-institutions/
- Fairness/robustness via unsupervised acoustic clustering — https://arxiv.org/pdf/2306.06083
- Invertibility of voice-privacy embeddings — https://arxiv.org/pdf/2110.05431
- Rare-word recognition / prompt biasing for Whisper — https://arxiv.org/html/2502.11572v1
- Personalized ASR with AdaLoRA / continual learning — https://arxiv.org/pdf/2407.00756
- faster-whisper (hotwords / initial_prompt) — https://github.com/SYSTRAN/faster-whisper
