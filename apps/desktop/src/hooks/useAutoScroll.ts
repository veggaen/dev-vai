/**
 * useAutoScroll — Smart auto-scroll hook inspired by Claude & VS Code chat.
 *
 * Rules:
 *   1. User sends a message → always scroll to bottom.
 *   2. During streaming, if user is near bottom (≤100px), keep scrolling.
 *   3. If user scrolled up manually, pause auto-scroll and show FAB.
 *   4. Clicking FAB smooth-scrolls back and re-enables auto-scroll.
 */

import { useRef, useEffect, useCallback, useState } from 'react';

const NEAR_BOTTOM_THRESHOLD = 100;

interface UseAutoScrollOptions {
  /** Number of messages — triggers scroll check */
  messageCount: number;
  /** Whether the AI is currently streaming */
  isStreaming: boolean;
}

export function useAutoScroll({ messageCount, isStreaming }: UseAutoScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const userScrolledUp = useRef(false);
  const prevMessageCount = useRef(messageCount);

  /** Check if the container is near the bottom */
  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD;
  }, []);

  /** Scroll to bottom smoothly */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolledUp.current = false;
    setShowScrollButton(false);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  /** Handle user scroll events */
  const handleScroll = useCallback(() => {
    const nearBottom = isNearBottom();
    if (nearBottom) {
      userScrolledUp.current = false;
      setShowScrollButton(false);
    } else {
      userScrolledUp.current = true;
      setShowScrollButton(true);
    }
  }, [isNearBottom]);

  /** When new messages arrive, auto-scroll if appropriate */
  useEffect(() => {
    const newMessage = messageCount > prevMessageCount.current;
    prevMessageCount.current = messageCount;

    if (newMessage && !userScrolledUp.current) {
      // New message + user was at bottom → scroll
      requestAnimationFrame(() => {
        scrollToBottom('smooth');
      });
    }
  }, [messageCount, scrollToBottom]);

  /** During streaming, keep scrolling if user hasn't scrolled up */
  useEffect(() => {
    if (!isStreaming) return;
    if (userScrolledUp.current) return;

    const interval = setInterval(() => {
      if (!userScrolledUp.current) {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
    }, 50);

    return () => clearInterval(interval);
  }, [isStreaming]);

  /** Attach scroll listener */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return {
    scrollRef,
    showScrollButton,
    scrollToBottom: () => scrollToBottom('smooth'),
  };
}
