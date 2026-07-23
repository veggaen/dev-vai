import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { motion } from 'framer-motion';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import type { DictationStatus } from '../../hooks/useVoiceDictation.js';
import type { MicTriggerMode } from '../../lib/voice/mic-mode.js';
import { LevelBars } from './DictationLevel.js';
import { useShortcutsStore } from '../../stores/shortcutsStore.js';

interface MicButtonProps {
  readonly status: DictationStatus;
  readonly supported: boolean;
  readonly mode?: MicTriggerMode;
  readonly onHoldStart: () => void;
  readonly onHoldEnd: () => void;
  readonly level?: number;
  readonly disabled?: boolean;
  /** Right-click → voice menu (settings + mic picker). */
  readonly onContextMenu?: (at: { x: number; y: number }) => void;
}

export function MicButton({
  status,
  supported,
  mode = 'hold',
  onHoldStart,
  onHoldEnd,
  level = 0,
  disabled,
  onContextMenu,
}: MicButtonProps) {
  const listening = status === 'listening';
  const transcribing = status === 'transcribing';
  const dictationBlocked = Boolean(disabled || !supported || status === 'unsupported');
  const pointerHoldingRef = useRef(false);
  const shortcutOverride = useShortcutsStore((state) => state.overrides.globalDictation);
  const globalShortcut = shortcutOverride ?? 'Win+Alt';

  const title = !supported || status === 'unsupported'
    ? 'Voice input is not available in this environment'
    : listening
      ? mode === 'toggle'
        ? 'Listening… click to finish'
        : 'Listening… release to insert'
      : transcribing
        ? 'Transcribing…'
        : mode === 'toggle'
          ? 'Click to dictate · right-click for voice settings'
          : `Hold to dictate (game-safe: ${globalShortcut}) · right-click for voice settings`;

  const handlePrimary = useCallback(() => {
    if (dictationBlocked || transcribing) return;
    if (mode === 'toggle') {
      if (listening) onHoldEnd();
      else onHoldStart();
      return;
    }
    onHoldStart();
  }, [dictationBlocked, transcribing, mode, listening, onHoldEnd, onHoldStart]);

  const handleRelease = useCallback((force = false) => {
    if (mode === 'toggle') return;
    if (!force && dictationBlocked) return;
    onHoldEnd();
  }, [dictationBlocked, mode, onHoldEnd]);

  const beginPointerHold = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dictationBlocked || transcribing || mode !== 'hold' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pointerHoldingRef.current) return;
    pointerHoldingRef.current = true;
    handlePrimary();
  }, [dictationBlocked, handlePrimary, mode, transcribing]);

  const endPointerHold = useCallback((e?: ReactPointerEvent<HTMLButtonElement>) => {
    if (mode !== 'hold' || !pointerHoldingRef.current) return;
    pointerHoldingRef.current = false;
    e?.currentTarget.releasePointerCapture?.(e.pointerId);
    handleRelease(true);
  }, [handleRelease, mode]);

  return (
    <motion.button
      type="button"
      aria-label={title}
      aria-pressed={listening}
      aria-disabled={dictationBlocked}
      title={title}
      onClick={mode === 'toggle' ? handlePrimary : undefined}
      onPointerDown={mode === 'hold' ? beginPointerHold : undefined}
      onPointerUp={mode === 'hold' ? endPointerHold : undefined}
      onPointerCancel={mode === 'hold' ? endPointerHold : undefined}
      onLostPointerCapture={mode === 'hold' ? () => {
        if (!pointerHoldingRef.current) return;
        pointerHoldingRef.current = false;
        handleRelease(true);
      } : undefined}
      onContextMenu={onContextMenu ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu({ x: e.clientX, y: e.clientY });
      } : undefined}
      onMouseDown={onContextMenu ? (e) => {
        // WebView2 sometimes drops contextmenu — right-button mousedown is the fallback.
        if (e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu({ x: e.clientX, y: e.clientY });
        }
      } : undefined}
      whileTap={dictationBlocked ? {} : { scale: 0.92 }}
      className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-200 ${
        dictationBlocked
          ? 'cursor-not-allowed text-[color:var(--chat-muted)] opacity-50'
          : listening
            ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-text)]'
            : 'text-[color:var(--chat-muted)] hover:bg-white/[0.06] hover:text-[color:var(--chat-body)]'
      }`}
    >
      {listening && (
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-full ring-2 ring-[color:var(--accent-ring)]"
          initial={{ opacity: 0.7, scale: 1 }}
          animate={{ opacity: 0, scale: 1.6 }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      {transcribing
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : !supported || status === 'unsupported'
          ? <MicOff className="h-4 w-4" />
          : listening
            ? <LevelBars level={level || 0.18} height={15} />
            : <Mic className="h-4 w-4" />}
    </motion.button>
  );
}

export default MicButton;
