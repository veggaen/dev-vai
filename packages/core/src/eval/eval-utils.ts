/**
 * Shared utility functions for the eval subsystem.
 *
 * Extracted to eliminate duplication between conversation-scorer.ts
 * and learning-extractor.ts. Pure functions, no side effects.
 */

import type { SessionEvent } from '../sessions/types.js';

// ── Content Safety ─────────────────────────────────────────────

/** Tracks silent fallback returns for debugging upstream data issues. */
export const fallbackCounters = { safeContentNull: 0, safeContentEmpty: 0 };

/** Safely extract content from a session event, truncated to maxLen. */
export function safeContent(event: SessionEvent | null, maxLen = 5000): string {
  if (!event) { fallbackCounters.safeContentNull++; return ''; }
  const content = (event.content ?? '');
  if (!content) fallbackCounters.safeContentEmpty++;
  return content.slice(0, maxLen);
}

/** Strip fenced code blocks from text to focus on prose. */
export function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

/** Truncate text to a max length, appending nothing (clean slice). */
export function safeSlice(text: string, maxLen: number): string {
  return (text ?? '').slice(0, maxLen);
}

// ── Text Analysis ──────────────────────────────────────────────

/** Count whitespace-separated words in text. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Compute n-gram set from text (lowercased, whitespace-split). */
export function computeNgrams(text: string, n: number): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    grams.add(words.slice(i, i + n).join(' '));
  }
  return grams;
}

/** Jaccard overlap between two n-gram sets. Returns 0-1. */
export function ngramOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Retry Chain Detection ──────────────────────────────────────

export interface RetryChain {
  readonly startIndex: number;
  readonly length: number;
}

/**
 * Detect retry chains in turn pairs — sequences where the user
 * repeats or rephrases the same request (high n-gram overlap
 * or shared file paths between consecutive user messages).
 */
export function detectRetryChains(
  turnPairs: readonly { userMessage: SessionEvent | null }[],
  overlapThreshold = 0.30,
): RetryChain[] {
  const chains: RetryChain[] = [];
  let chainStart = -1;
  let chainLen = 0;

  for (let i = 1; i < turnPairs.length; i++) {
    const prevContent = stripCodeBlocks(safeContent(turnPairs[i - 1].userMessage));
    const currContent = stripCodeBlocks(safeContent(turnPairs[i].userMessage));

    const prevGrams = computeNgrams(prevContent, 3);
    const currGrams = computeNgrams(currContent, 3);
    const overlap = ngramOverlap(prevGrams, currGrams);

    // Also check shared file paths
    const filePaths = /[\w./]+\.\w{1,5}/g;
    const prevPaths = new Set((prevContent.match(filePaths) ?? []).map(p => p.toLowerCase()));
    const currPaths = new Set((currContent.match(filePaths) ?? []).map(p => p.toLowerCase()));
    const sharedPaths = [...prevPaths].filter(p => currPaths.has(p)).length > 0;

    // Require minimum content length to avoid false positives on very short messages
    const bothSubstantial = countWords(prevContent) >= 4 && countWords(currContent) >= 4;
    const isRetry = bothSubstantial && (overlap > overlapThreshold || sharedPaths);

    if (isRetry) {
      if (chainStart === -1) {
        chainStart = i - 1;
        chainLen = 2;
      } else {
        chainLen++;
      }
    } else {
      if (chainStart !== -1 && chainLen >= 2) {
        chains.push({ startIndex: chainStart, length: chainLen });
      }
      chainStart = -1;
      chainLen = 0;
    }
  }

  if (chainStart !== -1 && chainLen >= 2) {
    chains.push({ startIndex: chainStart, length: chainLen });
  }

  return chains;
}
