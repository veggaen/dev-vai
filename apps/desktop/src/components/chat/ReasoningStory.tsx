/**
 * ReasoningStory — the live narrative lane of the timeline.
 *
 * Renders {@link buildStoryLines} as an attributed conversation feed: Vai's work in
 * plain sentences, each council peer speaking TO Vai on its own line, the gate ruling
 * in tone color. While the turn is live the newest line shimmers and new lines slide
 * in; settled turns collapse the story behind a one-line toggle.
 *
 * Motion is transform/opacity only and honors prefers-reduced-motion (rubric).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
// (refs used for the live auto-follow feed below)
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { TimelinePhase } from './Timeline.logic.js';
import type { CouncilThinkingUI } from '../../stores/chatStore.js';
import { buildStoryLines, type StoryLine } from './ReasoningStory.logic.js';

interface ReasoningStoryProps {
  readonly phases: readonly TimelinePhase[];
  readonly council?: CouncilThinkingUI | null;
  readonly live: boolean;
  /** Open the spotlight for a phase when a story row is clicked. */
  readonly onSelectPhase?: (phaseId: string) => void;
}

/** How long user mouse activity over the feed holds off the auto-follow. */
const FOLLOW_HOLDOFF_MS = 4000;

export function ReasoningStory({ phases, council, live, onSelectPhase }: ReasoningStoryProps) {
  const lines = useMemo(() => buildStoryLines(phases, council), [phases, council]);
  const reduce = useReducedMotion();
  // Open by default: the surrounding flow body already collapses to one line at rest,
  // so when it's visible the user has asked to see the turn — show the conversation.
  const [open, setOpen] = useState(true);

  /**
   * Auto-follow: the feed tracks the newest line while streaming, the way a person
   * would scroll. It yields to the user — scrolling up detaches it, mouse activity
   * holds it off briefly — and re-attaches when the user returns to the bottom,
   * when the hold-off expires, or when a new turn starts.
   */
  const feedRef = useRef<HTMLOListElement>(null);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  const holdoffUntil = useRef(0);
  const programmaticScroll = useRef(false);
  const holdoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setFollow = (v: boolean) => {
    followingRef.current = v;
    setFollowing(v);
  };

  const scrollToEnd = (behavior: ScrollBehavior = 'auto') => {
    const el = feedRef.current;
    if (!el) return;
    programmaticScroll.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior });
    // The scroll event fires async; release the guard on the next frame batch.
    window.setTimeout(() => { programmaticScroll.current = false; }, 80);
  };

  const followNow = () => {
    if (!followingRef.current || !open) return;
    if (Date.now() < holdoffUntil.current) {
      // Re-try once the mouse hold-off expires so the view catches up on its own.
      if (holdoffTimer.current) clearTimeout(holdoffTimer.current);
      holdoffTimer.current = setTimeout(() => followNow(), holdoffUntil.current - Date.now() + 20);
      return;
    }
    scrollToEnd(reduce ? 'auto' : 'smooth');
  };

  // New lines stream in → keep the end in view (respecting user activity).
  useEffect(() => {
    if (!live || !open) return;
    followNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, live, open]);

  // A NEW turn starting always re-attaches the view to the live end.
  useEffect(() => {
    if (live) {
      holdoffUntil.current = 0;
      setFollow(true);
      scrollToEnd('auto');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  useEffect(() => () => { if (holdoffTimer.current) clearTimeout(holdoffTimer.current); }, []);

  const onFeedScroll = () => {
    if (programmaticScroll.current) return;
    const el = feedRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom && !followingRef.current) setFollow(true);
    else if (!atBottom && followingRef.current) setFollow(false);
  };

  // Mouse motion over the feed = the user is reading; hold the follow briefly.
  const onFeedPointerMove = () => {
    holdoffUntil.current = Date.now() + FOLLOW_HOLDOFF_MS;
  };

  if (lines.length === 0) return null;

  return (
    <div className="reasoning-story" data-testid="reasoning-story" data-live={live ? '1' : '0'}>
      <button
        type="button"
        className="reasoning-story-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="reasoning-story-title">Story</span>
        <span className="reasoning-story-count tabular-nums">
          {live ? 'live' : `${lines.length} lines`}
        </span>
        <span className={`reasoning-story-caret ${open ? 'reasoning-story-caret--open' : ''}`} aria-hidden="true">›</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="story-feed-shell"
            className="reasoning-story-shell"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <ol
              ref={feedRef}
              className="reasoning-story-feed"
              aria-live={live ? 'polite' : undefined}
              onScroll={onFeedScroll}
              onPointerMove={onFeedPointerMove}
            >
              {lines.map((line, i) => (
                <StoryRow
                  key={line.id}
                  line={line}
                  newest={live && i === lines.length - 1}
                  reduce={!!reduce}
                  onSelect={line.phaseId && onSelectPhase ? () => onSelectPhase(line.phaseId as string) : undefined}
                />
              ))}
            </ol>
            {/* Detached while streaming → one quiet way back to the live edge. */}
            {live && !following && (
              <button
                type="button"
                className="reasoning-story-jump"
                onClick={() => { holdoffUntil.current = 0; setFollow(true); scrollToEnd('smooth'); }}
              >
                ↓ back to live
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StoryRow({ line, newest, reduce, onSelect }: { line: StoryLine; newest: boolean; reduce: boolean; onSelect?: () => void }) {
  const body = (
    <>
      <span className="reasoning-story-speaker">
        {line.speaker}
        {line.to && (
          <>
            <span className="reasoning-story-arrow" aria-hidden="true">→</span>
            {line.to}
          </>
        )}
      </span>
      <span className={`reasoning-story-text ${newest && (line.live ?? true) ? 'vai-process-shimmer' : ''}`}>
        {line.text}
      </span>
    </>
  );
  return (
    <motion.li
      className={`reasoning-story-row reasoning-story-row--${line.role} reasoning-story-tone--${line.tone} ${onSelect ? 'reasoning-story-row--link' : ''}`}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      {onSelect ? (
        <button type="button" className="reasoning-story-rowbtn" onClick={onSelect} title="Open this step's detail">
          {body}
        </button>
      ) : (
        body
      )}
    </motion.li>
  );
}

export default ReasoningStory;
