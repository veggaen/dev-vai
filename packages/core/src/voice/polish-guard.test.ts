import { describe, expect, it } from 'vitest';
import {
  isTokenSubsequence,
  looksLikeAsrArtifactTranscript,
  repairKnownAsrArtifacts,
  shouldAcceptPolishedTranscript,
  stripNonSpeechAnnotations,
  transcriptWordOverlap,
} from './polish-guard.js';

describe('polish-guard', () => {
  it('strips whisper non-speech annotations everywhere they hide', () => {
    expect(stripNonSpeechAnnotations('[BLANK_AUDIO]')).toBe('');
    expect(stripNonSpeechAnnotations('(blank audio)')).toBe('');
    expect(stripNonSpeechAnnotations('[ Silence ]')).toBe('');
    expect(stripNonSpeechAnnotations('[Music] hello there [BLANK_AUDIO]')).toBe('hello there');
    expect(stripNonSpeechAnnotations('♪ ♪ hello')).toBe('hello');
    expect(stripNonSpeechAnnotations('speak to the input (inaudible) of Vai'))
      .toBe('speak to the input of Vai');
  });

  it('keeps real speech containing brackets intact', () => {
    expect(stripNonSpeechAnnotations('set config [debug] to true')).toBe('set config [debug] to true');
  });

  it('rejects semantic rewrites', () => {
    const raw = 'Hello, can you hear what I am saying';
    const bad = "I love it. Can you help with what I'm saying?";
    expect(transcriptWordOverlap(raw, bad)).toBeLessThan(0.62);
    expect(shouldAcceptPolishedTranscript(raw, bad)).toBe(false);
  });

  it('accepts punctuation-only cleanup', () => {
    const raw = 'hello can you hear what i am saying';
    const good = 'Hello, can you hear what I am saying?';
    expect(shouldAcceptPolishedTranscript(raw, good)).toBe(true);
  });

  it('detects malformed ASR fragments without flagging normal hyphenated words', () => {
    expect(looksLikeAsrArtifactTranscript("I'm eating a joke-o-o-gost in the morning.")).toBe(true);
    expect(looksLikeAsrArtifactTranscript('This is a state-of-the-art recorder.')).toBe(false);
  });

  it('accepts a narrow repair for a suspicious ASR fragment', () => {
    const raw = "I'm speaking now, I'm eating a joke-o-o-gost in the morning.";
    const repaired = "I'm speaking now. I'm eating yoghurt in the morning.";
    expect(shouldAcceptPolishedTranscript(raw, repaired)).toBe(true);
  });

  it('repairs the seeded yoghourt ASR artifact deterministically', () => {
    expect(repairKnownAsrArtifacts("I'm eating a joke-o-o-gost in the morning."))
      .toBe("I'm eating yoghourt in the morning.");
    expect(repairKnownAsrArtifacts("I'm eating a joke o o gost in the morning."))
      .toBe("I'm eating yoghourt in the morning.");
  });

  it('repairs the seeded words/worlds dictation artifact only in context', () => {
    expect(repairKnownAsrArtifacts('all the worlds that i am saying are being recorded'))
      .toBe('all the words that I am saying are being recorded');
    expect(repairKnownAsrArtifacts('I am building all the worlds today.'))
      .toBe('I am building all the worlds today.');
  });

  it('repairs the seeded keybind ASR artifact deterministically', () => {
    expect(repairKnownAsrArtifacts('I am pressing my key amount now.'))
      .toBe('I am pressing my keybind now.');
  });

  it('recognizes a pure deletion as an ordered subsequence', () => {
    expect(isTokenSubsequence('meet tuesday actually no wednesday', 'meet wednesday')).toBe(true);
    // A word not present in the source breaks the subsequence (nothing invented).
    expect(isTokenSubsequence('meet tuesday', 'meet friday')).toBe(false);
    // Reordering is not a subsequence.
    expect(isTokenSubsequence('ship it monday', 'monday ship')).toBe(false);
  });

  it('accepts self-correction only when a retraction cue is present', () => {
    const raw = "let's meet Tuesday, actually no, Wednesday";
    const corrected = "Let's meet Wednesday.";
    // Overlap alone is below the rewrite threshold — the retraction path is what allows it.
    expect(transcriptWordOverlap(raw, corrected)).toBeLessThan(0.62);
    expect(shouldAcceptPolishedTranscript(raw, corrected)).toBe(true);
  });

  it('does NOT drop words when there is no retraction cue', () => {
    // Same shape of deletion, but no "actually/scratch that/..." — must be rejected
    // so the model can never silently truncate a sentence.
    const raw = 'we could ship it Tuesday and tell the whole team tomorrow';
    const truncated = 'we could ship it.';
    expect(shouldAcceptPolishedTranscript(raw, truncated)).toBe(false);
  });
});
