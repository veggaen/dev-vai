/**
 * Live dictation into the composer — Wispr-style in-field streaming.
 *
 * Captures a prefix/suffix anchor at the cursor when dictation starts, then
 * replaces only the middle segment as partial/final transcripts arrive.
 */

import { useCallback, useRef, type RefObject } from 'react';
import { stripNonSpeechAnnotations } from '@vai/core/browser';
import {
  applyProfile,
  loadProfile,
  prettifyTranscript,
  type AppliedReplacement,
} from '../lib/voice/speech-profile.js';

export interface LiveDictationAnchor {
  readonly prefix: string;
  readonly suffix: string;
  readonly sep: string;
  readonly sessionId: number;
}

interface CommittedDictationSpan extends LiveDictationAnchor {
  readonly text: string;
}

/** Light groom while still speaking — no terminal punctuation or sentence casing yet. */
export function groomDictationInterim(raw: string): string {
  let t = stripNonSpeechAnnotations(raw.trim());
  if (!t) return '';
  t = t.replace(/\b(?:um+|uh+|uhm+|erm+|hmm+)\b[,.]?\s*/gi, '');
  t = t.replace(/\b(\w+)(\s+\1)+\b/gi, '$1');
  t = t.replace(/\s{2,}/g, ' ').trim();
  const { text } = applyProfile(t, loadProfile());
  return text || t;
}

/** Full groom on final text — profile rules + deterministic prettify (no model). */
export function groomDictationDisplay(raw: string): string {
  const trimmed = stripNonSpeechAnnotations(raw.trim());
  if (!trimmed) return '';
  const { text } = applyProfile(trimmed, loadProfile());
  return prettifyTranscript(text) || trimmed;
}

export function useComposerDictationLive(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  setInput: (value: string | ((prev: string) => string)) => void,
) {
  const anchorRef = useRef<LiveDictationAnchor | null>(null);
  const committedRef = useRef<CommittedDictationSpan | null>(null);
  const sessionRef = useRef(0);
  /** Last display text written for the ACTIVE anchor — lets a late insertion recompose the field. */
  const liveTextRef = useRef('');

  const begin = useCallback((): number => {
    const ta = textareaRef.current;
    const value = ta?.value ?? '';
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? start;
    const prefix = value.slice(0, start);
    const suffix = value.slice(end);
    const sep = prefix && !/\s$/.test(prefix) ? ' ' : '';
    sessionRef.current += 1;
    anchorRef.current = { prefix, suffix, sep, sessionId: sessionRef.current };
    committedRef.current = null;
    liveTextRef.current = '';
    return sessionRef.current;
  }, [textareaRef]);

  const placeCaret = useCallback((offset: number) => {
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(offset, offset);
    });
  }, [textareaRef]);

  const update = useCallback((rawText: string, options?: { finalize?: boolean; groom?: boolean; asIs?: boolean }) => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const display = options?.asIs
      ? rawText.trim()
      : options?.finalize || options?.groom === true
        ? groomDictationDisplay(rawText)
        : options?.groom === false
          ? rawText.trim()
          : groomDictationInterim(rawText);
    const next = anchor.prefix + anchor.sep + display + anchor.suffix;
    setInput(next);
    placeCaret(anchor.prefix.length + anchor.sep.length + display.length);
    if (options?.finalize) {
      committedRef.current = { ...anchor, text: display };
      anchorRef.current = null;
      liveTextRef.current = '';
    } else {
      liveTextRef.current = display;
    }
  }, [setInput, placeCaret]);

  const commit = useCallback((text: string, options?: { groom?: boolean }) => {
    update(text, { finalize: true, groom: options?.groom });
  }, [update]);

  /**
   * A LATE final from a PREVIOUS hold arrived while a new hold owns the anchor.
   * Land the old words into the new anchor's prefix instead of consuming the
   * anchor — consuming it both re-inserted stale text over the new session and
   * orphaned the new hold's transcript (the duplication + lost-words bugs).
   */
  const insertBeforeAnchor = useCallback((rawText: string) => {
    const anchor = anchorRef.current;
    const display = rawText.trim();
    if (!anchor || !display) return;
    const glue = anchor.prefix && !/\s$/.test(anchor.prefix) ? ' ' : '';
    const prefix = anchor.prefix + glue + display;
    const sep = /\s$/.test(prefix) ? '' : ' ';
    anchorRef.current = { ...anchor, prefix, sep };
    const live = liveTextRef.current;
    setInput(prefix + (live ? sep + live : '') + anchor.suffix);
    placeCaret(prefix.length + (live ? sep.length + live.length : 0));
  }, [setInput, placeCaret]);

  const replaceCommitted = useCallback((rawText: string, options?: { groom?: boolean; asIs?: boolean }) => {
    const committed = committedRef.current;
    if (!committed) return;
    const display = options?.asIs
      ? rawText.trim()
      : options?.groom === false
        ? rawText.trim()
        : groomDictationDisplay(rawText);
    setInput((prev) => {
      const expected = committed.prefix + committed.sep + committed.text + committed.suffix;
      if (prev !== expected) {
        committedRef.current = null;
        return prev;
      }
      const next = committed.prefix + committed.sep + display + committed.suffix;
      committedRef.current = { ...committed, text: display };
      placeCaret(committed.prefix.length + committed.sep.length + display.length);
      return next;
    });
  }, [setInput, placeCaret]);

  const cancel = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    setInput(anchor.prefix + anchor.suffix);
    anchorRef.current = null;
    committedRef.current = null;
    liveTextRef.current = '';
  }, [setInput]);

  const isActive = useCallback(() => anchorRef.current !== null, []);

  const sessionId = useCallback(() => sessionRef.current, []);

  return {
    begin,
    update,
    commit,
    replaceCommitted,
    insertBeforeAnchor,
    cancel,
    isActive,
    sessionId,
    anchorRef,
  };
}

export type ComposerDictationLiveEvent =
  | { kind: 'begin' }
  | { kind: 'level'; level: number }
  | { kind: 'interim'; text: string }
  /** Chord released — recording is over. Kill listening effects NOW; text lands via 'groomed'. */
  | { kind: 'end' }
  | { kind: 'groomed'; text: string; applied?: readonly AppliedReplacement[] }
  | { kind: 'polish'; text: string; applied?: readonly AppliedReplacement[] }
  /** A superseded hold will never deliver — release the pending slot it reserved. */
  | { kind: 'discard' }
  | { kind: 'cancel' };

export const COMPOSER_DICTATION_LIVE_EVENT = 'vai:dictation-live';
