import { motion } from 'framer-motion';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import type { DictationStatus } from '../../hooks/useVoiceDictation.js';

interface MicButtonProps {
  readonly status: DictationStatus;
  readonly supported: boolean;
  /** Press-and-hold to talk (pointer); release to insert. */
  readonly onHoldStart: () => void;
  readonly onHoldEnd: () => void;
  readonly disabled?: boolean;
}

/**
 * Composer mic button — press-and-hold to dictate (mirrors the Alt+Win hotkey).
 *
 * States: idle (mic), listening (pulsing ring), transcribing (spinner), error /
 * unsupported (muted, disabled). Per the UI rubric we animate only transform and
 * opacity — the "listening" ring uses scale/opacity, never box-shadow — and every
 * state has an accessible label + title.
 */
export function MicButton({ status, supported, onHoldStart, onHoldEnd, disabled }: MicButtonProps) {
  const listening = status === 'listening';
  const transcribing = status === 'transcribing';
  const isDisabled = disabled || !supported || status === 'unsupported';

  const title = !supported || status === 'unsupported'
    ? 'Voice input is not available in this environment'
    : listening
      ? 'Listening… release to insert'
      : transcribing
        ? 'Transcribing…'
        : 'Hold to dictate (or hold Alt+Win)';

  return (
    <motion.button
      type="button"
      aria-label={title}
      aria-pressed={listening}
      title={title}
      disabled={isDisabled}
      // Pointer + touch press-and-hold. Pointer-up anywhere ends via the parent's
      // window listener too, but we end on leave/up here for the common case.
      onPointerDown={(e) => { if (!isDisabled) { e.preventDefault(); onHoldStart(); } }}
      onPointerUp={() => { if (!isDisabled) onHoldEnd(); }}
      onPointerLeave={() => { if (listening) onHoldEnd(); }}
      whileTap={isDisabled ? {} : { scale: 0.92 }}
      className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-200 ${
        isDisabled
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
          : <Mic className="h-4 w-4" />}
    </motion.button>
  );
}

export default MicButton;
