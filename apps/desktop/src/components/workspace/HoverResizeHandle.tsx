/**
 * Panel resize grip — hover ~500ms to arm, then drag to resize.
 * Keeps borders quiet until the user deliberately targets them.
 */

import { useCallback, useRef, useState } from 'react';
import { Separator } from 'react-resizable-panels';

const ARM_MS = 500;

interface HoverResizeHandleProps {
  direction?: 'vertical' | 'horizontal';
}

export function HoverResizeHandle({ direction = 'vertical' }: HoverResizeHandleProps) {
  const isVertical = direction === 'vertical';
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleEnter = () => {
    clearTimer();
    timerRef.current = window.setTimeout(() => setArmed(true), ARM_MS);
  };

  const handleLeave = () => {
    clearTimer();
    setArmed(false);
  };

  return (
    <Separator
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onPointerDown={() => setArmed(true)}
      className={`group relative flex items-center justify-center transition-all ${
        isVertical ? 'w-[5px] cursor-col-resize' : 'h-[5px] cursor-row-resize'
      } ${armed ? 'z-10 bg-[color:var(--accent-soft)]' : ''}`}
      title={armed ? 'Drag to resize' : 'Hover to resize'}
      aria-label="Resize panel"
    >
      <div
        className={`pointer-events-none transition-all duration-200 ${
          armed
            ? 'bg-[color:var(--accent)] opacity-100 shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_45%,transparent)]'
            : 'bg-[color:var(--shell-line-soft)] opacity-40 group-hover:opacity-70'
        } ${isVertical ? 'h-full w-[2px] rounded-full' : 'w-full h-[2px] rounded-full'}`}
      />
      {armed && (
        <span
          className={`pointer-events-none absolute select-none text-[9px] font-medium uppercase tracking-[0.14em] text-[color:var(--accent-text)] ${
            isVertical
              ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90'
              : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'
          }`}
        >
          resize
        </span>
      )}
    </Separator>
  );
}
