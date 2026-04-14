/**
 * VaiOverlaySystem — Root-level overlay layer for the entire app.
 *
 * Renders VaiCursor, VirtualKeyboard, RadialMenu, ActionLog, and
 * ScreenshotFlash using FIXED positioning so the AI cursor can move
 * across the entire viewport — sidebar, chat, preview, toolbar — not
 * just inside the sandbox iframe.
 *
 * Exposes `window.__vai_demo` for programmatic control from Puppeteer
 * test scripts (e.g. `vai-tour.mjs`). No built-in UI buttons — the
 * single comprehensive tour runs externally in a visible headed browser.
 */

import { useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCursorStore } from '../stores/cursorStore.js';
import { VaiCursor } from './sandbox/VaiCursor.js';
import { VirtualKeyboard } from './sandbox/VirtualKeyboard.js';
import { ArrowKeys } from './sandbox/ArrowKeys.js';
import { RecordingBadge } from './sandbox/RecordingBadge.js';
import { LiteKeyboard } from './sandbox/LiteKeyboard.js';
import { ScrollIndicator } from './sandbox/ScrollIndicator.js';
import { RadialMenu } from './sandbox/RadialMenu.js';
import { ActionLog } from './sandbox/ActionLog.js';
import { runDemoSequence, DEFAULT_DEMO, type DemoAction } from './sandbox/DemoSequence.js';
import { exposeGymAPI } from './VaiGymRunner.js';
import { exposeQAGlobal } from './VaiQARunner.js';

/* ── Screenshot flash (inline — lightweight) ── */
function ScreenshotFlash({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="fixed inset-0 z-[75] bg-white pointer-events-none"
          initial={{ opacity: 0.8 }}
          animate={{ opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      )}
    </AnimatePresence>
  );
}

export function VaiOverlaySystem() {
  const cursor = useCursorStore((s) => s.cursor);
  const kbVisible = useCursorStore((s) => s.kbVisible);
  const kbActiveKey = useCursorStore((s) => s.kbActiveKey);
  const radialOpen = useCursorStore((s) => s.radialOpen);
  const radialPos = useCursorStore((s) => s.radialPos);
  const radialActiveId = useCursorStore((s) => s.radialActiveId);
  const actions = useCursorStore((s) => s.actions);
  const screenshotCount = useCursorStore((s) => s.screenshotCount);
  const screenshotFlash = useCursorStore((s) => s.screenshotFlash);
  const overlayVisible = useCursorStore((s) => s.overlayVisible);
  const arrowKeyActive = useCursorStore((s) => s.arrowKeyActive);
  const recording = useCursorStore((s) => s.recording);
  const recordingStartTime = useCursorStore((s) => s.recordingStartTime);
  const liteKbVisible = useCursorStore((s) => s.liteKbVisible);
  const liteKbActiveKeys = useCursorStore((s) => s.liteKbActiveKeys);
  const liteKbComboText = useCursorStore((s) => s.liteKbComboText);
  const scrollActive = useCursorStore((s) => s.scrollIndicatorActive);
  const scrollDeltaY = useCursorStore((s) => s.scrollIndicatorDeltaY);
  const scrollX = useCursorStore((s) => s.scrollIndicatorX);
  const scrollY = useCursorStore((s) => s.scrollIndicatorY);

  const demoAbortRef = useRef<AbortController | null>(null);

  /* ── Run a demo sequence (programmatic only) ── */
  const runSequence = useCallback(async (seq: DemoAction[]) => {
    if (demoAbortRef.current) return;
    useCursorStore.setState({ demoRunning: true });
    const ctrl = new AbortController();
    demoAbortRef.current = ctrl;
    try {
      const w = window.innerWidth;
      const h = window.innerHeight;
      await runDemoSequence(seq, w, h, ctrl.signal);
    } finally {
      useCursorStore.setState({ demoRunning: false });
      demoAbortRef.current = null;
    }
  }, []);

  const startDefaultDemo = useCallback(() => runSequence(DEFAULT_DEMO), [runSequence]);

  const stopDemo = useCallback(() => {
    if (demoAbortRef.current) {
      demoAbortRef.current.abort();
      demoAbortRef.current = null;
    }
    useCursorStore.setState({ demoRunning: false });
    useCursorStore.getState().hide();
  }, []);

  /* ── Expose window.__vai_demo for external scripts (Puppeteer) ── */
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__vai_demo = {
      run: () => startDefaultDemo(),
      stop: () => stopDemo(),
      isRunning: () => useCursorStore.getState().demoRunning,
      runCustom: (seq: DemoAction[]) => runSequence(seq),
    };
    // Also expose the gym API and QA runner for training/testing scripts
    exposeGymAPI();
    exposeQAGlobal();
    return () => { delete (window as unknown as Record<string, unknown>).__vai_demo; };
  }, [startDefaultDemo, stopDemo, runSequence]);

  return (
    <>
      {/* All overlays use FIXED positioning — they cover the entire viewport */}
      <div className="pointer-events-none fixed inset-0 z-[70]">
        {/* Vai Cursor — fixed on viewport */}
        <VaiCursor state={cursor} />

        {/* Virtual Keyboard — uses viewport dimensions for smart positioning */}
        <VirtualKeyboard
          visible={kbVisible}
          anchorX={cursor.x}
          anchorY={cursor.y}
          activeKey={kbActiveKey}
          containerWidth={typeof window !== 'undefined' ? window.innerWidth : 1200}
          containerHeight={typeof window !== 'undefined' ? window.innerHeight : 800}
        />

        {/* Arrow Keys pad — shows when Vai presses arrow keys */}
        <ArrowKeys
          activeKey={arrowKeyActive}
          anchorX={cursor.x}
          anchorY={cursor.y}
          containerWidth={typeof window !== 'undefined' ? window.innerWidth : 1200}
          containerHeight={typeof window !== 'undefined' ? window.innerHeight : 800}
        />

        {/* Radial Menu */}
        <RadialMenu
          visible={radialOpen}
          x={radialPos.x}
          y={radialPos.y}
          activeId={radialActiveId}
          onSelect={(id) => {
            useCursorStore.getState().selectRadialItem(id);
          }}
          onClose={() => useCursorStore.getState().closeRadialMenu()}
        />

        {/* Action Log — anchored bottom-left of viewport */}
        {overlayVisible && (
          <ActionLog actions={actions} screenshotCount={screenshotCount} />
        )}

        {/* Scroll Indicator — shows when Vai scrolls */}
        <ScrollIndicator
          active={scrollActive}
          deltaY={scrollDeltaY}
          x={scrollX}
          y={scrollY}
        />
      </div>

      {/* Lite Keyboard — shows ALL key presses (fixed bottom-center, outside the overlay div) */}
      <LiteKeyboard
        visible={liteKbVisible}
        activeKeys={liteKbActiveKeys}
        comboText={liteKbComboText}
      />

      {/* Screenshot flash — full viewport */}
      <ScreenshotFlash active={screenshotFlash} />

      {/* Recording badge — top-right corner */}
      <RecordingBadge active={recording} startTime={recordingStartTime} />
    </>
  );
}
