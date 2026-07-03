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
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { TimelinePhase } from './Timeline.logic.js';
import type { CouncilThinkingUI } from '../../stores/chatStore.js';
import { buildStoryLines, type StoryLine } from './ReasoningStory.logic.js';

interface ReasoningStoryProps {
  readonly phases: readonly TimelinePhase[];
  readonly council?: CouncilThinkingUI | null;
  readonly live: boolean;
}

export function ReasoningStory({ phases, council, live }: ReasoningStoryProps) {
  const lines = useMemo(() => buildStoryLines(phases, council), [phases, council]);
  const reduce = useReducedMotion();
  // Live turns stream the story open; settled turns rest collapsed until asked.
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current === live) return;
    wasLive.current = live;
    setOpen(live);
  }, [live]);

  // Keep the newest line in view while streaming.
  const feedRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!live || !open) return;
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, live, open]);

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
          <motion.ol
            key="story-feed"
            ref={feedRef}
            className="reasoning-story-feed"
            aria-live={live ? 'polite' : undefined}
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            {lines.map((line, i) => (
              <StoryRow
                key={line.id}
                line={line}
                newest={live && i === lines.length - 1}
                reduce={!!reduce}
              />
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}

function StoryRow({ line, newest, reduce }: { line: StoryLine; newest: boolean; reduce: boolean }) {
  return (
    <motion.li
      className={`reasoning-story-row reasoning-story-row--${line.role} reasoning-story-tone--${line.tone}`}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
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
    </motion.li>
  );
}

export default ReasoningStory;
